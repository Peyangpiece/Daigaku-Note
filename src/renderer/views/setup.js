// 初回セットアップ（SPEC §6.3）。1 ページ 1 手順、付箋が順に貼られる表現。M0 は Moodle（ID・パスワード）と学期・保存先まで。
import {esc, reload, toast} from '../app.js';

const api = window.daigaku;
const steps = ['LMS の URL', 'ログイン', '授業の確認', '学期の設定', '保存先', '最初の同期'];
let step = 0;
let draft = {url: '', candidates: [], connectorId: null, kind: null, base: '', connectionId: null, courses: []};

export function renderSetup({data}) {
  const dots = steps.map((s, i) => `<span class="sticky" style="--sticky-color: var(--c${(i % 8) + 1}); --sticky-angle: ${(i % 2 ? 1 : -1) * 1.5}deg; padding: 8px 12px; opacity:${i <= step ? 1 : 0.35}; font-size: var(--fs-small)">${i + 1}. ${esc(s)}</span>`).join('');
  const body = [stepUrl, stepLogin, stepCourses, stepTerm, stepRoot, stepSync][step](data);
  queueMicrotask(bind);
  return `<div style="max-width: 720px"><div style="display:flex; gap: 12px; flex-wrap: wrap; margin-bottom: var(--space-4)">${dots}</div><section class="card">${body}</section></div>`;
}

function stepUrl() {
  return `<h2>1. LMS の URL を入れる</h2>
    <p class="muted">大学の LMS（Moodle・manaba・WebClass・manabo など）のトップページの URL。アプリが種類を判定します。</p>
    <input class="input" id="su-url" type="url" placeholder="https://lms.example-u.ac.jp/" value="${esc(draft.url)}">
    <div id="su-cands" style="margin: var(--space-2) 0">${draft.candidates.map((c) => `<label style="display:block"><input type="radio" name="cand" value="${esc(c.connectorId)}|${esc(c.kind)}" ${c.connectorId === draft.connectorId ? 'checked' : ''}> ${esc(c.name)} <span class="muted">${c.kind}${c.score ? ` ・ 確からしさ ${Math.round(c.score * 100)}%` : ''}</span></label>`).join('')}</div>
    <label style="display:block; margin: var(--space-2) 0"><input type="checkbox" id="su-tos"> 自分の大学の規約で、学習支援ツールによる自動操作が禁じられていないことを確かめました</label>
    <div style="display:flex; gap: var(--space-1)"><button class="btn" id="su-detect">種類を判定</button><button class="btn btn--primary" id="su-next1" ${draft.connectorId ? '' : 'disabled'}>次へ</button></div>`;
}
function stepLogin() {
  const api_ = draft.kind === 'api';
  return `<h2>2. ログイン</h2>
    ${
      api_
        ? `<p class="muted">Moodle の ID とパスワードを入れます。このパソコンの中だけに暗号化して保存し、トークンを取得します。統合認証（SSO）の大学ではブラウザ窓でのログイン（M0 後半）を使います。</p>
           <input class="input" id="su-user" placeholder="ID" autocomplete="username"><input class="input" id="su-pass" type="password" placeholder="パスワード" autocomplete="current-password" style="margin-top: var(--space-1)">`
        : `<p class="muted">この LMS は見えるブラウザ窓でログインします（M0 後半で実装）。いまは接続を作って次へ進めます。</p>`
    }
    <p id="su-login-msg" class="muted"></p>
    <div style="display:flex; gap: var(--space-1); margin-top: var(--space-2)"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-login">${api_ ? 'ログインして次へ' : '次へ'}</button></div>`;
}
function stepCourses() {
  return `<h2>3. 授業の確認</h2>
    <p class="muted">同期する授業を選びます（既定は全部）。</p>
    <div id="su-courses">${draft.courses.length ? draft.courses.map((c) => `<label style="display:block"><input type="checkbox" checked data-lms="${esc(c.lmsId)}"> ${esc(c.name)}${c.weekday ? ` <span class="muted">${esc(c.weekday)}曜${c.period ? ` ${c.period}限` : ''}</span>` : ''}</label>`).join('') : '<p class="muted">授業が取れませんでした。ログインできているか確かめてください。あとから同期でも取り込めます。</p>'}</div>
    <div style="display:flex; gap: var(--space-1); margin-top: var(--space-2)"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-next3">次へ</button></div>`;
}
function stepTerm(data) {
  const y = new Date().getFullYear();
  return `<h2>4. 学期の設定</h2>
    <p class="muted">学期名と期間、回数、時限の開始時刻。大学ごとに違うので、ここで入れます。</p>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2)">
      <label>年度<input class="input" id="su-year" type="number" value="${y}"></label>
      <label>学期<select class="input" id="su-label">${['前期', '後期', '春学期', '秋学期', '第1クォーター', '第2クォーター', '第3クォーター', '第4クォーター', '通年'].map((l) => `<option ${l === '秋学期' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>開始日<input class="input" id="su-start" type="date"></label>
      <label>終了日<input class="input" id="su-end" type="date"></label>
      <label>回数<select class="input" id="su-rounds"><option>15</option><option>14</option><option>8</option><option>7</option></select></label>
      <label>時限の開始時刻<select class="input" id="su-preset"><option value="">（あとで設定）</option>${(data.presets ?? []).map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
    </div>
    <p class="muted">開始日・終了日を空にすると学期名からの既定（春・前期 4/1〜9/30、秋・後期 10/1〜3/31）になります。</p>
    <div style="display:flex; gap: var(--space-1); margin-top: var(--space-2)"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-next4">保存して次へ</button></div>`;
}
function stepRoot(data) {
  return `<h2>5. 保存先</h2>
    <p>資料はここに「学期 → 授業 → 回」のフォルダで保存します。</p>
    <p><code>${esc(data.settings.root)}</code></p>
    <div style="display:flex; gap: var(--space-1)"><button class="btn" data-action="pick-dir">フォルダを選択…</button><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-next5">次へ</button></div>`;
}
function stepSync() {
  return `<h2>6. 最初の同期</h2>
    <p class="muted">全授業・全回の資料を取り込みます。数分かかることがあります。</p>
    <p id="sync-status" class="muted"></p>
    <div style="display:flex; gap: var(--space-1)"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-sync">同期を始めてホームへ</button></div>`;
}

function bind() {
  const $ = (id) => document.getElementById(id);
  document.querySelectorAll('[data-setup-back]').forEach((b) => (b.onclick = () => ((step = Math.max(0, step - 1)), reload())));
  if ($('su-detect'))
    $('su-detect').onclick = async () => {
      draft.url = $('su-url').value.trim();
      const r = await api['setup.detect']({url: draft.url});
      if (r.error) return toast(r.error);
      draft.candidates = r.candidates;
      draft.base = r.base;
      const top = r.candidates[0];
      draft.connectorId = top?.connectorId ?? null;
      draft.kind = top?.kind ?? null;
      reload();
    };
  document.querySelectorAll('input[name=cand]').forEach((r) => (r.onchange = () => ([draft.connectorId, draft.kind] = r.value.split('|'))));
  if ($('su-next1'))
    $('su-next1').onclick = async () => {
      if (!$('su-tos').checked) return toast('規約の確認にチェックを入れてください');
      const r = await api['setup.createConnection']({connectorId: draft.connectorId, kind: draft.kind, baseUrl: draft.base || draft.url});
      if (r.error) return toast(r.error);
      draft.connectionId = r.connectionId;
      step = 1;
      reload();
    };
  if ($('su-login'))
    $('su-login').onclick = async () => {
      if (draft.kind === 'api') {
        const r1 = await api['connection.savePassword']({connectionId: draft.connectionId, user: $('su-user').value, password: $('su-pass').value});
        if (r1.error) return toast(r1.error);
        $('su-login-msg').textContent = 'ログイン中…';
        const r2 = await api['connection.login']({connectionId: draft.connectionId});
        if (r2.error || !r2.ok) return ($('su-login-msg').textContent = r2.message || r2.error || 'ログインできませんでした');
        const list = await api['courses.list']({connectionId: draft.connectionId});
        draft.courses = Array.isArray(list) ? list : [];
      }
      step = 2;
      reload();
    };
  if ($('su-next3')) $('su-next3').onclick = () => ((step = 3), reload());
  if ($('su-next4'))
    $('su-next4').onclick = async () => {
      const r = await api['term.save']({term: {year: Number($('su-year').value), label: $('su-label').value, start: $('su-start').value, end: $('su-end').value, rounds: Number($('su-rounds').value), preset: $('su-preset').value}});
      if (r.error) return toast(r.error);
      step = 4;
      reload();
    };
  if ($('su-next5')) $('su-next5').onclick = () => ((step = 5), reload());
  if ($('su-sync'))
    $('su-sync').onclick = async () => {
      await api['sync.run']({full: true});
      step = 0;
      draft = {url: '', candidates: [], connectorId: null, kind: null, base: '', connectionId: null, courses: []};
      location.hash = '#/';
    };
}
