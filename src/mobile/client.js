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
/** パソコンが込み合っている（同時に受ける要求の数を超えた）。少し待って送り直す */
export class Busy extends Error {
  constructor() {
    super('パソコンが込み合っています。少し待ってから試してください');
  }
}
/** パソコンに届かない（同じ Wi-Fi でない・パレットノートが閉じている・「スマホとつなぐ」がオフ） */
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

/** ホーム画面に追加したアイコンから開いている（ブラウザのタブではない） */
export const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true ||
  /PaletteNoteApp/.test(navigator.userAgent); // iPad のアプリ（ipad/。アプリの中で開いたページ）

/**
 * 鍵を読む。戻りは 'new'（いまつなぐ）・'stored'（前につないだ）・'install'（QR からブラウザで開いた：先にホーム画面に追加）・'none'。
 * QR の URL の # の鍵はすぐ消す。ブラウザのタブで開いたときは使わない（iPhone では、ホーム画面に追加したアイコンは
 * ブラウザと別に覚えるので、ここでつなぐとアイコンからは使えず、QR も 1 回きりで使い切ってしまう）。
 * アイコンから開いて、パソコンの QR を読んでつなぐ（pairFrom）
 */
export function initPairing() {
  const fromHash = readPairHash(location.hash);
  if (fromHash) history.replaceState(null, '', '/m/#/');
  if (fromHash && standalone()) {
    pair = {...fromHash, fresh: true};
    return 'new';
  }
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (s?.deviceId && s?.key) pair = {deviceId: s.deviceId, key: fromB64(s.key)};
  } catch {
    pair = null;
  }
  if (pair) return 'stored';
  return fromHash ? 'install' : 'none';
}

/** 読んだパソコンの QR（URL）でつなぐ準備をする。戻り：つなげる形なら true（このあと hello） */
export function pairFrom(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const p = readPairHash(u.hash);
  if (!p) return false;
  pair = {...p, fresh: true};
  return true;
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
  if (res.status === 503) throw new Busy();
  if (res.status === 413) throw new Error('送るものが大きすぎます');
  // QR を読んだ直後に開けない：その QR はもう使われた（QR は 1 回だけ）
  if (res.status === 400 && pair.fresh) {
    forget();
    throw new Error(
      'この QR はもう使われています。パソコンに出ている新しい QR を読んでください（なければ、アナログノートの窓の「QR を出す」か、設定 → スマホとつなぐ の「スマホを追加」で出せます）'
    );
  }
  if (!res.ok) throw new Error('パソコンとのやりとりに失敗しました');
  const {value} = open(pair.key, new Uint8Array(await res.arrayBuffer()));
  if (value?.error) throw new Error(value.error);
  return value;
}
