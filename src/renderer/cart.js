// ショップのカート（SPEC §15）。入れた品の id をこのパソコンに残す（localStorage。注文するまでの一時的なもので、設定には入れない）
const KEY = 'daigaku.cart';

function load() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
function save(ids) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // 保存できなくても、この画面の間は使える
  }
}

let ids = load();

export const cart = {
  ids: () => [...ids],
  count: () => ids.length,
  has: (id) => ids.includes(id),
  /** 入れる。もう入っていれば false */
  add(id) {
    if (ids.includes(id)) return false;
    ids = [...ids, id];
    save(ids);
    return true;
  },
  remove(id) {
    ids = ids.filter((x) => x !== id);
    save(ids);
  },
  clear() {
    ids = [];
    save(ids);
  },
  /** 持っている品・ない品を外す（買ったあと、別のパソコンの設定を読んだあとなど） */
  prune(keep) {
    const next = ids.filter(keep);
    if (next.length !== ids.length) {
      ids = next;
      save(ids);
    }
  }
};
