// 画面の土台（DESIGN-M0 §10）。経路：#/setup・#/（ホーム）・#/course/<id>・#/settings
// M0 はホーム（フォルダのグリッド）・授業（資料一覧）・設定・セットアップの骨格。ビューア・クイズは M2・M3。
import {renderHome} from './views/home.js';
import {renderCourse} from './views/course.js';
import {renderSettings} from './views/settings.js';
import {renderSetup} from './views/setup.js';

const api = window.daigaku;
export const state = {data: null, progress: null};

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

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

export function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 3000);
}

function head() {
  const d = new Date();
  document.getElementById('head-date').textContent = `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
  const terms = state.data?.terms ?? [];
  const today = d.toLocaleDateString('sv-SE');
  const term = terms.find((t) => t.start_date <= today && today <= t.end_date) ?? terms.at(-1);
  document.getElementById('head-term').textContent = term ? `${term.year} ${term.label}` : '';
}

function render() {
  if (!state.data) return;
  head();
  const view = document.getElementById('view');
  const route = location.hash.replace(/^#/, '') || '/';
  const app = document.getElementById('app');
  app.classList.toggle('paper--margin', route === '/' || route.startsWith('/course/'));
  if (!state.data.connections.length && route !== '/setup' && route !== '/settings') return navigate('/setup');
  if (route === '/setup') view.innerHTML = renderSetup(state);
  else if (route.startsWith('/course/')) view.innerHTML = renderCourse(state, route.slice('/course/'.length));
  else if (route === '/settings') view.innerHTML = renderSettings(state);
  else view.innerHTML = renderHome(state);
  view.dispatchEvent(new CustomEvent('rendered', {bubbles: true, detail: {route}}));
}

window.addEventListener('hashchange', render);
api.on('state.changed', () => reload().catch(console.error));
api.on('sync.progress', (p) => {
  state.progress = p;
  const el = document.getElementById('sync-status');
  if (el) el.textContent = `同期中 ${p.current}/${p.total}（${p.courseName}）`;
});
api.on('sync.finished', (r) => {
  state.progress = null;
  if (r.status === 'login-required') toast('LMS へのログインが必要です（設定 → 接続 → ログインし直す）');
  else if (r.status === 'failed' || r.status === 'browser-not-ready') toast(r.message || '同期に失敗しました');
  else if (r.status === 'no-term') toast('学期の設定がありません（設定 → 学期）');
  else toast(`同期しました：資料 ${r.materials ?? 0} 件保存${r.failures ? `・失敗 ${r.failures} 件（${r.message ?? ''}）` : ''}`);
});
api.on('login.required', ({label}) => toast(`${label} へのログインが必要です`));
api.on('route', (r) => navigate(r));

// 画面内のボタンは data-action で受ける（1 か所で委譲）
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const {action} = el.dataset;
  try {
    if (action === 'open-course') navigate(`/course/${el.dataset.id}`);
    else if (action === 'nav') navigate(el.dataset.route);
    else if (action === 'sync') await api['sync.run']({courseId: el.dataset.courseId || undefined});
    else if (action === 'open-material') {
      const r = await api['material.open']({materialId: el.dataset.id});
      if (r?.error) toast(r.error);
      else reload();
    } else if (action === 'reveal-material') await api['material.reveal']({materialId: el.dataset.id});
    else if (action === 'open-external') await api['shell.openExternal']({url: el.dataset.url});
    else if (action === 'open-root') await api['shell.openRoot']();
    else if (action === 'pick-dir') {
      const r = await api['settings.pickDownloadDir']();
      if (r?.error) toast(r.error);
      else if (r.dir) reload();
    } else if (action === 'reset-dir') {
      await api['settings.update']({patch: {resetRoot: true}});
      reload();
    } else if (action === 'install-browser') {
      toast('ブラウザを準備しています…（数分かかります）');
      const r = await api['browser.install']();
      toast(r?.ok ? 'ブラウザの用意ができました' : r?.message || 'ブラウザの準備に失敗しました');
      reload();
    }
  } catch (err) {
    toast(err.message);
  }
});

reload().catch((e) => {
  document.getElementById('view').innerHTML = `<div class="card"><h2>起動できませんでした</h2><p>${esc(e.message)}</p></div>`;
});
