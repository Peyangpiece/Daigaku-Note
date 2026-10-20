// 日本語の折り返し（SPEC §8.0.5）。画面にも Node のテストにも読み込めるよう、ほかのモジュールに頼らない
const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

/**
 * 日本語の名前を、語のまとまりの境目でだけ折り返せるようにする（エスケープ済みの HTML に <wbr> を入れる）。
 * 文字の種類（漢字・カタカナ・ひらがな・英数字）が変わるところをまとまりの境目とし、漢字・カタカナ・英数字・開き括弧の前と「・」の後で折り返す。
 * ひらがな・閉じ括弧・記号の前と、1 文字の漢字（「〜論」「〜史」）の前では折り返さない。CSS の .ja-wrap（keep-all）と組み合わせる
 */
export function jaWrap(text) {
  const kind = (ch) =>
    /\p{Script=Han}/u.test(ch)
      ? 'han'
      : /[\p{Script=Katakana}ー]/u.test(ch)
        ? 'kata'
        : /\p{Script=Hiragana}/u.test(ch)
          ? 'hira'
          : /[A-Za-z0-9]/.test(ch)
            ? 'latin'
            : /[（(「『【［]/.test(ch)
              ? 'open'
              : 'other';
  const runs = [];
  for (const ch of String(text ?? '')) {
    const k = kind(ch);
    if (runs.length && runs.at(-1).k === k && k !== 'open') runs.at(-1).s += ch;
    else runs.push({k, s: ch});
  }
  return runs
    .map((r, i) => {
      const prev = runs[i - 1];
      const brk =
        prev &&
        (prev.s.endsWith('・') ||
          (['han', 'kata', 'latin', 'open'].includes(r.k) &&
            prev.k !== 'open' &&
            !(r.k === 'han' && [...r.s].length === 1)));
      return (brk ? '<wbr>' : '') + esc(r.s);
    })
    .join('');
}
