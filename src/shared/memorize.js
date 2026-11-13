// 暗記モード（SPEC §9.3.3）の順番と記録。画面（renderer/views/viewer/memorize.js）とテストが使う。副作用なし

/** 文字隠しのマーカーを、読む順に並べる：ページ → 上から → 左から。PDF の座標は下が 0 なので、上の辺（y + h）の大きいほうが上 */
export function memoOrder(masks) {
  const top = (a) => a.rect.y + a.rect.h;
  return [...masks].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    // 同じ行（上の辺の差が、低いほうの高さの半分より小さい）なら左から
    const same = Math.abs(top(a) - top(b)) < Math.min(a.rect.h, b.rect.h) / 2;
    return same ? a.rect.x - b.rect.x : top(b) - top(a);
  });
}

/**
 * 1 周の進み方。keys：問う順の鍵。
 * answer(ok)：いまの 1 つに「覚えた」（true）・「まだ」（false）を付けて次へ。終わったら done が true。
 * again()：「まだ」だけでもう 1 周
 */
export function memoRound(keys) {
  const st = {keys: [...keys], index: 0, known: [], unknown: [], done: keys.length === 0};
  return {
    get state() {
      return st;
    },
    current: () => (st.done ? null : st.keys[st.index]),
    answer(ok) {
      if (st.done) return;
      (ok ? st.known : st.unknown).push(st.keys[st.index]);
      st.index++;
      if (st.index >= st.keys.length) st.done = true;
    },
    again() {
      const next = st.unknown;
      Object.assign(st, {keys: next, index: 0, known: [], unknown: [], done: next.length === 0});
    }
  };
}
