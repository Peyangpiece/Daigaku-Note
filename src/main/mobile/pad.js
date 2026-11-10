// iPad（パソコンと同じ画面。docs/MOBILE.md §8）：パソコンの画面（src/renderer）を iPad のブラウザで動かすための窓口。
// - call：パソコンの画面の窓口（ipc/*.js の handle）を、そのまま呼ぶ。パソコンのフォルダ・窓を開くもの（PAD_DENY）は断る
// - poll：パソコンの画面への知らせ（state.changed・sync.progress など）を、iPad の画面ごとに貯めておき、長く待って渡す
// 窓口を呼ぶときは、iPad の画面を「画面（WebFrameMain）」に見立てて渡す（書いた画面以外に知らせる・アナログノートの写真を渡す）
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {isUlid} from '../../shared/ids.js';
import {
  PAD_DENY,
  PAD_EXTRA,
  PAD_FILE_MAX,
  PAD_LINK_FOLDER,
  PAD_LOCAL,
  PAD_POLL_MS,
  PAD_QUIET
} from '../../shared/pad-channels.js';
import {isOpenable} from '../sync/files.js';

const QUEUE_MAX = 300; // 1 つの画面に貯める知らせ（それより多ければ古いものを捨て、画面に全部を読み直させる）
const IDLE_MS = 60_000; // これだけ待ちに来ない画面は閉じたとみなす
const TAG = /^[A-Za-z0-9_-]{8,40}$/; // 画面の番号（iPad のページが作る乱数）

const bad = (msg) => {
  throw new Error(msg);
};
const tag = (v) => (typeof v === 'string' && TAG.test(v) ? v : bad('画面の番号が不正です'));

/**
 * 知らせの受け渡し。iPad のページ（client）ごとに列を持ち、待っている要求があればすぐ返す
 * @param {{now?: () => number, idleMs?: number, cap?: number}} [opt]
 */
export function createPadHub({now = () => Date.now(), idleMs = IDLE_MS, cap = QUEUE_MAX} = {}) {
  const clients = new Map(); // client → {deviceId, seq, queue, waiter, seenAt, reset}
  const wake = (c) => {
    const w = c.waiter;
    c.waiter = null;
    w?.();
  };
  const add = (c, ev) => {
    ev.seq = ++c.seq;
    c.queue.push(ev);
    if (c.queue.length > cap) {
      c.queue.splice(0, c.queue.length - cap);
      c.reset = true; // 取りこぼした：画面に全部を読み直させる
    }
    wake(c);
  };
  const prune = () => {
    for (const [id, c] of clients) if (!c.waiter && now() - c.seenAt > idleMs) clients.delete(id);
  };

  return {
    /** すべての iPad の画面に知らせる。except が iPad の画面なら、その画面（frame）には返さない */
    push(channel, payload, except = null) {
      prune();
      for (const [id, c] of clients)
        add(c, {ch: channel, payload, skip: except?.pad && except.client === id ? except.frame : null});
    },
    /** 1 つの画面にだけ渡す（アナログノートの写真など） */
    toFrame(client, frame, channel, payload) {
      const c = clients.get(client);
      if (!c) return false;
      add(c, {ch: channel, payload, to: frame});
      return true;
    },
    /**
     * 知らせを受け取る。after までは受け取り済み（列から消す）。なければ waitMs まで待つ。
     * reset：取りこぼした（列があふれた・パソコンのアプリが開き直された）。画面は全部を読み直す
     */
    async poll(deviceId, client, after = 0, waitMs = PAD_POLL_MS) {
      let c = clients.get(client);
      if (c && c.deviceId !== deviceId) bad('画面の番号が不正です');
      if (!c) {
        // 初めて、またはパソコンのアプリを開き直した：番号を iPad の続きから始める（受け取り済みとして消さない）
        c = {deviceId, seq: after, queue: [], waiter: null, seenAt: now(), reset: after > 0};
        clients.set(client, c);
      }
      c.seenAt = now();
      c.queue = c.queue.filter((e) => e.seq > after);
      if (!c.queue.length && !c.reset && waitMs > 0) {
        wake(c); // 前の待ちは空で返す（同じ画面が 2 つ待たない）
        await new Promise((resolve) => {
          const done = () => {
            clearTimeout(timer);
            if (c.waiter === done) c.waiter = null;
            resolve();
          };
          const timer = setTimeout(done, waitMs);
          c.waiter = done;
        });
      }
      c.seenAt = now();
      const events = c.queue.map(({seq, ch, payload, skip, to}) => ({
        seq,
        ch,
        payload,
        ...(skip ? {skip} : {}),
        ...(to ? {to} : {})
      }));
      const reset = c.reset;
      c.reset = false;
      return {events, reset, last: c.seq};
    },
    /** 端末を外した：その端末の画面の待ちを終える */
    drop(deviceId) {
      for (const [id, c] of clients)
        if (c.deviceId === deviceId) {
          clients.delete(id);
          wake(c);
        }
    },
    get size() {
      return clients.size;
    }
  };
}

/**
 * @param {{handlers: Map<string, Function>, ctx: object, repo: object, hub: ReturnType<typeof createPadHub>, log?: Function}} deps
 *   ctx：pdfExportData・readCalendarData・backupExportData・backupImportData（ipc/pdf.js・terms.js・app.js が入れる）
 */
export function createPadApi({
  handlers,
  ctx,
  repo,
  hub,
  log = () => {},
  notify = (from, ch, payload) => (ctx.notifyOthers ? ctx.notifyOthers(from, ch, payload) : hub.push(ch, payload, from))
}) {
  // iPad の画面を、パソコンの画面（WebFrameMain）に見立てる。send はその画面にだけ知らせる
  const frameOf = (client, frame) => ({
    pad: true,
    client,
    frame,
    send: (channel, payload) => hub.toFrame(client, frame, channel, payload)
  });
  const need = (fn) => fn ?? bad('この操作はまだ準備できていません。少し待ってから試してください');

  const extra = {
    /** 資料の中身（パソコンのアプリで開く代わりに、iPad で開く・保存する） */
    async 'material.data'({materialId}) {
      const m =
        repo.get('material', isUlid(materialId) ? materialId : bad('資料が不正です')) ?? bad('資料がありません');
      if (!isOpenable(m.path)) bad('この種類のファイルはアプリから開きません');
      if (m.status !== 'ok') bad('このファイルは見つかりません');
      const st = await fsp.stat(m.path).catch(() => bad('このファイルは見つかりません'));
      if (st.size > PAD_FILE_MAX) bad('90MB を超えるファイルは、パソコンで開いてください');
      const bytes = new Uint8Array(await fsp.readFile(m.path));
      repo.updateMaterial(m.id, {read_at: new Date().toISOString()});
      return {ok: true, name: path.basename(m.path), mime: m.mime ?? null, bytes};
    },
    'pdf.exportData': (arg) => need(ctx.pdfExportData)(arg),
    'term.readCalendarData': (arg) => need(ctx.readCalendarData)(arg),
    'backup.exportData': () => need(ctx.backupExportData)(),
    'backup.importData': (arg) => need(ctx.backupImportData)(arg)
  };

  return {
    /**
     * パソコンの画面の窓口を呼ぶ。答えは {r}（窓口の答えそのもの。失敗は {r: {error}}。パソコンの画面と同じ形）
     */
    async call({ch, arg, client, frame}) {
      const a = arg && typeof arg === 'object' ? arg : {};
      try {
        if (typeof ch !== 'string') bad('窓口が不正です');
        if (Object.hasOwn(PAD_DENY, ch)) return {r: {error: PAD_DENY[ch]}};
        if (PAD_LOCAL.includes(ch)) return {r: {error: 'この操作は iPad の画面で受けます'}};
        if (ch === 'folder.create' && a.mode === 'link') return {r: {error: PAD_LINK_FOLDER}};
        if (PAD_EXTRA.includes(ch)) return {r: (await extra[ch](a)) ?? null};
        const fn = handlers.get(ch) ?? bad(`窓口がありません：${ch}`);
        const sender = frameOf(tag(client), tag(frame));
        const r = (await fn(a, {senderFrame: sender, sender})) ?? null;
        // iPad で変えた：パソコンの画面（と、この iPad のほかの画面）に「変わった」を知らせる
        if (!PAD_QUIET.has(ch) && !r?.error) notify(sender, 'state.changed', {});
        return {r};
      } catch (e) {
        log(`pad ${ch}: ${e.message}`);
        return {r: {error: e.message}};
      }
    },
    /** 知らせを待つ */
    poll(deviceId, {client, after, wait} = {}) {
      const n = Number.isSafeInteger(after) && after >= 0 ? after : 0;
      const w = Number.isFinite(wait) ? Math.max(0, Math.min(PAD_POLL_MS, wait)) : PAD_POLL_MS;
      return hub.poll(deviceId, tag(client), n, w);
    }
  };
}
