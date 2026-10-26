// 見た目を安定させるための小さなハッシュ（テープの角度・付箋の傾き）。Node と画面の両方で動く（TextEncoder）。副作用なし
/** FNV-1a 32 ビット */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(String(str))) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** マスキングテープの角度：−6〜+6 度。授業 ID から決める（毎回同じ） */
export const tapeAngle = (id) => (hash32(id) % 13) - 6;
