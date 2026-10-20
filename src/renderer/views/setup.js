// 初回セットアップ（SPEC §6.3）。1 ページ 1 手順、付箋が順に貼られる表現。M0 は Moodle（ID・パスワード）と画面操作型（ブラウザ窓）・学期・保存先まで。
import {esc, reload, toast} from '../app.js';
import {termForm, readTermForm} from './term.js';

const api = window.daigaku;
const steps = ['LMS の URL', 'ログイン', '授業の確認', '学期の設定', '保存先', '最初の同期'];
const blank = () => ({
  url: '',
  candidates: [],
  connectorId: null,
  kind: null,
  base: '',
  connectionId: null,
  courses: [],
  coursesLoaded: false
});
let step = 0;
let draft = blank();

/** 別の画面からセットアップに入ったときは最初の手順から（app.js が呼ぶ） */
export function resetSetup() {
  step = 0;
  draft = blank();
}

const KIND_LABEL = {api: 'API で読む', recipe: '画面を読む', generic: '汎用の読み取り', manual: '手動で取り込む'};

export function renderSetup({data}) {
  const list = steps
    .map((s, i) => {
      const cls = i < step ? 'steps__item--done' : i === step ? 'steps__item--current' : '';
      return `<li class="steps__item ${cls}" style="--sticky-color: var(--c${(i % 8) + 1}); --sticky-angle: ${(i % 2 ? 1 : -1) * 1.5}deg"${i === step ? ' aria-current="step"' : ''}>${i + 1}. ${esc(s)}</li>`;
    })
    .join('');
  const body = [stepUrl, stepLogin, stepCourses, stepTerm, stepRoot, stepSync][step](data);
  queueMicrotask(bind);
  return `<div style="max-width: 720px"><ol class="steps" aria-label="セットアップの手順">${list}</ol><section class="card">${body}</section></div>`;
}

function stepUrl() {
  return `<h2>1. LMS の URL を入れる</h2>
    <p class="muted">大学の LMS（Moodle・manaba・WebClass・manabo など）のトップページの URL を入れて「種類を判定」を押します。LMS をつなぐと、授業の資料を自動で集めます。</p>
    <p class="muted">LMS の登録は任意です。つながずに、自分で作るフォルダやパソコンのフォルダだけで使うこともできます（あとから 設定 → 接続 でつなげます）。<button class="btn btn--small" data-action="skip-setup">LMS をつながずに使う</button></p>
    <label class="sr-only" for="su-url">LMS の URL</label>
    <input class="input" id="su-url" type="url" placeholder="https://lms.example-u.ac.jp/" value="${esc(draft.url)}">
    <div id="su-cands" style="margin: var(--space-2) 0">${draft.candidates.map((c) => `<label style="display:block"><input type="radio" name="cand" value="${esc(c.connectorId)}|${esc(c.kind)}" ${c.connectorId === draft.connectorId ? 'checked' : ''}> ${esc(c.name)} <span class="muted">${esc(KIND_LABEL[c.kind] ?? c.kind)}${c.score ? ` ・ 確からしさ ${Math.round(c.score * 100)}%` : ''}</span></label>`).join('')}</div>
    <label style="display:block; margin: var(--space-2) 0"><input type="checkbox" id="su-tos"> 自分の大学の規約で、学習支援ツールによる自動操作が禁じられていないことを確かめました</label>
    <div class="actions"><button class="btn" id="su-detect">種類を判定</button><button class="btn btn--primary" id="su-next1" ${draft.connectorId ? '' : 'disabled'}>次へ</button></div>
    ${draft.connectorId ? '' : '<p class="muted">先に「種類を判定」を押すと「次へ」が押せます。</p>'}`;
}
function stepLogin() {
  const body =
    draft.kind === 'api'
      ? `<p class="muted">Moodle の ID とパスワードを入れます。このパソコンの中だけに暗号化して保存し、トークンを取得します。</p>
         <label class="sr-only" for="su-user">ID</label><input class="input" id="su-user" placeholder="ID" autocomplete="username">
         <label class="sr-only" for="su-pass">パスワード</label><input class="input" id="su-pass" type="password" placeholder="パスワード" autocomplete="current-password" style="margin-top: var(--space-1)">`
      : draft.kind === 'recipe'
        ? `<p class="muted">この LMS は、ブラウザの窓を開いてログインします。窓でいつもどおりログインすると、窓は自動で閉じます。あとで（設定 → 接続 の「ログインし直す」から）ログインしてもかまいません。</p>
           <label style="display:block; margin: var(--space-2) 0 var(--space-1)"><input type="checkbox" id="su-auto" checked> 次回から自動でログインする（ID とパスワードを、このパソコンの中だけに暗号化して保存します）</label>
           <div id="su-auto-fields">
             <label class="sr-only" for="su-user">ID</label><input class="input" id="su-user" placeholder="ID（学籍番号など）" autocomplete="username">
             <label class="sr-only" for="su-pass">パスワード</label><input class="input" id="su-pass" type="password" placeholder="パスワード" autocomplete="current-password" style="margin-top: var(--space-1)">
             <p class="muted">開いた窓にも ID とパスワードを入れておくので、「ログイン」を押すだけです。大学からメールで届く認証コードを聞かれたときだけ、コードを入れてください（アプリはメールを読みません）。</p>
           </div>`
        : `<p class="muted">この接続では、ここでのログインはありません。次へ進んでください。</p>`;
  const main = draft.kind === 'api' ? 'ログインして次へ' : draft.kind === 'recipe' ? 'ログイン窓を開く' : '次へ';
  return `<h2>2. ログイン</h2>
    ${body}
    <p id="su-login-msg" class="muted" role="status"></p>
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-login">${main}</button>${draft.kind === 'recipe' ? '<button class="btn" id="su-skip">あとでログインする</button>' : ''}</div>`;
}
function stepCourses() {
  const list = draft.courses.length
    ? `<p class="muted">同期する授業を選びます（既定は全部）。外した授業は同期せず、ホームでは「非表示」にまとめます（設定 → 授業 で戻せます）。</p>
       <div id="su-courses">${draft.courses.map((c, i) => `<label style="display:block"><input type="checkbox" id="su-c${i}" checked data-lms="${esc(c.lmsId)}"> ${esc(c.name)}${c.weekday ? ` <span class="muted">${esc(c.weekday)}曜${c.period ? ` ${c.period}限` : ''}</span>` : ''}</label>`).join('')}</div>`
    : `<p class="muted">${draft.coursesLoaded ? '授業が取れませんでした。ログインできているか、学期が始まっているかを確かめてください。' : 'まだ授業の一覧を読んでいません（ログインがまだのため）。'}最初の同期で、全部の授業を取り込みます。</p>`;
  return `<h2>3. 授業の確認</h2>
    ${list}
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-next3">次へ</button></div>`;
}
function stepTerm(data) {
  return `<h2>4. 学期の設定</h2>
    <p class="muted">学期名と期間、回数、時限の開始時刻。大学ごとに違うので、ここで入れます。</p>
    ${termForm(data, null)}
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-next4">保存して次へ</button></div>`;
}
function stepRoot(data) {
  return `<h2>5. 保存先</h2>
    <p>資料はここに「学期 → 授業 → 回」のフォルダで保存します。</p>
    <p><code>${esc(data.settings.root)}</code></p>
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn" data-action="pick-dir">フォルダを選択…</button><button class="btn btn--primary" id="su-next5">次へ</button></div>`;
}
function stepSync() {
  return `<h2>6. 最初の同期</h2>
    <p class="muted">全授業・全回の資料を取り込みます。数分かかることがあります。進み具合はホームの下に出ます。</p>
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-sync">同期を始めてホームへ</button></div>`;
}

async function loadCourses() {
  const list = await api['courses.list']({connectionId: draft.connectionId});
  draft.courses = Array.isArray(list) ? list : [];
  draft.coursesLoaded = true;
}

function bind() {
  const $ = (id) => document.getElementById(id);
  document
    .querySelectorAll('[data-setup-back]')
    .forEach((b) => (b.onclick = () => ((step = Math.max(0, step - 1)), reload())));
  const detect = async () => {
    draft.url = $('su-url').value.trim();
    if (!draft.url) return toast('LMS の URL を入れてください', {error: true});
    const r = await api['setup.detect']({url: draft.url});
    if (r.error) return toast(r.error, {error: true});
    draft.candidates = r.candidates;
    draft.base = r.base;
    const top = r.candidates[0];
    draft.connectorId = top?.connectorId ?? null;
    draft.kind = top?.kind ?? null;
    reload();
  };
  if ($('su-detect')) $('su-detect').onclick = detect;
  if ($('su-url')) $('su-url').onkeydown = (e) => e.key === 'Enter' && detect();
  document
    .querySelectorAll('input[name=cand]')
    .forEach((r) => (r.onchange = () => ([draft.connectorId, draft.kind] = r.value.split('|'))));
  if ($('su-next1'))
    $('su-next1').onclick = async () => {
      if (!$('su-tos').checked) return toast('規約の確認にチェックを入れてください', {error: true});
      const r = await api['setup.createConnection']({
        connectorId: draft.connectorId,
        kind: draft.kind,
        baseUrl: draft.base || draft.url
      });
      if (r.error) return toast(r.error, {error: true});
      draft.connectionId = r.connectionId;
      step = 1;
      reload();
    };
  if ($('su-login'))
    $('su-login').onclick = async () => {
      const btn = $('su-login');
      const msg = $('su-login-msg');
      if (draft.kind === 'api') {
        const r1 = await api['connection.savePassword']({
          connectionId: draft.connectionId,
          user: $('su-user').value,
          password: $('su-pass').value
        });
        if (r1.error) return toast(r1.error, {error: true});
        msg.textContent = 'ログイン中…';
        btn.disabled = true;
        const r2 = await api['connection.login']({connectionId: draft.connectionId});
        btn.disabled = false;
        if (r2.error || !r2.ok) return (msg.textContent = r2.message || r2.error || 'ログインできませんでした');
        await loadCourses();
      } else if (draft.kind === 'recipe') {
        if ($('su-auto').checked) {
          const r0 = await api['connection.savePassword']({
            connectionId: draft.connectionId,
            user: $('su-user').value,
            password: $('su-pass').value
          });
          if (r0.error) return toast(r0.error, {error: true});
        }
        msg.textContent = 'ログインの窓を開いています。窓でログインしてください…';
        btn.disabled = true;
        const r = await api['connection.login']({connectionId: draft.connectionId, mode: 'visible'});
        btn.disabled = false;
        if (r.error || !r.ok)
          return (msg.textContent = `${r.message || r.error || 'ログインできませんでした'}（「あとでログインする」で先へ進めます）`);
        msg.textContent = '授業の一覧を読んでいます…';
        await loadCourses();
      }
      step = 2;
      reload();
    };
  if ($('su-skip')) $('su-skip').onclick = () => ((step = 2), reload());
  if ($('su-auto')) {
    const sync = () => ($('su-auto-fields').hidden = !$('su-auto').checked);
    $('su-auto').onchange = sync;
    sync();
  }
  if ($('su-next3'))
    $('su-next3').onclick = async () => {
      const off = [...document.querySelectorAll('#su-courses input[data-lms]')]
        .filter((c) => !c.checked)
        .map((c) => c.dataset.lms);
      if (draft.connectionId && draft.courses.length) {
        const r = await api['setup.excludeCourses']({connectionId: draft.connectionId, lmsIds: off});
        if (r?.error) return toast(r.error, {error: true});
      }
      step = 3;
      reload();
    };
  if ($('su-next4'))
    $('su-next4').onclick = async () => {
      const r = await api['term.save']({term: readTermForm(null)});
      if (r.error) return toast(r.error, {error: true});
      step = 4;
      reload();
    };
  if ($('su-next5')) $('su-next5').onclick = () => ((step = 5), reload());
  if ($('su-sync'))
    $('su-sync').onclick = async () => {
      const r = await api['sync.run']({full: true});
      if (r?.error) return toast(r.error, {error: true});
      resetSetup();
      location.hash = '#/';
    };
}
