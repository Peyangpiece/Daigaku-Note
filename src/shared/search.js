// 探す言葉と本文の比べ方（main/search.js・repo.js が使う。副作用なし）。
// PDF の編集画面の検索（renderer/views/viewer/find.js）と同じ：空白は無視し、全角・半角と大文字・小文字の違いも無視する（NFKC）
const SNIPPET = 28; // 見つけた所の前後に見せる文字数

/** 比べる形：NFKC・小文字・空白なし */
export const normText = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');

/** 探す言葉（空白で区切った言葉をすべて含むものを探す） */
export const termsOf = (q) =>
  String(q ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);

/** SQL の LIKE に渡す形（% と _ はそのままの文字として探す。ESCAPE '\\' と組で使う） */
export const likeOf = (term) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * もとの文字（text）の中で term（比べる形）が最初に出る所の前後を取り出す。戻りは {before, match, after}（なければ null）。
 * 比べる形ともとの文字は長さが違う（空白を除く・NFKC で 1 文字が数文字になる）ので、もとの文字を 1 つずつ比べる形にして位置を対応させる
 */
export function snippetOf(text, term, around = SNIPPET) {
  const src = [...String(text ?? '')];
  let norm = '';
  const at = []; // 比べる形の i 文字目が、もとの何文字目から来たか
  src.forEach((ch, i) => {
    for (const c of normText(ch)) {
      norm += c;
      at.push(i);
    }
  });
  const hit = norm.indexOf(term);
  if (hit < 0) return null;
  const from = at[hit];
  const to = at[hit + term.length - 1] + 1;
  const clean = (s) => s.replace(/\s+/g, ' ');
  const start = Math.max(0, from - around);
  const end = Math.min(src.length, to + around);
  return {
    before: (start > 0 ? '…' : '') + clean(src.slice(start, from).join('')).trimStart(),
    match: clean(src.slice(from, to).join('')),
    after: clean(src.slice(to, end).join('')).trimEnd() + (end < src.length ? '…' : '')
  };
}
