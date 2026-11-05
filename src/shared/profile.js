// 使う人（大学生・社会人）と使い方。使い方に合わせて、ホームの並び・セットアップの手順・設定の項目を整える。副作用なし。
// まだ選んでいない人（前の版から使っている人）は、今までどおり全部を出す

export const ROLES = {student: '大学生', worker: '社会人'};
export const isRole = (v) => Object.hasOwn(ROLES, v);

/** 使い方の候補（人ごと）。[鍵, 名前, ひとこと] */
export const USES = {
  student: [
    ['lms', '授業の資料を活用', 'パソコンの授業フォルダや、ダウンロードした授業の資料を授業ごとに整理する'],
    ['files', '自分のファイルで勉強', 'PDF に書き込み、フォルダで整理する'],
    ['review', '試験・復習', '資料からクイズを作って復習する']
  ],
  worker: [
    ['cert', '資格・試験の勉強', '教材に書き込み、クイズで復習する'],
    ['work', '仕事の資料の整理', 'パソコンのフォルダを登録して読む・書き込む'],
    ['course', '学び直し・講座', '講座の資料を回ごとにまとめる']
  ]
};

/** その人の使い方として正しい鍵だけを残す */
export function cleanUses(role, uses) {
  const keys = (USES[role] ?? []).map(([k]) => k);
  return [...new Set(Array.isArray(uses) ? uses : [])].filter((u) => keys.includes(u));
}

/**
 * manabo とつなげる大学か（v0.17.0）。大学の LMS とつなぐ機能は manabo だけにし、manabo を使う中京大学の学生にだけ出す。
 * 大学名は本人が入れたもの（「中京大学」「中京大」。前後の空白・全角半角の違いは見ない）
 */
export const isChukyo = (university) =>
  /^中京大(学)?$/.test(
    String(university ?? '')
      .normalize('NFKC')
      .replace(/\s+/g, '')
  );

/**
 * 使い方から、出す機能を決める。
 * lms：manabo との連携と同期（中京大学の学生で「授業の資料を活用」を選んだときだけ。v0.17.0）。quiz：クイズと復習。
 * terms：学期（社会人は使わない）。foldersFirst：ホームで自分のフォルダを先に出す
 */
export function features({role = null, uses = [], university = ''} = {}) {
  if (!isRole(role)) return {lms: true, quiz: true, terms: true, foldersFirst: false};
  const has = (u) => uses.includes(u);
  const lms = role === 'student' && has('lms') && isChukyo(university);
  return {
    lms,
    quiz: role === 'student' ? has('review') : has('cert'),
    terms: role === 'student',
    foldersFirst: role === 'worker' || !lms
  };
}
