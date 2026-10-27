// スマホのページ：パソコンとのやりとり（docs/MOBILE.md §2・§3）。鍵はこのブラウザの中（localStorage）にだけ持つ
import {fromB64, open, readPairHash, seal, toB64} from '/m/shared/mobile-wire.js';

const STORE = 'daigaku-note.pair';
let pair = null; // {deviceId, key, fresh}

/** つないでいない（鍵がない・パソコンで外された） */
export class NotPaired extends Error {
  constructor() {
    super('パソコンとつながっていません');
  }
}
/** パソコンに届かない（同じ Wi-Fi でない・大学ノートが閉じている・「スマホとつなぐ」がオフ） */
export class Unreachable extends Error {
  constructor() {
    super('パソコンに届きません');
  }
}

const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify({deviceId: pair.deviceId, key: toB64(pair.key)}));
  } catch {
    // 保存できないブラウザ（プライベートブラウズなど）：開いている間だけつながる
  }
};

/** 鍵を読む：QR から開いたなら URL の # から（すぐ消す）、そうでなければ前に覚えたもの。戻りは 'new'・'stored'・'none' */
export function initPairing() {
  const fromHash = readPairHash(location.hash);
  if (fromHash) {
    pair = {...fromHash, fresh: true};
    history.replaceState(null, '', '/m/#/');
    return 'new';
  }
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (s?.deviceId && s?.key) pair = {deviceId: s.deviceId, key: fromB64(s.key)};
  } catch {
    pair = null;
  }
  return pair ? 'stored' : 'none';
}

export const paired = () => !!pair && !pair.fresh;

/** 鍵を捨てる（パソコンで外された・つなぎ直す） */
export function forget() {
  pair = null;
  try {
    localStorage.removeItem(STORE);
  } catch {
    // 消せなくてもよい
  }
}

/** QR を読んだ直後：あいさつして、パソコンが作った新しい鍵に入れ替えて覚える（QR の鍵はこれで使えなくなる） */
export async function hello() {
  const r = await call('hello');
  if (r?.key instanceof Uint8Array) pair.key = r.key;
  pair.fresh = false;
  save();
}

/** パソコンの窓口を呼ぶ。答えの {error} は Error にして投げる */
export async function call(ch, arg = {}) {
  if (!pair) throw new NotPaired();
  const head = new TextEncoder().encode(pair.deviceId);
  const sealed = seal(pair.key, {ch, arg, t: Date.now()});
  const body = new Uint8Array(head.length + sealed.length);
  body.set(head, 0);
  body.set(sealed, head.length);
  let res;
  try {
    res = await fetch('/m/api', {method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body});
  } catch {
    throw new Unreachable();
  }
  if (res.status === 403) {
    forget();
    throw new NotPaired();
  }
  if (res.status === 409) throw new Error('スマホとパソコンの時計が 5 分以上ずれています。時刻を合わせてください');
  // QR を読んだ直後に開けない：その QR はもう使われた（QR は 1 回だけ）
  if (res.status === 400 && pair.fresh) {
    forget();
    throw new Error('この QR はもう使われています。パソコンで「スマホを追加」をもう一度押してください');
  }
  if (!res.ok) throw new Error('パソコンとのやりとりに失敗しました');
  const {value} = open(pair.key, new Uint8Array(await res.arrayBuffer()));
  if (value?.error) throw new Error(value.error);
  return value;
}
