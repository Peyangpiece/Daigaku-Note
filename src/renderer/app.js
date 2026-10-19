// 画面の土台（DESIGN-M0 §10）。経路：#/setup・#/（ホーム）・#/course/<id>・#/settings・#/settings/term
// M0 はホーム（フォルダのグリッド）・授業（資料一覧）・設定・セットアップの骨格。ビューア・クイズは M2・M3。
import {renderHome} from './views/home.js';
import {renderCourse} from './views/course.js';
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

const api = window.daigaku;
export const state = {data: null, progress: null};

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
}

function applyTheme() {
  const s = state.data?.settings ?? {};
  document.documentElement.dataset.theme = s.theme === 'system' ? '' : s.theme;
  document.documentElement.dataset.rules = s.rules ?? 'normal';
}

export function navigate(route) {
  location.hash = route.startsWith('#') ? route : '#' + route;
}

// トースト：画面下に積む（重ねない）。失敗の知らせは長めに残し、押すと消える。読み上げは #toasts の role=status で
export function toast(message, {error = false} = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast${error ? ' toast--error' : ''}`;
  el.textContent = message;
  el.title = '押すと消えます';
  el.onclick = () => el.remove();
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), error ? 8000 : 4000);
}

function head() {
  const d = new Date();
  document.getElementById('head-date').textContent =
    `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
  const terms = state.data?.terms ?? [];
  const today = d.toLocaleDateString('sv-SE');
  const term = terms.find((t) => t.start_date <= today && today <= t.end_date) ?? terms.at(-1);
  document.getElementById('head-term').textContent = term ? `${term.year} ${term.label}` : '';
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
  app.classList.toggle('paper--margin', route === '/' || route.startsWith('/course/'));
  if (!state.data.connections.length && route !== '/setup' && !route.startsWith('/settings')) return navigate('/setup');
  const same = route === lastRoute;
  const snap = same ? snapshot(view) : null;
  if (route === '/setup' && !same) resetSetup();
  if (route === '/settings/term' && !same) resetTerm();
  if (!same && !route.startsWith('/quiz') && !route.startsWith('/review')) leaveQuiz();
  if (!same && !route.startsWith('/quiz-edit/')) leaveQuizEdit();
  if (route === '/setup') view.innerHTML = renderSetup(state);
  else if (route.startsWith('/course/')) view.innerHTML = renderCourse(state, route.slice('/course/'.length));
  else if (route === '/settings/term') view.innerHTML = renderTerm(state);
  else if (route.startsWith('/quiz-edit/')) view.innerHTML = renderQuizEdit(state, route.slice('/quiz-edit/'.length));
  else if (route.startsWith('/quiz') || route.startsWith('/review')) view.innerHTML = renderQuiz(state, route);
  else if (route === '/settings') view.innerHTML = renderSettings(state);
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
    toast(r.message || 'LMS へのログインが必要です（設定 → 接続 → ログインし直す）', {error: true});
  else if (r.status === 'failed' || r.status === 'browser-not-ready')
    toast(r.message || '同期に失敗しました', {error: true});
  else if (r.status === 'no-term') toast('学期の設定がありません（設定 → 学期）', {error: true});
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
api.on('login.required', ({label}) => toast(`${label} へのログインが必要です`, {error: true}));
api.on('route', (r) => navigate(r));

// 画面内のボタンは data-action で受ける（1 か所で委譲）
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const {action} = el.dataset;
  try {
    if (action.startsWith('quiz-') && (await quizAction(action, el))) return;
    if (action.startsWith('qe-') && (await quizEditAction(action, el))) return;
    if (action === 'open-course') navigate(`/course/${el.dataset.id}`);
    else if (action === 'nav') navigate(el.dataset.route);
    else if (action === 'sync') {
      const r = await api['sync.run']({
        courseId: el.dataset.courseId || undefined,
        full: el.dataset.full === '1' || undefined
      });
      if (r?.error) toast(r.error, {error: true});
      else toast(el.dataset.full === '1' ? '過去の回も含めて全部確かめます（数分かかります）' : '同期を始めます');
    } else if (action === 'open-material') {
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
    } else if (action === 'upload') {
      const r = await api['material.upload']({courseId: el.dataset.courseId});
      if (r?.error) toast(r.error, {error: true});
      else if (!r.canceled) uploaded(r);
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

// ---- 授業画面：ファイルを入れる・付箋のあいだで移す ----
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
