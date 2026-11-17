// 2 段階認証などの画面を、パレットノートの画面（レンダラ）に写して、本人の答えを待つ（recipe-executor.js の _challenge）。
// 画面へは login.challenge で送り、答えは login.answer（ipc/connections.js）で受ける。答えがないまま時間が過ぎたら null（やめた扱い）
import {randomUUID} from 'node:crypto';

export const CHALLENGE_TIMEOUT_MS = 3 * 60 * 1000;

/** 答えの形を確かめる（画面から来るもの）。{code} は英数字と - だけ・20 文字まで */
export function cleanAnswer(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.cancel) return null;
  if (typeof a.code === 'string') {
    const code = a.code.normalize('NFKC').replace(/\s+/g, '');
    return /^[A-Za-z0-9-]{1,20}$/.test(code) ? {code} : null;
  }
  if (Number.isInteger(a.choice) && a.choice >= 0 && a.choice < 8) return {choice: a.choice};
  if (a.wait === true) return {wait: true};
  return null;
}

/**
 * send(payload)：画面へ送る（{id, label, host, title, text, code, choices} か、閉じるときは {id, done: true}）。
 * onAsk()：聞くとき（窓を前に出す・知らせを出す）
 */
export function createChallenges({send, onAsk = () => {}, timeoutMs = CHALLENGE_TIMEOUT_MS} = {}) {
  const pending = new Map(); // id → {resolve, timer, payload}
  const finish = (id, value) => {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    clearTimeout(p.timer);
    send({id, done: true});
    p.resolve(value);
    return true;
  };
  return {
    /** 聞く。戻り：答え（cleanAnswer の形）か null */
    ask(info) {
      const id = randomUUID();
      return new Promise((resolve) => {
        const timer = setTimeout(() => finish(id, null), timeoutMs);
        timer.unref?.();
        const payload = {
          id,
          label: String(info?.label ?? ''),
          host: String(info?.host ?? ''),
          title: String(info?.title ?? ''),
          text: String(info?.text ?? ''),
          code: !!info?.code,
          choices: Array.isArray(info?.choices) ? info.choices.map(String).slice(0, 8) : []
        };
        pending.set(id, {resolve, timer, payload});
        send(payload);
        try {
          onAsk();
        } catch {
          /* 窓を前に出せなくても聞く */
        }
      });
    },
    /** 画面からの答え。知らない id（時間切れのあと）は false */
    answer({id, ...rest} = {}) {
      if (typeof id !== 'string' || !pending.has(id)) return false;
      return finish(id, cleanAnswer(rest));
    },
    /** 答えを待っているもの（窓を開き直した画面が、起動したときに読み直す） */
    list() {
      return [...pending.values()].map((p) => p.payload);
    },
    get waiting() {
      return pending.size;
    }
  };
}
