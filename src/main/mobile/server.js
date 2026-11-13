// スマホ連携（docs/MOBILE.md）：同じ Wi-Fi のスマホにページを配り、暗号化した窓口（POST /m/api）に答える。
// - 配るのは画面のファイル（src/mobile・src/shared・pdf.js・@noble/ciphers）だけ。資料・注釈・問題は窓口からだけ
// - 窓口の中身：端末の番号（26 文字）＋ seal した {ch, arg, t}。答えも同じ鍵で seal する
// - 5 分より古い・先の要求と、同じ番号（nonce）の 2 回目は受け付けない（盗み見た通信の送り直しを通さない）
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {promises as fsp} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {MAX_SKEW_MS, open, seal} from '../../shared/mobile-wire.js';

export const DEFAULT_PORT = 47390;
export const DEFAULT_TLS_PORT = 47391; // https（スマホのブラウザでカメラを使う。tls-cert.js）
const BODY_MAX = 48 * 1024 * 1024; // 写真 1 枚（30MB）の base64（4/3 倍）＋余り。スマホは写真を 1 枚ずつ送る
const PAD_BODY_MAX = 128 * 1024 * 1024; // パソコンと同じ画面の iPad（§8）：ファイル 1 つ 90MB（PAD_FILE_MAX）の base64＋余り
const POLL_MAX = 8; // 知らせを待っている要求（iPad の画面ごとに 1 つ）。窓口の同時の数（INFLIGHT_MAX）には数えない
const HEAD = 26; // 本文の頭：端末の番号（ULID）
const PENDING_MAX = 4096; // QR を読んだだけの端末のあいさつの大きさの上限
const INFLIGHT_MAX = 4; // 同時に受ける窓口の要求（端末を確かめたものだけ数える）
const HEAD_TIMEOUT_MS = 10_000; // 先頭（端末の番号）を待つ時間。過ぎたら切る
const CONNECTIONS_MAX = 32; // 同時につなげる数（画面のファイルも含む）
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); // src
const require = createRequire(import.meta.url);
// パッケージの置き場所（package.json を exports に出していないパッケージもあるので、中のファイルから求める）
const pkgDir = (name, file) => path.dirname(require.resolve(`${name}/${file}`));

/** 配る場所：URL の頭 → ディレクトリ（中のファイルだけ。.. は通さない） */
export function staticRoots() {
  return [
    ['/m/app/', path.join(SRC, 'mobile')],
    ['/m/shared/', path.join(SRC, 'shared')],
    ['/m/pdfjs/', pkgDir('pdfjs-dist', 'package.json')],
    ['/m/vendor/noble/', pkgDir('@noble/ciphers', 'chacha.js')],
    ['/m/vendor/jsqr/', pkgDir('jsqr', 'dist/jsQR.js')], // QR を読む（ホーム画面に追加したスマホのページで、パソコンの QR を読んでつなぐ）
    // パソコンと同じ画面（iPad。§8）：パソコンの画面のファイルを、パソコンのアプリの中と同じ並びで配る（node_modules への相対の参照がそのまま通る）
    ['/m/p/src/renderer/', path.join(SRC, 'renderer')],
    ['/m/p/src/shared/', path.join(SRC, 'shared')],
    ['/m/p/node_modules/pdfjs-dist/', pkgDir('pdfjs-dist', 'package.json')],
    // three は package.json も本体（three.cjs）も require で引けない（exports に出していない・配布物では three.cjs を外す）。
    // pdfjs-dist と同じ node_modules にある
    ['/m/p/node_modules/three/', path.join(pkgDir('pdfjs-dist', 'package.json'), '..', 'three')],
    ['/m/p/pad/', path.join(SRC, 'pad')]
  ];
}

/** パソコンと同じ画面の入口（iPad。§8）。パソコンの画面の index.html を、iPad で動くように直して配る */
// /m/ の下に置く：ホーム画面に追加したアプリの範囲（manifest の scope）が /m/ のままのアイコン（v0.21.0 までに追加したもの・
// iPad が manifest を読まなかったとき）でも、アプリの中として開く（外とみなされると Safari のバーが出る。v0.21.2）
export const PAD_INDEX = '/m/p/src/renderer/index.html';

/**
 * パソコンの画面の index.html → iPad のページ：
 * 画面の幅に合わせる・iPad の見た目（pad.css）を足す・暗号の部品を import の対応表に足す（CSP のハッシュも直す）・
 * app.js の前に、パソコンとのやりとりを用意する boot.js を読む（window.daigaku を作ってから app.js を読む）
 */
export function padIndexHtml(raw) {
  // Windows で取り出したファイルは改行が CRLF（CSP のハッシュは LF の中身で書いてある）。LF にそろえる
  const html = raw.replace(/\r\n/g, '\n');
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!map) throw new Error('index.html に import の対応表がありません');
  const json = JSON.parse(map[1]);
  json.imports['@noble/ciphers/'] = '/m/vendor/noble/';
  const body = `\n${JSON.stringify(json, null, 2)}\n`;
  const hash = (t) => `'sha256-${createHash('sha256').update(t).digest('base64')}'`;
  const old = hash(map[1]);
  if (!html.includes(old)) throw new Error('index.html の CSP に import の対応表のハッシュがありません');
  const app = '<script type="module" src="app.js"></script>';
  if (!html.includes(app)) throw new Error('index.html に app.js がありません');
  return html
    .replace(old, hash(body))
    .replace(map[0], `<script type="importmap">${body}</script>`)
    .replace(
      '<meta charset="utf-8" />',
      '<meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n    <meta name="apple-mobile-web-app-capable" content="yes" />\n    <meta name="apple-mobile-web-app-title" content="パレットノート" />\n    <link rel="manifest" href="/m/app/manifest.webmanifest" />\n    <link rel="stylesheet" href="/m/p/pad/pad.css" />'
    )
    .replace(app, '<script type="module" src="/m/p/pad/boot.js"></script>');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm'
};

/** URL のパス → 配るファイル（なければ null）。ディレクトリの外・隠しファイル・知らない種類は配らない */
export function staticFile(urlPath, roots = staticRoots()) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (p === '/m' || p === '/m/') return path.join(SRC, 'mobile', 'index.html');
  if (p === PAD_INDEX) return null; // padIndexHtml で直して配る
  for (const [prefix, dir] of roots) {
    if (!p.startsWith(prefix)) continue;
    const rel = p.slice(prefix.length);
    if (!rel || rel.split('/').some((seg) => !seg || seg.startsWith('.'))) return null;
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep)) return null;
    if (!TYPES[path.extname(file).toLowerCase()]) return null;
    return file;
  }
  return null;
}

/** このパソコンの LAN の IPv4（家庭や大学の内向きの番号だけ。Wi-Fi・有線を先に） */
export function lanAddresses(ifaces = os.networkInterfaces()) {
  // 通しテスト（LAN のない CI・コンテナ）：決めた番号を LAN の番号として使う
  if (process.env.DAIGAKU_TEST_LAN && arguments.length === 0) return [process.env.DAIGAKU_TEST_LAN];
  const priv = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  const out = [];
  for (const [name, list] of Object.entries(ifaces))
    for (const i of list ?? [])
      if (i.family === 'IPv4' && !i.internal && priv(i.address)) out.push({name, address: i.address});
  const rank = (n) =>
    /^(en0|wlan|wi-?fi|wlp|eth0|en1|イーサネット)/i.test(n) ? 0 : /^(vmnet|vbox|docker|br-|utun|veth)/i.test(n) ? 2 : 1;
  return out.sort((a, b) => rank(a.name) - rank(b.name)).map((x) => x.address);
}

/**
 * @param {{devices, api, log, now?, onMoved?, tls?}} deps devices は devices.js、api は api.js の窓口。
 *   onMoved：つないだスマホが前と違う所・ブラウザからつながったとき（パソコンで知らせる）
 *   tls：https の証明書を返す関数（() => {key, cert}。tls-cert.js の certFor）。なければ http だけ
 */
export function createMobileServer({
  devices,
  api,
  pad = null,
  log = () => {},
  now = () => Date.now(),
  onMoved = () => {},
  tls = null
}) {
  let server = null;
  let port = null;
  let tlsServer = null;
  let tlsPort = null;
  let tlsCert = null; // いま使っている証明書（PEM）
  let inflight = 0;
  let polls = 0;
  let padHtml = null; // padIndexHtml の結果（1 回だけ作る）
  const seen = new Map(); // 端末 → Map(nonce → 期限)

  const replay = (deviceId, nonce) => {
    const t = now();
    let m = seen.get(deviceId);
    if (!m) seen.set(deviceId, (m = new Map()));
    for (const [n, exp] of m) if (exp < t) m.delete(n);
    if (m.has(nonce)) return true;
    m.set(nonce, t + 2 * MAX_SKEW_MS);
    return false;
  };

  /**
   * 本文を読む。先に Content-Length を見て、大きすぎれば読まずに断る。決めた長さより多く届いたら打ち切る。
   * 戻りは Buffer（形が悪ければ null）
   */
  const readExact = async (req, len, head = Buffer.alloc(0)) => {
    const chunks = [head];
    let size = head.length;
    for await (const c of req) {
      size += c.length;
      if (size > len) return null;
      chunks.push(c);
    }
    return size === len ? Buffer.concat(chunks) : null;
  };
  /** 先頭の n バイト（端末の番号）だけ読む。残りは読まずに置いておく（続きは readExact で） */
  const readHead = (req, n) =>
    new Promise((resolve) => {
      let buf = Buffer.alloc(0);
      const done = (v) => {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onEnd);
        req.pause();
        resolve(v);
      };
      const onData = (c) => {
        buf = Buffer.concat([buf, c]);
        if (buf.length >= n) done(buf);
      };
      const onEnd = () => done(buf.length >= n ? buf : null);
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onEnd);
    });

  const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(body);
  };

  // 断ったときは、残りの本文を読まずに接続を閉じる（ため込まない）
  const refuse = (req, res, status, text) => {
    res.setHeader('Connection', 'close');
    res.on('finish', () => req.destroy());
    send(res, status, text);
  };

  /**
   * 窓口。LAN の誰でも送れるので、本文は端末を確かめてから読む：
   * Content-Length を先に見る（大きすぎれば 413）→ 先頭 26 バイトの端末の番号で鍵を引く（知らなければ 403）→ 残りを読む。
   * 同時に受けるのは INFLIGHT_MAX 件まで（それより多ければ 503）
   */
  async function onApi(req, res) {
    const len = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(len) || len < HEAD + 40) return refuse(req, res, 400, 'bad request');
    if (len > PAD_BODY_MAX) return refuse(req, res, 413, 'too large');
    let held = false;
    // 同時の数に入れるのは、端末を確かめたあと（鍵のない人が、本文を送らない接続を並べて窓口をふさげないように）
    const hold = () => {
      if (inflight >= INFLIGHT_MAX) return false;
      inflight++;
      held = true;
      return true;
    };
    // 知らせを待つ要求（pad.poll）は長く居座るので、窓口の同時の数から外す
    const release = () => {
      if (held) inflight--;
      held = false;
    };
    // 先頭（端末の番号）をいつまでも送ってこない接続は切る
    const slow = setTimeout(() => req.destroy(), HEAD_TIMEOUT_MS);
    slow.unref?.();
    try {
      await api1(req, res, len, release, hold, () => clearTimeout(slow));
    } finally {
      clearTimeout(slow);
      release();
    }
  }

  async function api1(req, res, len, release = () => {}, hold = () => true, gotHead = () => {}) {
    const head = await readHead(req, HEAD);
    gotHead();
    if (!head) return refuse(req, res, 400, 'bad request');
    const deviceId = head.subarray(0, HEAD).toString('ascii');
    const key = await devices.keyOf(deviceId);
    if (!key) return refuse(req, res, 403, 'unknown device'); // スマホは「つなぎ直してください」を出す
    if (!hold()) return refuse(req, res, 503, 'busy');
    if (len > BODY_MAX && !devices.isFull?.(deviceId)) return refuse(req, res, 413, 'too large');
    // QR を読んだだけの端末が送れるのはあいさつ（小さい）だけ
    if (devices.isPending(deviceId) && len > PENDING_MAX) return refuse(req, res, 413, 'too large');
    const body = await readExact(req, len, head).catch(() => null);
    if (!body) return refuse(req, res, 400, 'bad request');
    let msg;
    try {
      msg = open(key, new Uint8Array(body.buffer, body.byteOffset + HEAD, body.length - HEAD));
    } catch {
      return send(res, 400, 'bad request');
    }
    const {ch, arg, t} = msg.value ?? {};
    if (!Number.isFinite(t) || Math.abs(now() - t) > MAX_SKEW_MS) return send(res, 409, 'clock'); // 時刻のずれ・古い要求
    if (replay(deviceId, msg.nonce)) return send(res, 409, 'replay');
    let result;
    if (devices.isPending(deviceId)) {
      // QR を読んだ直後：あいさつ（hello）だけ受け、鍵を新しくして返す（答えは QR の鍵で包む。QR の鍵はこれで使えなくなる）
      if (ch !== 'hello') return send(res, 403, 'unknown device');
      const fresh = await devices.activate(deviceId, req.headers['user-agent']);
      return send(res, 200, Buffer.from(seal(key, {key: fresh})), 'application/octet-stream');
    }
    const moved = devices.seen(deviceId, {ip: req.socket.remoteAddress, ua: req.headers['user-agent']});
    if (moved) {
      log(`mobile: ${moved.name} が前と違う所（${moved.from} → ${moved.to}）からつながりました`);
      onMoved(moved);
    }
    if (ch === 'hello') result = {ok: true};
    else if (ch === 'pad.status') result = {full: !!devices.isFull?.(deviceId)};
    else if (ch === 'pad.call' || ch === 'pad.poll') {
      const a = arg && typeof arg === 'object' ? arg : {};
      if (!pad) result = {error: 'この操作はスマホからはできません'};
      else if (!devices.isFull?.(deviceId))
        result = {
          error:
            'パソコンと同じ画面は、まだ使えません。パソコンの 設定 → スマホ で、この端末の「パソコンと同じ画面」をオンにしてください',
          notFull: true
        };
      else if (ch === 'pad.call') result = await pad.call(a);
      else {
        release();
        if (polls >= POLL_MAX) result = {events: [], reset: false, busy: true};
        else {
          polls++;
          try {
            result = await pad.poll(deviceId, a);
          } catch (e) {
            result = {error: e.message};
          } finally {
            polls--;
          }
        }
      }
    } else if (!Object.hasOwn(api, ch)) result = {error: 'この操作はスマホからはできません'};
    else
      try {
        result = (await api[ch](arg && typeof arg === 'object' ? arg : {})) ?? {};
      } catch (e) {
        log(`mobile ${ch}: ${e.message}`);
        result = {error: e.message};
      }
    send(res, 200, Buffer.from(seal(key, result)), 'application/octet-stream');
  }

  async function onRequest(req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'POST' && url.pathname === '/m/api') return onApi(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    if (url.pathname === '/') {
      res.writeHead(302, {Location: '/m/'});
      return res.end();
    }
    if (['/p', '/p/', '/m/p', '/m/p/'].includes(url.pathname)) {
      res.writeHead(302, {Location: PAD_INDEX});
      return res.end();
    }
    if (url.pathname === PAD_INDEX) {
      padHtml ??= padIndexHtml(await fsp.readFile(path.join(SRC, 'renderer', 'index.html'), 'utf8'));
      res.writeHead(200, {
        'Content-Type': TYPES['.html'],
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      });
      return res.end(req.method === 'HEAD' ? undefined : padHtml);
    }
    const file = staticFile(url.pathname);
    if (!file) return send(res, 404, 'not found');
    const st = await fsp.stat(file).catch(() => null);
    if (!st?.isFile()) return send(res, 404, 'not found');
    // 変わっていなければ送り直さない（ブラウザが覚えている写しを使う）。パソコンと同じ画面は画面のファイルが多く
    // （JS・CSS・フォント・3D モデル）、開くたびに全部を送り直すと重い
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const head = {
      'Content-Type': TYPES[path.extname(file).toLowerCase()],
      'Cache-Control': 'no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, head);
      return res.end();
    }
    const data = await fsp.readFile(file).catch(() => null);
    if (!data) return send(res, 404, 'not found');
    res.writeHead(200, head);
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return {
    get port() {
      return port;
    },
    /** https の番号（始めていなければ null）。スマホを追加する QR はこちらへ（カメラを使えるページ） */
    get tlsPort() {
      return tlsPort;
    },
    get running() {
      return !!server;
    },
    /** 始める。決めた番号が使えなければ空いている番号で */
    async start(want = DEFAULT_PORT, wantTls = DEFAULT_TLS_PORT) {
      if (server) return port;
      const listen = (p, make) =>
        new Promise((resolve, reject) => {
          const s = make((req, res) =>
            onRequest(req, res).catch((e) => {
              log(`mobile: ${e.message}`);
              if (!res.headersSent) send(res, 500, 'error');
            })
          );
          s.maxConnections = CONNECTIONS_MAX;
          s.headersTimeout = 20_000;
          s.requestTimeout = 120_000; // 写真 1 枚を送るのに十分な長さ。それより遅い送り方で居座らせない
          s.once('error', reject);
          s.listen(p, '0.0.0.0', () => resolve(s));
        });
      const either = async (p, make) => {
        try {
          return await listen(p, make);
        } catch (e) {
          if (e.code !== 'EADDRINUSE') throw e;
          return listen(0, make);
        }
      };
      server = await either(want, (h) => http.createServer(h));
      port = server.address().port;
      log(`mobile: listening on ${port}`);
      // https（カメラを使えるページ）。作れなくても http は続ける
      if (tls) {
        try {
          const {key, cert} = await tls();
          tlsCert = cert;
          tlsServer = await either(wantTls, (h) => https.createServer({key, cert}, h));
          tlsPort = tlsServer.address().port;
          log(`mobile: https on ${tlsPort}`);
        } catch (e) {
          log(`mobile: https を始められませんでした：${e.message}`);
          tlsServer = null;
          tlsPort = null;
        }
      }
      return port;
    },
    /** https の証明書を確かめ直す（LAN の番号が変わったら作り直したものに入れ替える）。スマホを追加する QR を出す前に */
    async refreshTls() {
      if (!tls || !tlsServer) return;
      const {key, cert} = await tls();
      if (cert !== tlsCert) {
        tlsServer.setSecureContext({key, cert});
        tlsCert = cert;
        log('mobile: https の証明書を作り直しました');
      }
    },
    async stop() {
      if (!server) return;
      const all = [server, tlsServer].filter(Boolean);
      server = null;
      port = null;
      tlsServer = null;
      tlsPort = null;
      tlsCert = null;
      await Promise.all(
        all.map(
          (s) =>
            new Promise((resolve) => {
              s.close(() => resolve());
              s.closeAllConnections?.();
            })
        )
      );
    }
  };
}
