// はじめから入っているシール（SPEC-KISEKAE §6.1）。SVG をその場で作る（画像ファイルを持たない）。
// 「しるし」は授業の状態を表す意味のあるシール、「飾り」は飾り。id は builtin-…（テンプレートの assets には入れない）

const FONT = "'Hiragino Maru Gothic ProN','Hiragino Sans','Yu Gothic','Meiryo',sans-serif";
// 白いふち（シールらしく）：同じ形を白い太線で下に描く
const outlined = (shape) => `<g stroke="#fff" stroke-width="7" stroke-linejoin="round">${shape}</g>${shape}`;
const label = (text, fill, {ink = '#fff', w = 92} = {}) => {
  const x = (100 - w) / 2;
  return `${outlined(`<rect x="${x}" y="28" width="${w}" height="44" rx="12" fill="${fill}"/>`)}<text x="50" y="58.5" text-anchor="middle" font-family="${FONT}" font-size="${text.length > 2 ? 21 : 25}" font-weight="700" fill="${ink}">${text}</text>`;
};
const star = (cx, cy, r1, r2, n = 5) =>
  Array.from({length: n * 2}, (_, i) => {
    const a = (Math.PI / n) * i - Math.PI / 2;
    const r = i % 2 ? r2 : r1;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

const DEFS = [
  // しるし
  ['exam', '試験', 'mark', label('試験', '#e5484d')],
  ['task', '課題', 'mark', label('課題', '#f08c00')],
  ['quiz', '小テスト', 'mark', label('小テスト', '#7048e8', {w: 96})],
  ['important', '重要', 'mark', label('重要', '#d6336c')],
  ['cancel', '休講', 'mark', label('休講', '#868e96')],
  [
    'done',
    '済',
    'mark',
    `${outlined('<circle cx="50" cy="50" r="34" fill="#2f9e44"/>')}<text x="50" y="61" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="700" fill="#fff">済</text>`
  ],
  [
    'hanamaru',
    '花丸',
    'mark',
    `<g fill="none" stroke-linecap="round"><g stroke="#fff" stroke-width="13"><path d="M50 20c18 0 30 12 30 28S66 78 48 78 20 66 22 48 36 26 52 30s20 18 10 26-24 0-18-8"/></g><path d="M50 20c18 0 30 12 30 28S66 78 48 78 20 66 22 48 36 26 52 30s20 18 10 26-24 0-18-8" stroke="#e03131" stroke-width="6"/></g>`
  ],
  [
    'check',
    'チェック',
    'mark',
    `${outlined('<circle cx="50" cy="50" r="34" fill="#1c7ed6"/>')}<path d="M34 51l11 11 22-24" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
  ],
  // 飾り
  ['star', '星', 'deco', outlined(`<polygon points="${star(50, 53, 40, 17)}" fill="#fcc419"/>`)],
  [
    'heart',
    'ハート',
    'deco',
    outlined(
      '<path d="M50 82 18 50c-10-10-10-26 2-34 10-7 22-3 30 7 8-10 20-14 30-7 12 8 12 24 2 34z" fill="#ff6b9a"/>'
    )
  ],
  ['arrow', '矢印', 'deco', outlined('<path d="M14 42h44V24l30 26-30 26V58H14z" fill="#4dabf7"/>')],
  ['crown', '王冠', 'deco', outlined('<path d="M16 72 20 32l18 18 12-26 12 26 18-18 4 40z" fill="#fab005"/>')],
  [
    'note',
    '音符',
    'deco',
    outlined('<path d="M40 22l36-8v46a12 10 0 1 1-6-9V30l-24 6v34a12 10 0 1 1-6-9z" fill="#845ef7"/>')
  ],
  [
    'cloud',
    '雲',
    'deco',
    outlined('<path d="M28 72a16 16 0 0 1-2-32 22 22 0 0 1 42-6 16 16 0 0 1 8 38z" fill="#a5d8ff"/>')
  ],
  [
    'flower',
    '花',
    'deco',
    `${outlined(`<g fill="#ffa8c5">${[0, 72, 144, 216, 288].map((d) => `<circle cx="50" cy="28" r="15" transform="rotate(${d} 50 50)"/>`).join('')}</g>`)}<circle cx="50" cy="50" r="11" fill="#ffd43b"/>`
  ],
  [
    'clover',
    '四つ葉',
    'deco',
    `${outlined(`<g fill="#51cf66">${[0, 90, 180, 270].map((d) => `<path d="M50 50C40 40 32 22 42 16s8 10 8 10 0-16 10-10-2 24-10 34z" transform="rotate(${d} 50 50)"/>`).join('')}</g>`)}<path d="M50 50l10 30" stroke="#2f9e44" stroke-width="5" stroke-linecap="round"/>`
  ],
  [
    'sun',
    '太陽',
    'deco',
    `<g stroke="#ff922b" stroke-width="7" stroke-linecap="round">${Array.from({length: 8}, (_, i) => `<path d="M50 10v10" transform="rotate(${i * 45} 50 50)"/>`).join('')}</g>${outlined('<circle cx="50" cy="50" r="22" fill="#ffd43b"/>')}`
  ],
  ['moon', '月', 'deco', outlined('<path d="M62 14a36 36 0 1 0 24 56A30 30 0 0 1 62 14z" fill="#ffe066"/>')],
  [
    'pencil',
    '鉛筆',
    'deco',
    outlined(
      '<g transform="rotate(-40 50 50)"><rect x="20" y="40" width="48" height="20" fill="#fab005"/><path d="M68 40l18 10-18 10z" fill="#f8d7a8"/><path d="M80 46.5l6 3.5-6 3.5z" fill="#343a40"/><rect x="12" y="40" width="10" height="20" rx="3" fill="#ff8787"/></g>'
    )
  ],
  [
    'bubble',
    '吹き出し',
    'deco',
    `${outlined('<path d="M18 24h64a8 8 0 0 1 8 8v30a8 8 0 0 1-8 8H44L28 84V70H18a8 8 0 0 1-8-8V32a8 8 0 0 1 8-8z" fill="#fff3bf"/>')}<g fill="#868e96"><circle cx="34" cy="47" r="4.5"/><circle cx="50" cy="47" r="4.5"/><circle cx="66" cy="47" r="4.5"/></g>`
  ],
  [
    'sparkle',
    'きらきら',
    'deco',
    outlined(
      `<polygon points="${star(40, 46, 30, 8, 4)}" fill="#ffd43b"/><polygon points="${star(74, 26, 14, 4, 4)}" fill="#ffd43b"/><polygon points="${star(72, 74, 11, 3, 4)}" fill="#ffd43b"/>`
    )
  ]
];

export const BUILTIN_STICKERS = DEFS.map(([key, name, kind, body]) => ({
  id: `builtin-${key}`,
  name,
  kind,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112" width="112" height="112">${body}</svg>`
}));
export const BUILTIN_STICKER_KIND = {mark: 'しるし', deco: '飾り'};
const IDS = new Set(BUILTIN_STICKERS.map((s) => s.id));
export const isBuiltinSticker = (id) => IDS.has(id);
/** シールの画像（data: URL）。はじめから入っているシールだけ */
export const builtinStickerUrl = (id) => {
  const s = BUILTIN_STICKERS.find((x) => x.id === id);
  // ' ( ) も符号にする（CSS の url('…') や style 属性の中に入れても壊れないように）
  return s
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
    : '';
};
