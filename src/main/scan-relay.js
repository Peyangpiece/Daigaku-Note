// アナログノートの取り込みを、スマホで撮る（docs/SPEC-SCAN.md §3）。パソコンの取り込みの窓が開いているあいだ、
// スマホ（スマホ連携。docs/MOBILE.md）から撮った写真を受け、その窓に渡して読ませ、読めたかをスマホに返す。
// 写真はパソコンに残さない（窓で読んで線を取り出すだけ）
import {ulid} from '../shared/ids.js';

export const RELAY_TIMEOUT_MS = 60_000; // 窓が 1 枚を読み終えるのを待つ長さ

/**
 * @param {{timeoutMs?: number}} [opt]
 * 窓（frame）は send(channel, payload) を持つもの（Electron の WebFrameMain）
 */
export function createScanRelay({timeoutMs = RELAY_TIMEOUT_MS} = {}) {
  let session = null; // {id, frame, label}
  const waiting = new Map(); // 写真の番号 → {resolve, timer, sessionId}

  const settle = (photoId, result) => {
    const w = waiting.get(photoId);
    if (!w) return false;
    clearTimeout(w.timer);
    waiting.delete(photoId);
    w.resolve(result);
    return true;
  };
  const drop = (sessionId, message) => {
    for (const [photoId, w] of waiting) if (w.sessionId === sessionId) settle(photoId, {ok: false, message});
  };

  return {
    /** 取り込みの窓が開いた：スマホから受け始める（前の窓の分は打ち切る）。戻り：番号 */
    open(frame, label) {
      if (session) drop(session.id, 'パソコンの取り込みの窓が開き直されました。もう一度撮ってください');
      session = {id: ulid(), frame, label: String(label ?? '').slice(0, 120)};
      return session.id;
    },
    /** 取り込みの窓が閉じた */
    close(id) {
      if (!session || session.id !== id) return;
      drop(id, 'パソコンの取り込みの窓が閉じられました');
      session = null;
    },
    /** スマホに見せる、いま受けている窓（なければ null） */
    current() {
      return session ? {id: session.id, label: session.label} : null;
    },
    /** スマホから 1 枚：窓に渡し、読めたか（{ok, message, pages}）を待つ */
    deliver(id, bytes) {
      if (!session || session.id !== id)
        return Promise.resolve({ok: false, message: 'パソコンで「アナログノート…」の窓が開いていません'});
      const photoId = ulid();
      const s = session;
      return new Promise((resolve) => {
        const timer = setTimeout(
          () => settle(photoId, {ok: false, message: 'パソコンから答えがありませんでした。もう一度撮ってください'}),
          timeoutMs
        );
        waiting.set(photoId, {resolve, timer, sessionId: s.id});
        try {
          s.frame.send('scan.photo', {id: s.id, photoId, bytes});
        } catch {
          settle(photoId, {ok: false, message: 'パソコンの取り込みの窓に渡せませんでした'});
        }
      });
    },
    /** 窓が読み終えた（renderer/scan-dialog.js） */
    reply(photoId, result) {
      return settle(photoId, {
        ok: result?.ok === true,
        message: String(result?.message ?? '').slice(0, 200),
        pages: Number.isInteger(result?.pages) ? result.pages : 0
      });
    }
  };
}
