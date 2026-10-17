// 授業名・コース情報から曜日と時限を読む（SPEC §8.4）。「（金2）」「金曜2限」「金曜／2限」「Fri 2」など。副作用なし。
const WD = {月: '月', 火: '火', 水: '水', 木: '木', 金: '金', 土: '土', 日: '日'};
const EN = {mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日'};

export function parseSlot(text) {
  const t = String(text ?? '').normalize('NFKC');
  let m =
    t.match(/([月火水木金土日])\s*(?:曜日?|曜)?\s*[／/・,、\s]*\s*([1-7])\s*(?:限|時限|コマ)/) ||
    t.match(/[（(\[]\s*([月火水木金土日])\s*([1-7])\s*[)）\]]/) ||
    t.match(/([月火水木金土日])\s*([1-7])(?![0-9])\s*(?:限|$|[)）\]\s])/);
  if (m && WD[m[1]]) return {weekday: WD[m[1]], period: Number(m[2])};
  m = t.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[\-/ ]?\s*(?:period\s*)?([1-7])\b/i);
  if (m) return {weekday: EN[m[1].toLowerCase()], period: Number(m[2])};
  m = t.match(/([月火水木金土日])曜/);
  if (m) return {weekday: WD[m[1]], period: null};
  return null;
}
