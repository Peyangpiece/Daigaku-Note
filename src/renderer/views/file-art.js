// 資料のイラスト（SPEC §8.2）。種類ごとに色と小さな印を変えた、角の折れた紙。SVG をその場で描く（画像ファイルを持たない）
const KIND = {
  pdf: ['pdf', 'var(--c2)'],
  ppt: ['slide', 'var(--c6)'],
  pptx: ['slide', 'var(--c6)'],
  key: ['slide', 'var(--c6)'],
  doc: ['doc', 'var(--c4)'],
  docx: ['doc', 'var(--c4)'],
  txt: ['doc', 'var(--c4)'],
  xls: ['sheet', 'var(--c3)'],
  xlsx: ['sheet', 'var(--c3)'],
  csv: ['sheet', 'var(--c3)'],
  png: ['image', 'var(--c5)'],
  jpg: ['image', 'var(--c5)'],
  jpeg: ['image', 'var(--c5)'],
  gif: ['image', 'var(--c5)'],
  mp4: ['video', 'var(--c7)'],
  mov: ['video', 'var(--c7)'],
  mp3: ['audio', 'var(--c7)'],
  m4a: ['audio', 'var(--c7)'],
  zip: ['zip', 'var(--c1)']
};

const MARK = {
  pdf: '<path d="M14 38v-8h3.5a2.6 2.6 0 0 1 0 5.2H14 M24 30v8h3a4 4 0 0 0 0-8z M36 38v-8h6 M36 34h4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  slide: '<rect x="13" y="29" width="28" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M18 37l5-5 4 3 5-4" fill="none" stroke="currentColor" stroke-width="2"/>',
  doc: '<path d="M14 30h26 M14 35h26 M14 40h18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  sheet: '<path d="M14 29h26v12H14z M14 35h26 M23 29v12 M32 29v12" fill="none" stroke="currentColor" stroke-width="2"/>',
  image: '<rect x="13" y="28" width="28" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="20" cy="33" r="2" fill="currentColor"/><path d="M15 41l8-6 5 4 4-3 7 5" fill="none" stroke="currentColor" stroke-width="2"/>',
  video: '<rect x="13" y="28" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M33 33l8-4v12l-8-4z" fill="currentColor"/>',
  audio: '<path d="M22 40V30l14-3v10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="19" cy="40" r="3" fill="currentColor"/><circle cx="33" cy="37" r="3" fill="currentColor"/>',
  zip: '<path d="M27 26v16 M24 29h6 M24 33h6 M24 37h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  other: '<circle cx="20" cy="35" r="2" fill="currentColor"/><circle cx="27" cy="35" r="2" fill="currentColor"/><circle cx="34" cy="35" r="2" fill="currentColor"/>'
};

export const extOf = (name) => String(name ?? '').split('.').pop().toLowerCase();

/** 資料の種類（印の名前。着せ替えで種類ごとに色・シールを変える。shared/skin.js の FILE_KINDS） */
export const kindOf = (name) => KIND[extOf(name)]?.[0] ?? 'other';

/** 資料のイラスト。幅 54・高さ 66 の紙（角が折れている）＋種類の色と印＋拡張子のラベル。colors は着せ替えの種類ごとの色（default ならはじめの色） */
export function fileArt(name, {colors = null} = {}) {
  const ext = extOf(name);
  const [kind, base] = KIND[ext] ?? ['other', 'var(--paper-ink-weak)'];
  const color = colors?.[kind] && colors[kind] !== 'default' ? colors[kind] : base;
  const label = ext.length <= 4 ? ext.toUpperCase() : '';
  return `<svg class="file-art" viewBox="0 0 54 66" width="54" height="66" aria-hidden="true" style="color: ${color}">
    <path d="M6 3h30l12 12v46a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="var(--card)" stroke="var(--paper-ink)" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M36 3v12h12" fill="color-mix(in srgb, currentColor 35%, var(--card))" stroke="var(--paper-ink)" stroke-width="1.6" stroke-linejoin="round"/>
    ${MARK[kind]}
    <rect x="4" y="48" width="36" height="12" rx="2" fill="currentColor"/>
    <text x="22" y="57.5" text-anchor="middle" font-size="8.5" font-weight="700" font-family="var(--font-body)" fill="#2b2b2b">${label}</text>
  </svg>`;
}
