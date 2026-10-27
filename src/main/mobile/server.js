// スマホ連携（docs/MOBILE.md）：同じ Wi-Fi のスマホにページを配り、暗号化した窓口（POST /m/api）に答える。
// - 配るのは画面のファイル（src/mobile・src/shared・pdf.js・@noble/ciphers）だけ。資料・注釈・問題は窓口からだけ
// - 窓口の中身：端末の番号（26 文字）＋ seal した {ch, arg, t}。答えも同じ鍵で seal する
// - 5 分より古い・先の要求と、同じ番号（nonce）の 2 回目は受け付けない（盗み見た通信の送り直しを通さない）
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {promises as fsp} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {MAX_SKEW_MS, open, seal} from '../../shared/mobile-wire.js';

export const DEFAULT_PORT = 47390;
const BODY_MAX = 48 * 1024 * 1024; // 写真 1 枚（30MB）の base64（4/3 倍）＋余り。スマホは写真を 1 枚ずつ送る
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
    ['/m/vendor/noble/', pkgDir('@noble/ciphers', 'chacha.js')]
  ];
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
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
 * @param {{devices, api, log, now?}} deps devices は devices.js、api は api.js の窓口
 */
export function createMobileServer({devices, api, log = () => {}, now = () => Date.now()}) {
  let server = null;
  let port = null;
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

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > BODY_MAX) {
          reject(new Error('too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
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

  async function onApi(req, res) {
    const body = await readBody(req).catch(() => null);
    if (!body || body.length < 26 + 40) return send(res, 400, 'bad request');
    const deviceId = body.subarray(0, 26).toString('ascii');
    const key = await devices.keyOf(deviceId);
    if (!key) return send(res, 403, 'unknown device'); // スマホは「つなぎ直してください」を出す
    let msg;
    try {
      msg = open(key, new Uint8Array(body.buffer, body.byteOffset + 26, body.length - 26));
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
    devices.seen(deviceId);
    if (ch === 'hello') result = {ok: true};
    else if (!Object.hasOwn(api, ch)) result = {error: 'この操作はスマホからはできません'};
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
    const file = staticFile(url.pathname);
    if (!file) return send(res, 404, 'not found');
    const data = await fsp.readFile(file).catch(() => null);
    if (!data) return send(res, 404, 'not found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()],
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return {
    get port() {
      return port;
    },
    get running() {
      return !!server;
    },
    /** 始める。決めた番号が使えなければ空いている番号で */
    async start(want = DEFAULT_PORT) {
      if (server) return port;
      const listen = (p) =>
        new Promise((resolve, reject) => {
          const s = http.createServer((req, res) =>
            onRequest(req, res).catch((e) => {
              log(`mobile: ${e.message}`);
              if (!res.headersSent) send(res, 500, 'error');
            })
          );
          s.once('error', reject);
          s.listen(p, '0.0.0.0', () => resolve(s));
        });
      try {
        server = await listen(want);
      } catch (e) {
        if (e.code !== 'EADDRINUSE') throw e;
        server = await listen(0);
      }
      port = server.address().port;
      log(`mobile: listening on ${port}`);
      return port;
    },
    async stop() {
      if (!server) return;
      const s = server;
      server = null;
      port = null;
      await new Promise((resolve) => {
        s.close(() => resolve());
        s.closeAllConnections?.();
      });
    }
  };
}
