// 画面の状態と経路（app.js と画面の両方が読む。DOM の部品は ui-kit.js）。
// reload は main から状態を読み直し、app.js が登録した afterLoad（テーマ・描き直し・知らせ）を呼ぶ。画面は app.js を読まない
const api = window.daigaku;
export const state = {data: null, progress: null};

const hooks = {render: () => {}, afterLoad: async () => {}};
/** app.js が描き直しと、読み直したあとの処理を登録する */
export const setHooks = (h) => Object.assign(hooks, h);

export function navigate(route) {
  location.hash = route.startsWith('#') ? route : '#' + route;
}

/** 状態を main から読み直して描き直す */
export async function reload() {
  state.data = await api['state.get']();
  if (state.data?.error) throw new Error(state.data.error);
  await hooks.afterLoad();
}

/** 状態を読み直さずに描き直す（クイズの画面の中の動きなど） */
export const refresh = () => hooks.render();

/** 名前を変えられる授業か：自分のフォルダと、LMS を使わない授業（LMS の授業名は LMS に合わせる） */
export const canRename = (course) =>
  course.kind === 'folder' || state.data?.connections.find((c) => c.id === course.connection_id)?.kind === 'manual';
