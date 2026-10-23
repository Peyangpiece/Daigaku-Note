// 画面の土台（DESIGN-M0 §10）。経路：#/setup（初回）・#/（ホーム）・#/course/<id>・#/viewer/<資料 id>・#/settings・#/settings/term・#/settings/lms（LMS とつなぐ）
// ホーム（フォルダのグリッド）・授業（資料一覧）・PDF ビューア（文字入れ・付箋・文字隠し）・クイズ・設定・セットアップ。
import {features} from '../shared/profile.js';
import {renderHome} from './views/home.js';
import {closeSkinPicker, openSkinPicker, renderKisekae} from './views/kisekae.js';
import {renderFudebako} from './views/fudebako.js';
import {applySkin, setStickerReload, skinOf, stickerLayer, watchTheme} from './skin.js';
import {renderCourse} from './views/course.js';
import {renderFolder, renderFolderNew} from './views/folder.js';
import {renderSettings} from './views/settings.js';
import {renderSetup, resetSetup} from './views/setup.js';
import {renderTerm, resetTerm} from './views/term.js';
import {
  leaveQuiz,
  leaveQuizEdit,
  quizAction,
  quizEditAction,
  quizKey,
  quizSubmitNum,
  renderQuiz,
  renderQuizEdit
} from './views/quiz.js';
import {mountViewer} from './views/viewer.js';

const api = window.daigaku;
export const state = {data: null, progress: null};
let viewer = null; // 開いている PDF ビューア。状態が変わっても描き直さない

export {jaWrap} from './ja-wrap.js';

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]
  );

export async function reload() {
  state.data = await api['state.get']();
  if (state.data?.error) throw new Error(state.data.error);
  applyTheme();
  render();
  // 着せ替えを入れた版に更新したあと 1 回だけ知らせる（SPEC-KISEKAE §4.4）
  if (state.data.skin && !state.data.skin.introduced && !location.hash.startsWith('#/setup')) {
    state.data.skin.introduced = true;
    api['skin.introduced']();
    toast('着せ替えができるようになりました。上の「着せ替え」か、フォルダの右クリックから選べます', {
      action: {label: '見てみる', run: () => navigate('/kisekae')}
    });
  }
}

function applyTheme() {
  const s = state.data?.settings ?? {};
  document.documentElement.dataset.theme = s.theme === 'system' ? '' : s.theme;
  document.documentElement.dataset.rules = s.rules ?? 'normal';
  applySkin(state.data); // 着せ替えのノート（紙の種類・色。SPEC-KISEKAE）
}
watchTheme(
  () => state.data,
  () => render()
);
setStickerReload(() => render()); // シールの画像が届いたら描き直す

export function navigate(route) {
  location.hash = route.startsWith('#') ? route : '#' + route;
}

// トースト：画面下に積む（重ねない）。失敗の知らせは長めに残し、押すと消える。読み上げは #toasts の role=status で
// action：{label, run}。知らせの中にボタンを出す（「元に戻す」など。押すと run して消える。知らせは長めに残す）
export function toast(message, {error = false, action = null} = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast${error ? ' toast--error' : ''}`;
  el.textContent = message;
  el.title = '押すと消えます';
  el.onclick = () => el.remove();
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast__action';
    b.textContent = action.label;
    b.onclick = (e) => {
      e.stopPropagation();
      el.remove();
      action.run();
    };
    el.append(b);
  }
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), error || action ? 8000 : 4000);
}

function head() {
  const d = new Date();
  document.getElementById('head-date').textContent =
    `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
  const terms = state.data?.terms ?? [];
  // 今の学期はメインと同じ決め方（期間の重なる学期では短いほう。shared/term.js の currentTerm）
  const term = terms.find((t) => t.id === state.data?.currentTermId) ?? terms.at(-1);
  // 学期を使わない人（社会人）には学期名を出さない
  const useTerms = features(state.data?.settings ?? {}).terms;
  document.getElementById('head-term').textContent = term && useTerms ? `${term.year} ${term.label}` : '';
}

// 描き直しても入力中の値・フォーカス・スクロールが消えないように、同じ画面の描き直しでは控えて戻す
const keyOf = (el) =>
  el.id
    ? `#${el.id}`
    : el.dataset?.action
      ? `${el.dataset.action}|${el.dataset.id ?? el.dataset.route ?? el.dataset.courseId ?? ''}|${el.dataset.full ?? ''}`
      : null;
function snapshot(view) {
  // data-form（どの記録の入力欄か）が変わった欄は戻さない（例：学期の編集で別の学期を選び直したとき）
  const form = (el) => el.closest('[data-form]')?.dataset.form ?? '';
  const fields = [...view.querySelectorAll('input[id], select[id], textarea[id], details[id]')].map((el) => [
    el.id,
    el.tagName === 'DETAILS' ? el.open : el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value,
    form(el)
  ]);
  const radios = [...view.querySelectorAll('input[type=radio]:checked')].map((el) => [el.name, el.value]);
  const active = view.contains(document.activeElement) ? document.activeElement : null;
  return {fields, radios, focus: active && keyOf(active), scroll: window.scrollY};
}
function restore(view, snap) {
  for (const [id, v, f] of snap.fields) {
    const el = document.getElementById(id);
    if (!el || el.dataset.keep === 'off' || (el.closest('[data-form]')?.dataset.form ?? '') !== f) continue;
    if (el.tagName === 'DETAILS') el.open = v;
    else if (el.type === 'checkbox') el.checked = v;
    else if (el.type !== 'radio' && el.type !== 'file') el.value = v;
  }
  for (const [name, value] of snap.radios)
    [...view.querySelectorAll('input[type=radio]')].find((el) => el.name === name && el.value === value)?.click();
  if (snap.focus)
    [...view.querySelectorAll('[id], [data-action]')]
      .find((el) => keyOf(el) === snap.focus)
      ?.focus({preventScroll: true});
  window.scrollTo(0, snap.scroll);
}

let lastRoute = null;
/** 状態を読み直さずに描き直す（クイズの画面の中の動きなど） */
export const refresh = () => render();
function render() {
  if (!state.data) return;
  head();
  const view = document.getElementById('view');
  const route = location.hash.replace(/^#/, '') || '/';
  const app = document.getElementById('app');
  // 編集画面：紙（罫線・余白の縦線）はホームと同じものを窓いっぱいに敷く（拡大して横にはみ出しても途切れない）。
  // アプリ全体の拡大は 100% にする（PDF だけを拡大し、ツールバーや背景は拡大しない）
  // 上の固定ボタン（ホーム・復習・設定）：今いる画面を押した状態に。復習には今日の問題数
  for (const b of document.querySelectorAll('.topnav [data-nav]'))
    b.setAttribute(
      'aria-current',
      (b.dataset.nav === 'home' ? route === '/' : route.startsWith(`/${b.dataset.nav}`)) ? 'page' : 'false'
    );
  const due = state.data.quiz?.reviewDue ?? 0;
  const count = document.getElementById('nav-review-count');
  if (count) {
    count.textContent = due ? String(due) : '';
    count.hidden = !due;
    count.parentElement.setAttribute('aria-label', due ? `復習（今日 ${due} 問）` : '復習');
  }
  const inViewer = route.startsWith('/viewer/');
  app.classList.toggle('paper--viewer', inViewer);
  document.documentElement.classList.toggle('paper-canvas', inViewer);
  api.appZoom(inViewer ? 'hold' : 'release');
  // PDF ビューアは状態が変わっても描き直さない（開いたまま。閉じるときだけ unmount）
  if (route.startsWith('/viewer/')) {
    const materialId = route.slice('/viewer/'.length);
    lastRoute = route;
    const material = Object.values(state.data.materials)
      .flat()
      .find((m) => m.id === materialId);
    const course = state.data.courses.find((c) => c.id === material?.course_id);
    if (viewer?.materialId !== materialId) {
      viewer?.unmount();
      leaveQuiz();
      leaveQuizEdit();
      viewer = mountViewer(view, {materialId, course, onBack: () => navigate(course ? `/course/${course.id}` : '/')});
    }
    // PDF のまわりの紙に貼るシール（窓に固定。PDF の下に置く）。着せ替えやシールの画像が変わったら貼り直す
    document.getElementById('viewer-stickers')?.remove();
    const layer = stickerLayer(skinOf(state.data, course ?? null).stickers, 'viewer', state.data);
    if (layer)
      view.insertAdjacentHTML(
        'afterbegin',
        layer.replace('<div class="sticker-layer', '<div id="viewer-stickers" class="sticker-layer')
      );
    return;
  }
  // 編集画面を出たら読み直す（足したしおりなどを授業画面に出すため）
  if (viewer) setTimeout(() => reload().catch(console.error));
  viewer?.unmount();
  viewer = null;
  const same = route === lastRoute;
  const snap = same ? snapshot(view) : null;
  if (route === '/setup' && !same) resetSetup('first');
  if (route === '/settings/lms' && !same) resetSetup('lms', state.data);
  if (route === '/settings/lms-terms' && !same) resetSetup('terms', state.data);
  if (route === '/settings/term' && !same) resetTerm();
  if (!same && !route.startsWith('/quiz') && !route.startsWith('/review')) leaveQuiz();
  if (!same && !route.startsWith('/quiz-edit/')) leaveQuizEdit();
  if (route === '/setup' || route === '/settings/lms' || route === '/settings/lms-terms')
    view.innerHTML = renderSetup(state);
  else if (route.startsWith('/course/')) {
    const course = state.data.courses.find((c) => c.id === route.slice('/course/'.length));
    view.innerHTML =
      course?.kind === 'folder' ? renderFolder(state, course) : renderCourse(state, route.slice('/course/'.length));
  } else if (route.startsWith('/folder-new')) view.innerHTML = renderFolderNew(state, route);
  else if (route === '/settings/term') view.innerHTML = renderTerm(state);
  else if (route.startsWith('/quiz-edit/')) view.innerHTML = renderQuizEdit(state, route.slice('/quiz-edit/'.length));
  else if (route.startsWith('/quiz') || route.startsWith('/review')) view.innerHTML = renderQuiz(state, route);
  else if (route === '/settings' || route.startsWith('/settings?')) view.innerHTML = renderSettings(state, route);
  else if (/^\/kisekae(\/edit)?(\?|$)/.test(route)) view.innerHTML = renderKisekae(state, route);
  else if (/^\/fudebako(\?|$)/.test(route)) view.innerHTML = renderFudebako(state, route);
  else view.innerHTML = renderHome(state);
  lastRoute = route;
  if (snap) restore(view, snap);
  else {
    window.scrollTo(0, 0);
    // 画面が変わったら見出しにフォーカスを移す（読み上げで今いる画面が分かる）。授業画面は今日の回まで送る
    view.querySelector('h2')?.setAttribute('tabindex', '-1');
    view.querySelector('h2')?.focus({preventScroll: true});
    view.querySelector('[data-scroll-into-view]')?.scrollIntoView({block: 'center'});
  }
  view.dispatchEvent(new CustomEvent('rendered', {bubbles: true, detail: {route, fresh: !same}}));
}

window.addEventListener('hashchange', render);
api.on('state.changed', () => reload().catch(console.error));
export const progressText = (p) => (p ? `同期中 ${p.current}/${p.total}（${p.courseName}）` : '');
api.on('sync.progress', (p) => {
  state.progress = p;
  const el = document.getElementById('sync-status');
  if (el) el.textContent = progressText(p);
});
api.on('sync.finished', (r) => {
  state.progress = null;
  if (r.status === 'login-required')
    toast(r.message || 'LMS へのログインが必要です（設定 → 大学の LMS → ログインし直す）', {error: true});
  else if (r.status === 'failed' || r.status === 'browser-not-ready')
    toast(r.message || '同期に失敗しました', {error: true});
  else if (r.status === 'no-term') toast('学期の設定がありません（設定 → 学期）', {error: true});
  else if (r.status === 'terms-required') toast(r.message, {error: true});
  else
    toast(
      `同期しました：資料 ${r.materials ?? 0} 件保存${r.failures ? `・失敗 ${r.failures} 件（${r.message ?? ''}）` : ''}`
    );
});
api.on('quiz.progress', () => reload().catch(console.error));
api.on('quiz.finished', (r) => {
  if (r.ok)
    toast(
      `クイズができました：${r.count} 問${r.flagged ? `（要確認 ${r.flagged} 問）` : ''}${r.notes?.length ? `。${r.notes.join('。')}` : ''}`
    );
  else toast(r.message, {error: true});
});
document.addEventListener('keydown', (e) => quizKey(e));
document.addEventListener('submit', (e) => {
  if (e.target.matches('[data-quiz-num]')) {
    e.preventDefault();
    quizSubmitNum(e.target);
  }
});
api.on('login.required', ({label, message}) => toast(message ?? `${label} へのログインが必要です`, {error: true}));
api.on('route', (r) => navigate(r));
// メニューの拡大・縮小（⌘＋・⌘−・⌘0）。編集画面では PDF だけ、ほかの画面ではアプリ全体
api.on('zoom', (dir) => (viewer ? viewer.zoomStep(dir) : api.appZoom(dir)));

// 画面内のボタンは data-action で受ける（1 か所で委譲）
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const {action} = el.dataset;
  try {
    if (action.startsWith('quiz-') && (await quizAction(action, el))) return;
    if (action.startsWith('qe-') && (await quizEditAction(action, el))) return;
    if (action === 'open-course') navigate(`/course/${el.dataset.id}`);
    else if (action === 'rename') renameFrom(el);
    else if (action === 'nav') navigate(el.dataset.route);
    else if (action === 'sync') {
      const r = await api['sync.run']({
        courseId: el.dataset.courseId || undefined,
        full: el.dataset.full === '1' || undefined
      });
      if (r?.error) toast(r.error, {error: true});
      else toast(el.dataset.full === '1' ? '過去の回も含めて全部確かめます（数分かかります）' : '同期を始めます');
    } else if (action === 'open-pdf') navigate(`/viewer/${el.dataset.id}`);
    else if (action === 'open-material') {
      const r = await api['material.open']({materialId: el.dataset.id});
      if (r?.error) toast(r.error, {error: true});
      else reload();
    } else if (action === 'reveal-material') {
      const r = await api['material.reveal']({materialId: el.dataset.id});
      if (r?.error) toast(r.error, {error: true});
    } else if (action === 'login') {
      // 要確認の「ログイン窓を開く」。自動ログインがオンなら ID とパスワードは窓に入れてある。ログインできたらそのまま同期する
      el.disabled = true;
      toast('ログインの窓を開きます。窓でログインしてください');
      const r = await api['connection.login']({connectionId: el.dataset.id, mode: 'visible'});
      toast(r?.ok ? 'ログインしました。同期を始めます' : r?.message || r?.error || 'ログインできませんでした', {
        error: !r?.ok
      });
      if (r?.ok) await api['sync.run']({connectionId: el.dataset.id});
      reload();
    } else if (action === 'own-color') {
      // 「付箋を追加」の色。選んでいる色をもう一度押すと元の白に戻す
      const index = el.dataset.index === '' ? null : Number(el.dataset.index);
      const r = await api['settings.update']({patch: {ownColor: {courseId: el.dataset.courseId, index}}});
      if (r?.error) return toast(r.error, {error: true});
      await reload();
    } else if (action === 'import-courses') {
      // パソコンの授業フォルダを取り込む（中のフォルダを 1 つずつ今学期のフォルダとして登録）
      const r = await api['folder.importCourses']();
      if (r?.error) return toast(r.error, {error: true});
      if (r.canceled) return;
      toast(
        r.added.length
          ? `${r.added.length} 個の授業フォルダを取り込みました${r.failed.length ? `（${r.failed.length} 個は取り込めませんでした）` : ''}`
          : '取り込めるフォルダがありませんでした',
        {error: !r.added.length}
      );
      await reload();
    } else if (action === 'upload') {
      const r = await api['material.upload']({courseId: el.dataset.courseId});
      if (r?.error) toast(r.error, {error: true});
      else if (!r.canceled) uploaded(r);
    } else if (action === 'finish-setup') {
      // 初回のセットアップを終える（次から起動時に出さない。LMS はあとからでも 設定 → 大学の LMS からつなげる）
      await api['settings.update']({patch: {skipSetup: true}});
      await reload();
      navigate(el.dataset.next || '/');
    } else if (action === 'folder-create') {
      const name = document.getElementById('fn-name')?.value ?? '';
      const scope = document.querySelector('input[name=fn-scope]:checked')?.value ?? 'term';
      el.disabled = true;
      const r = await api['folder.create']({name, scope, mode: el.dataset.mode}).finally(() => (el.disabled = false));
      if (r?.error) return toast(r.error, {error: true});
      if (r.canceled) return;
      if (r.truncated) toast('ファイルが多いため、一部だけを表示しています（2000 件まで）', {error: true});
      await reload();
      navigate(`/course/${r.courseId}`);
    } else if (action === 'folder-scan') {
      const r = await api['folder.scan']({courseId: el.dataset.courseId});
      if (r?.error) toast(r.error, {error: true});
      else toast(folderScanText(r) || '変わったファイルはありませんでした', {error: r.missing});
      reload();
    } else if (action === 'folder-reveal') {
      const r = await api['folder.reveal']({courseId: el.dataset.courseId});
      if (r?.error) toast(r.error, {error: true});
    } else if (action === 'folder-scope') {
      const r = await api['folder.update']({courseId: el.dataset.courseId, scope: el.dataset.scope});
      if (r?.error) toast(r.error, {error: true});
      else
        (toast(
          el.dataset.scope === 'always'
            ? 'マイフォルダにしました（学期が変わっても残ります）'
            : '今学期のフォルダにしました'
        ),
          reload());
    } else if (action === 'folder-hide') {
      const r = await api['course.update']({courseId: el.dataset.courseId, patch: {hidden: true}});
      if (r?.error) return toast(r.error, {error: true});
      toast('ホームから外しました（パソコンのフォルダとファイルはそのまま。設定で戻せます）');
      await reload();
      navigate('/');
    } else if (action === 'remove-material') {
      const r = await api['material.remove']({materialId: el.dataset.id});
      if (r?.error) toast(r.error, {error: true});
      else (toast('外しました（ファイルはゴミ箱にあります）'), reload());
    } else if (action === 'quiz-pick') {
      for (const x of document.querySelectorAll('input[name=quiz-make]'))
        x.checked = el.dataset.pick === 'new' ? !x.dataset.hasQuiz : false;
    } else if (action === 'quiz-make-picked') {
      const picked = [...document.querySelectorAll('input[name=quiz-make]:checked')];
      if (!picked.length) return toast('クイズを作る回を 1 つ以上選んでください', {error: true});
      const redo = picked.filter((x) => x.dataset.hasQuiz).map((x) => x.dataset.label);
      if (
        redo.length &&
        !window.confirm(`${redo.join('・')}はクイズがあります。作り直しますか？（前の版の記録は残ります）`)
      )
        return;
      const roundIds = picked.map((x) => x.value);
      const r = await api['quiz.generate']({roundIds});
      if (r?.error) return toast(r.error, {error: true});
      for (const x of picked) x.checked = false;
      toast(
        roundIds.length > 1
          ? `${r.queued} 回分のクイズを順に作ります（1 回 1〜2 分）`
          : 'クイズを作っています（1〜2 分）'
      );
      reload();
    } else if (action === 'quiz-range') {
      const picked = [...document.querySelectorAll('input[name=quiz-range]:checked')].map((x) => x.value);
      if (!picked.length) return toast('回を 1 つ以上選んでください', {error: true});
      navigate(`/quiz?course=${el.dataset.courseId}&quizzes=${picked.join(',')}&mode=exam&r=${Date.now()}`);
    } else if (action === 'quiz-generate') {
      const roundIds = el.dataset.rounds.split(',').filter(Boolean);
      const r = await api['quiz.generate']({roundIds});
      if (r?.error) toast(r.error, {error: true});
      else
        toast(
          roundIds.length > 1
            ? `${r.queued} 回分のクイズを順に作ります（1 回 1〜2 分）`
            : 'クイズを作っています（1〜2 分）'
        );
      reload();
    } else if (action === 'open-external') await api['shell.openExternal']({url: el.dataset.url});
    else if (action === 'open-root') await api['shell.openRoot']();
    else if (action === 'pick-dir') {
      const r = await api['settings.pickDownloadDir']();
      if (r?.error) toast(r.error, {error: true});
      else if (r.dir) reload();
    } else if (action === 'reset-dir') {
      await api['settings.update']({patch: {resetRoot: true}});
      reload();
    } else if (action === 'install-browser') {
      toast('ブラウザを準備しています…（数分かかります）');
      const r = await api['browser.install']();
      toast(r?.ok ? 'ブラウザの用意ができました' : r?.message || 'ブラウザの準備に失敗しました', {error: !r?.ok});
      reload();
    }
  } catch (err) {
    toast(err.message, {error: true});
  }
});

// ---- ホームの授業・フォルダのカード：右クリック（トラックパッドの 2 本指タップ・タッチの長押し）で「開く」「ホームから外す」など ----
// ---- 名前を変える：名前の上に入力欄を重ねる。Enter・外を押すと決める、Esc でやめる ----
export function renameAt(target, value, save) {
  document.querySelector('.rename-pop')?.remove();
  const r = target.getBoundingClientRect();
  const cs = window.getComputedStyle(target);
  const input = document.createElement('input');
  input.className = 'rename-pop input';
  input.value = value;
  input.maxLength = 80;
  Object.assign(input.style, {
    left: `${Math.max(8, r.left - 6)}px`,
    top: `${r.top + r.height / 2}px`,
    width: `${Math.min(window.innerWidth - 16, Math.max(r.width + 40, 200))}px`,
    font: cs.font
  });
  document.body.append(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (ok) => {
    if (done) return;
    done = true;
    input.remove();
    if (!ok || input.value.trim() === value.trim()) return;
    try {
      const res = await save(input.value.trim());
      if (res?.error) return toast(res.error, {error: true});
      await reload();
    } catch (err) {
      toast(err.message, {error: true});
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}
/** 名前を変えられる授業か：自分のフォルダと、LMS を使わない授業（LMS の授業名は LMS に合わせる） */
export const canRename = (course) =>
  course.kind === 'folder' || state.data?.connections.find((c) => c.id === course.connection_id)?.kind === 'manual';
/** 名前を変える：自分のフォルダ・LMS を使わない授業・回の付箋・自分のフォルダの中のフォルダ */
function renameCourse(course, target) {
  if (!canRename(course)) return;
  if (course.kind === 'folder')
    return renameAt(target, course.name, (name) => api['folder.update']({courseId: course.id, name}));
  return renameAt(target, course.name, (name) => api['course.update']({courseId: course.id, patch: {name}}));
}
// 名前をダブルクリックしても変えられる（そばに ✎ のある名前だけ）
document.addEventListener('dblclick', (e) => {
  const target = e.target.closest?.('[data-rename-target]');
  const btn = target?.closest('[data-rename-box]')?.querySelector('[data-action="rename"]');
  if (!btn) return;
  e.preventDefault();
  window.getSelection()?.removeAllRanges(); // ダブルクリックで選ばれた文字を外す
  renameFrom(btn);
});
function renameFrom(el) {
  const target = el.closest('[data-rename-box]')?.querySelector('[data-rename-target]') ?? el;
  const {what, id, sub, value} = el.dataset;
  if (what === 'course' || what === 'folder') {
    const course = state.data.courses.find((c) => c.id === id);
    if (course) renameCourse(course, target);
  } else if (what === 'round') renameAt(target, value, (title) => api['round.update']({roundId: id, title}));
  else if (what === 'sub') renameAt(target, value, (name) => api['folder.renameSub']({courseId: id, sub, name}));
  else if (what === 'conn') renameAt(target, value, (label) => api['connection.update']({connectionId: id, label}));
}

let cardMenu = null;
const closeCardMenu = () => {
  cardMenu?.remove();
  cardMenu = null;
};
document.addEventListener('contextmenu', (e) => {
  const card = e.target.closest?.('.folder[data-action="open-course"]');
  closeCardMenu();
  closeSkinPicker();
  if (!card) return;
  const course = state.data?.courses.find((c) => c.id === card.dataset.id);
  if (!course) return;
  e.preventDefault();
  cardMenu = document.createElement('div');
  cardMenu.className = 'card-menu';
  cardMenu.setAttribute('role', 'menu');
  cardMenu.setAttribute('aria-label', course.name);
  cardMenu.innerHTML = `<button type="button" role="menuitem" data-card-menu="open">開く</button>${canRename(course) ? '<button type="button" role="menuitem" data-card-menu="rename">名前を変える…</button>' : ''}<button type="button" role="menuitem" data-card-menu="skin">着せ替え…</button><button type="button" role="menuitem" data-card-menu="remove">ホームから外す</button>`;
  document.body.append(cardMenu);
  const {width, height} = cardMenu.getBoundingClientRect();
  // キーボードのメニューキー（Shift+F10）では座標が (0,0) なので、フォルダの位置に出す
  const r = card.getBoundingClientRect();
  const x = e.clientX || e.clientY ? e.clientX : r.left + 16;
  const y = e.clientX || e.clientY ? e.clientY : r.top + 16;
  cardMenu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
  cardMenu.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
  cardMenu.querySelector('button').focus();
  cardMenu.onclick = (ev) => {
    const what = ev.target.closest('[data-card-menu]')?.dataset.cardMenu;
    if (!what) return;
    closeCardMenu();
    if (what === 'open') navigate(`/course/${course.id}`);
    else if (what === 'rename') renameCourse(course, card.querySelector('.folder__name') ?? card);
    else if (what === 'skin') {
      const r = card.getBoundingClientRect();
      openSkinPicker(course, card, r.right + 8, r.top);
    } else removeCourse(course).catch((err) => toast(err.message, {error: true}));
  };
});
document.addEventListener('pointerdown', (e) => cardMenu && !cardMenu.contains(e.target) && closeCardMenu());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeCardMenu());
window.addEventListener('scroll', closeCardMenu, {passive: true});
window.addEventListener('hashchange', closeCardMenu);

/** ホームから外す（非表示にして同期もやめる。保存した資料・メモ・パソコンのフォルダは残し、設定から戻せる） */
async function removeCourse(course) {
  // 消すのではなく、ホームに出さないだけ（同期もやめる。資料・メモ・パソコンのフォルダは残る）。すぐ「元に戻す」で戻せるので確認は出さない
  const folder = course.kind === 'folder';
  const r = await api['course.update']({
    courseId: course.id,
    patch: folder ? {hidden: true} : {hidden: true, sync_enabled: false}
  });
  if (r?.error) return toast(r.error, {error: true});
  toast(
    `「${course.name}」をホームから外しました（${folder ? 'パソコンのフォルダとファイルはそのまま' : '資料とメモは残ります'}。設定からも戻せます）`,
    {
      action: {
        label: '元に戻す',
        run: async () => {
          await api['course.update']({
            courseId: course.id,
            patch: folder ? {hidden: false} : {hidden: false, sync_enabled: course.sync_enabled !== 0}
          });
          await reload();
        }
      }
    }
  );
  await reload();
}

// ---- 授業画面：ファイルを入れる・付箋のあいだで移す ----
function folderScanText(r) {
  if (r.missing) return 'フォルダが見つかりません（移動・名前の変更・外付けのディスクを外したとき）';
  const parts = [];
  if (r.added) parts.push(`${r.added} 件のファイルが増えました`);
  if (r.removed) parts.push(`${r.removed} 件のファイルがなくなりました`);
  if (r.truncated) parts.push('ファイルが多いため、一部だけを表示しています（2000 件まで）');
  return parts.join('。');
}
// 自分のフォルダを開いたら読み直す（パソコンの側で足した・消したファイルを反映する）。変わったときだけ描き直す
document.getElementById('view').addEventListener('rendered', async (e) => {
  const {route, fresh} = e.detail;
  if (!fresh || !route.startsWith('/course/')) return;
  const course = state.data.courses.find((c) => c.id === route.slice('/course/'.length));
  if (course?.kind !== 'folder') return;
  const r = await api['folder.scan']({courseId: course.id});
  if (r?.error) return toast(r.error, {error: true});
  if (r.missing || r.truncated) toast(folderScanText(r), {error: true});
  if (r.added || r.removed) reload();
});
function uploaded(r) {
  const parts = [];
  if (r.added) parts.push(`${r.added} 件を入れました`);
  if (r.dup?.length)
    parts.push(
      `${r.dup.map((d) => `${d.name}（${d.where}にあります）`).join('、')}は同じものがあるので入れませんでした`
    );
  if (r.failed?.length) parts.push(`${r.failed.map((d) => d.name).join('、')}は入れられませんでした`);
  toast(parts.join('。') || '入れるファイルがありませんでした', {
    error: !r.added && !!(r.dup?.length || r.failed?.length)
  });
  reload();
}
async function moveMaterial(materialId, place) {
  const r = await api['material.move']({materialId, roundId: place === 'own' ? null : place});
  if (r?.error) toast(r.error, {error: true});
  reload();
}
document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('[data-move-material]');
  if (sel && sel.value)
    moveMaterial(sel.dataset.moveMaterial, sel.value).catch((err) => toast(err.message, {error: true}));
});
const MATERIAL_TYPE = 'application/x-daigaku-material';
document.addEventListener('dragstart', (e) => {
  const card = e.target.closest?.('[data-drag-material]');
  if (!card) return;
  e.dataTransfer.setData(MATERIAL_TYPE, card.dataset.dragMaterial);
  e.dataTransfer.effectAllowed = 'move';
});
// 付箋の外に落としたファイルで画面が開き直さないよう、ドロップは画面全体で止める（Electron は既定でファイルを開いてしまう）
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  const note = e.target.closest?.('[data-drop]');
  document.querySelectorAll('.round-note--drop').forEach((n) => n !== note && n.classList.remove('round-note--drop'));
  if (note) {
    note.classList.add('round-note--drop');
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(MATERIAL_TYPE) ? 'move' : 'copy';
  } else e.dataTransfer.dropEffect = 'none';
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget)
    document.querySelectorAll('.round-note--drop').forEach((n) => n.classList.remove('round-note--drop'));
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.querySelectorAll('.round-note--drop').forEach((n) => n.classList.remove('round-note--drop'));
  const note = e.target.closest?.('[data-drop]');
  if (!note) return;
  const place = note.dataset.drop;
  try {
    const materialId = e.dataTransfer.getData(MATERIAL_TYPE);
    if (materialId) return await moveMaterial(materialId, place);
    // フォルダは入れない（ファイルだけ）
    const list = [...e.dataTransfer.items]
      .filter((it) => it.kind === 'file' && it.webkitGetAsEntry?.()?.isFile !== false)
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (!list.length) return toast('フォルダは入れられません。ファイルをドラッグしてください', {error: true});
    toast(`${list.length} 件を入れています…`);
    const files = await Promise.all(
      list.map(async (f) => ({name: f.name, data: new Uint8Array(await f.arrayBuffer())}))
    );
    const r = await api['material.uploadData']({
      courseId: note.dataset.courseId,
      roundId: place === 'own' ? null : place,
      files
    });
    if (r?.error) toast(r.error, {error: true});
    else uploaded(r);
  } catch (err) {
    toast(err.message, {error: true});
  }
});

reload().catch((e) => {
  document.getElementById('view').innerHTML =
    `<div class="card"><h2>起動できませんでした</h2><p>${esc(e.message)}</p></div>`;
});
