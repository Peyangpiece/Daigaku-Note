// 学校の種類（大学生・高校生・中学生）と、種類ごとの学期の初期値。副作用なし。
// 初期値は目安で、学期の設定（設定 → 学期）でいつでも直せる。大学名はいまは記録するだけ（同じ大学の人の設定を使うのは、共有の仕組みができてから）

export const SCHOOLS = {university: '大学生', high: '高校生', junior: '中学生'};
export const isSchool = (v) => Object.hasOwn(SCHOOLS, v);

const UNIVERSITY_LABELS = ['前期', '後期', '春学期', '秋学期', '第1クォーター', '第2クォーター', '第3クォーター', '第4クォーター', '通年'];
const SCHOOL_LABELS = ['1学期', '2学期', '3学期', '前期', '後期', '通年'];

/** 学期名の候補 */
export const termLabelsFor = (school) => (school === 'high' || school === 'junior' ? SCHOOL_LABELS : UNIVERSITY_LABELS);

/** 月（1〜12）から、いまの学期名の初期値。大学は 4〜9 月が春学期、それ以外は秋学期。高校・中学は 4〜8 月が 1 学期、9〜12 月が 2 学期、1〜3 月が 3 学期 */
export function termLabelFor(school, month) {
  if (school === 'high' || school === 'junior') return month >= 4 && month <= 8 ? '1学期' : month >= 9 ? '2学期' : '3学期';
  return month >= 4 && month <= 9 ? '春学期' : '秋学期';
}

/** 回数の初期値。高校・中学の 3 学期は短いので 10 回、ほかは 15 回 */
export const roundsFor = (school, label) => ((school === 'high' || school === 'junior') && label === '3学期' ? 10 : 15);

/** 時限の開始時刻の初期値（schedule.js の PERIOD_PRESETS の名前）。大学は学校ごとの差が大きいので選ばない */
export const presetFor = (school) => (school === 'high' || school === 'junior' ? '50分・8:50開始' : '');
