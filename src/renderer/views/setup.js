// セットアップ（SPEC §6.3）。1 ページ 1 手順、付箋が順に貼られる表現。
// 初回（#/setup）は あなた・使い方・授業の資料・（利用規約）・学期・保存先。LMS とつなぐ手順（#/settings/lms）は設定画面の「LMS との連携」から入る
// （利用規約に同意していなければ最初に同意。Moodle の ID・パスワードと画面操作型のブラウザ窓。学期がまだなければ学期の設定も挟む）
import {esc, reload, toast} from '../app.js';
import {termForm, readTermForm} from './term.js';
import {ROLES, USES, features} from '../../shared/profile.js';
import {LMS_FEATURE, LMS_NOTICE, LMS_TERMS, LMS_TERMS_VERSION} from '../../shared/lms-terms.js';

const api = window.daigaku;
const FLOWS = {
  first: [
    ['あなた', stepRole],
    ['使い方', stepUses],
    ['授業の資料', stepMaterials],
    ['利用規約', stepLmsTerms],
    ['学期の設定', stepTerm],
    ['保存先', stepRoot]
  ],
  lms: [
    ['利用規約', stepLmsTerms],
    ['LMS の URL', stepUrl],
    ['ログイン', stepLogin],
    ['授業の確認', stepCourses],
    ['学期の設定', stepTerm],
    ['最初の同期', stepSync]
  ]
};
let flow = FLOWS.first;
let steps = flow; // いまの手順（stepsOf で、選んだものに合わない手順を外す）
const blank = () => ({
  url: '',
  candidates: [],
  connectorId: null,
  kind: null,
  base: '',
  connectionId: null,
  courses: [],
  coursesLoaded: false,
  role: null,
  uses: null,
  university: null,
  materials: null, // 授業の資料の集め方：'folder'（PC の授業フォルダ）・'service'（大学サービスとの連携）・'later'
  imported: null, // 取り込んだ授業フォルダの結果
  agreed: false // この回のセットアップで利用規約に同意した（同意したあとも手順の番号がずれないよう、規約の手順は残す）
});
let step = 0;
let draft = blank();

/** 別の画面からセットアップに入ったときは最初の手順から（app.js が呼ぶ）。kind は 'first'（初回）か 'lms'（LMS とつなぐ） */
export function resetSetup(kind = 'first', data = null) {
  step = 0;
  draft = blank();
  // LMS とつなぐときの学期の設定は、学期がまだないときだけ
  // 社会人は学期を使わないので、学期の設定を挟まない
  const terms = features({role: data?.settings?.role, uses: []}).terms;
  flow = kind === 'lms' ? FLOWS.lms.filter(([name]) => name !== '学期の設定' || (terms && !data?.terms?.length)) : FLOWS.first;
}
const termsAccepted = (data) => data.settings.lmsTerms?.version === LMS_TERMS_VERSION;
/** 選んだものに合わせた手順。授業の資料は大学生で「授業の資料を活用」を選んだときだけ、利用規約は大学サービスとつなぐときだけ（同意済みなら出さない） */
function stepsOf(data) {
  const role = draft.role ?? data.settings.role;
  const uses = draft.uses ?? data.settings.uses ?? [];
  const needTerms = !termsAccepted(data) || draft.agreed;
  return flow.filter(([name]) => {
    if (name === '利用規約') return needTerms && (flow === FLOWS.lms || draft.materials === 'service');
    if (flow !== FLOWS.first) return true;
    if (name === '授業の資料') return role === 'student' && uses.includes('lms');
    if (name === '学期の設定') return features({role, uses: []}).terms;
    return true;
  });
}
const next = () => ((step = Math.min(step + 1, steps.length - 1)), reload());

const KIND_LABEL = {api: 'API で読む', recipe: '画面を読む', generic: '汎用の読み取り', manual: '手動で取り込む'};

export function renderSetup({data}) {
  steps = stepsOf(data);
  step = Math.min(step, steps.length - 1);
  const list = steps
    .map(([s], i) => {
      const cls = i < step ? 'steps__item--done' : i === step ? 'steps__item--current' : '';
      return `<li class="steps__item ${cls}" style="--sticky-color: var(--c${(i % 8) + 1}); --sticky-angle: ${(i % 2 ? 1 : -1) * 1.5}deg"${i === step ? ' aria-current="step"' : ''}>${i + 1}. ${esc(s)}</li>`;
    })
    .join('');
  const body = steps[step][1](data, step + 1);
  queueMicrotask(bind);
  const title = flow === FLOWS.first ? 'はじめに' : 'LMS とつなぐ';
  return `<div style="max-width: 720px"><p class="muted" style="margin: 0 0 var(--space-1)">${title}</p><ol class="steps" aria-label="${title}の手順">${list}</ol><section class="card">${body}</section></div>`;
}

function stepUrl(data, n) {
  return `<h2>${n}. LMS の URL を入れる</h2>
    <p class="muted">大学の LMS（Moodle・manaba・WebClass・manabo など）のトップページの URL を入れて「種類を判定」を押します。LMS をつなぐと、授業の資料を自動で集めます。</p>
    <label class="sr-only" for="su-url">LMS の URL</label>
    <input class="input" id="su-url" type="url" placeholder="https://lms.example-u.ac.jp/" value="${esc(draft.url)}">
    <div id="su-cands" style="margin: var(--space-2) 0">${draft.candidates.map((c) => `<label style="display:block"><input type="radio" name="cand" value="${esc(c.connectorId)}|${esc(c.kind)}" ${c.connectorId === draft.connectorId ? 'checked' : ''}> ${esc(c.name)} <span class="muted">${esc(KIND_LABEL[c.kind] ?? c.kind)}${c.score ? ` ・ 確からしさ ${Math.round(c.score * 100)}%` : ''}</span></label>`).join('')}</div>
    <div class="actions"><button class="btn" data-action="nav" data-route="/settings">やめる</button><button class="btn" id="su-detect">種類を判定</button><button class="btn btn--primary" id="su-next1" ${draft.connectorId ? '' : 'disabled'}>次へ</button></div>
    ${draft.connectorId ? '' : '<p class="muted">先に「種類を判定」を押すと「次へ」が押せます。</p>'}`;
}
function stepLogin(data, n) {
  const body =
    draft.kind === 'api'
      ? `<p class="muted">Moodle の ID とパスワードを入れます。このパソコンの中だけに暗号化して保存し、トークンを取得します。</p>
         <label class="sr-only" for="su-user">ID</label><input class="input" id="su-user" placeholder="ID" autocomplete="username">
         <label class="sr-only" for="su-pass">パスワード</label><input class="input" id="su-pass" type="password" placeholder="パスワード" autocomplete="current-password" style="margin-top: var(--space-1)">`
      : draft.kind === 'recipe'
        ? `<p class="muted">この LMS は、ブラウザの窓を開いてログインします。窓でいつもどおりログインすると、窓は自動で閉じます。あとで（設定 → LMS との連携 の「ログインし直す」から）ログインしてもかまいません。</p>
           <label style="display:block; margin: var(--space-2) 0 var(--space-1)"><input type="checkbox" id="su-auto" checked> 次回から自動でログインする（ID とパスワードを、このパソコンの中だけに暗号化して保存します）</label>
           <div id="su-auto-fields">
             <label class="sr-only" for="su-user">ID</label><input class="input" id="su-user" placeholder="ID（学籍番号など）" autocomplete="username">
             <label class="sr-only" for="su-pass">パスワード</label><input class="input" id="su-pass" type="password" placeholder="パスワード" autocomplete="current-password" style="margin-top: var(--space-1)">
             <p class="muted">開いた窓にも ID とパスワードを入れておくので、「ログイン」を押すだけです。大学からメールで届く認証コードを聞かれたときだけ、コードを入れてください（アプリはメールを読みません）。</p>
           </div>`
        : `<p class="muted">この接続では、ここでのログインはありません。次へ進んでください。</p>`;
  const main = draft.kind === 'api' ? 'ログインして次へ' : draft.kind === 'recipe' ? 'ログイン窓を開く' : '次へ';
  return `<h2>${n}. ログイン</h2>
    ${body}
    <p id="su-login-msg" class="muted" role="status"></p>
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-login">${main}</button>${draft.kind === 'recipe' ? '<button class="btn" id="su-skip">あとでログインする</button>' : ''}</div>`;
}
function stepCourses(data, n) {
  const list = draft.courses.length
    ? `<p class="muted">同期する授業を選びます（既定は全部）。外した授業は同期せず、ホームでは「非表示」にまとめます（設定 → 授業 で戻せます）。</p>
       <div id="su-courses">${draft.courses.map((c, i) => `<label style="display:block"><input type="checkbox" id="su-c${i}" checked data-lms="${esc(c.lmsId)}"> ${esc(c.name)}${c.weekday ? ` <span class="muted">${esc(c.weekday)}曜${c.period ? ` ${c.period}限` : ''}</span>` : ''}</label>`).join('')}</div>`
    : `<p class="muted">${draft.coursesLoaded ? '授業が取れませんでした。ログインできているか、学期が始まっているかを確かめてください。' : 'まだ授業の一覧を読んでいません（ログインがまだのため）。'}最初の同期で、全部の授業を取り込みます。</p>`;
  return `<h2>${n}. 授業の確認</h2>
    ${list}
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-next3">次へ</button></div>`;
}
// 使う人を選ぶ。大学生のときだけ大学名を入れる（いまは記録するだけ）
function stepRole(data, n) {
  const role = draft.role ?? data.settings.role;
  const university = draft.university ?? data.settings.university ?? '';
  return `<h2>${n}. あなたについて</h2>
    <div class="role-pick" role="radiogroup" aria-label="使う人">${Object.entries(ROLES)
      .map(([k, l]) => `<button type="button" class="role-pick__item" role="radio" data-role="${k}" aria-checked="${role === k}">${l}</button>`)
      .join('')}</div>
    ${role === 'student' ? `<label class="role-pick__univ">大学名<input class="input" id="su-univ" maxlength="60" placeholder="例：〇〇大学" value="${esc(university)}"></label>` : ''}
    <div class="actions"><button class="btn btn--primary" id="su-role" ${role ? '' : 'disabled'}>次へ</button></div>`;
}
// 使い方を選ぶ（いくつでも）。ホームの並びと設定の項目がこれに合わせて変わる
function stepUses(data, n) {
  const role = draft.role ?? data.settings.role ?? 'student';
  const uses = draft.uses ?? data.settings.uses ?? [];
  return `<h2>${n}. 何に使いますか</h2>
    <p class="muted">いくつでも選べます（あとから 設定 → 使い方 で変えられます）。</p>
    <div class="use-pick" role="group" aria-label="使い方">${USES[role]
      .map(
        ([k, l, d]) =>
          `<button type="button" class="use-pick__item" data-use="${k}" aria-pressed="${uses.includes(k)}"><strong>${l}</strong><span class="muted">${d}</span></button>`
      )
      .join('')}</div>
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-uses" ${uses.length ? '' : 'disabled'}>次へ</button></div>`;
}
// 授業の資料の集め方を選ぶ。PC の授業フォルダはその場で取り込む。大学サービスとの連携は、次の手順で利用規約に同意してから
const MATERIALS = [
  ['folder', 'PC内の授業フォルダを取り込む', '授業ごとのフォルダが入ったフォルダを選ぶと、そのまま使えます（コピーしません）'],
  ['service', LMS_FEATURE, '大学の LMS から授業の資料を自動でダウンロードします'],
  ['later', 'あとで設定', '設定からいつでも選べます']
];
function stepMaterials(data, n) {
  const m = draft.materials;
  const r = draft.imported;
  const done = r ? `<p role="status">${r.added.length ? `${r.added.length} 個の授業フォルダを取り込みました（${r.added.map(esc).join('・')}）` : '取り込めるフォルダがありませんでした'}${r.failed.length ? `<br><span class="muted">取り込めなかったもの：${r.failed.map((f) => `${esc(f.name)}（${esc(f.message)}）`).join('・')}</span>` : ''}</p>` : '';
  return `<h2>${n}. 授業の資料をどうしますか</h2>
    <div class="use-pick use-pick--one" role="radiogroup" aria-label="授業の資料の集め方">${MATERIALS.map(
      ([k, l, d]) => `<button type="button" class="use-pick__item" role="radio" data-materials="${k}" aria-checked="${m === k}"><strong>${esc(l)}</strong><span class="muted">${esc(d)}</span></button>`
    ).join('')}</div>
    ${m === 'folder' ? `<div class="actions"><button class="btn" id="su-import">フォルダを選ぶ…</button></div>${done}` : ''}
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-materials" ${m ? '' : 'disabled'}>次へ</button></div>`;
}
// 大学サービスとの連携の注意書きと利用規約。同意にチェックしないと先へ進めない
function stepLmsTerms(data, n) {
  const ok = draft.agreed;
  return `<h2>${n}. ${esc(LMS_FEATURE)}の利用規約</h2>
    <aside class="sticky lms-notice" style="--sticky-color: var(--c2)"><strong>使う前に</strong><ul>${LMS_NOTICE.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></aside>
    <div class="lms-terms" tabindex="0" role="document" aria-label="利用規約">
      <h3>${esc(LMS_FEATURE)} 利用規約</h3>
      <ol>${LMS_TERMS.map(([h, t]) => `<li><strong>${esc(h)}</strong><p>${esc(t)}</p></li>`).join('')}</ol>
      <p class="muted">${esc(LMS_TERMS_VERSION.replace(/-/g, '/'))} 版</p>
    </div>
    <label class="lms-terms__agree"><input type="checkbox" id="su-agree" ${ok ? 'checked' : ''}> 注意書きを読み、上の利用規約に同意します</label>
    <div class="actions">${n > 1 ? '<button class="btn" data-setup-back>戻る</button>' : '<button class="btn" data-action="nav" data-route="/settings">やめる</button>'}<button class="btn btn--primary" id="su-terms" ${ok ? '' : 'disabled'}>同意して次へ</button></div>`;
}
function stepTerm(data, n) {
  return `<h2>${n}. 学期の設定</h2>
    <p class="muted">学期の名前と期間、回数、時限の開始時刻を入れます（あとから 設定 → 学期 で直せます）。</p>
    ${termForm(data, null)}
    <div class="actions">${n > 1 ? '<button class="btn" data-setup-back>戻る</button>' : ''}<button class="btn btn--primary" id="su-next4">保存して次へ</button></div>`;
}
function stepRoot(data, n) {
  const f = features(data.settings);
  // 大学サービスとの連携を選んだ大学生と、講座で LMS を使う社会人は、そのまま LMS とつなぐ手順へ
  const toLms = data.settings.role === 'student' ? draft.materials === 'service' : f.lms;
  return `<h2>${n}. 保存先</h2>
    <p>${f.terms ? '資料はここに「学期 → 授業 → 回」のフォルダで保存します。' : '資料はここに保存します。'}</p>
    <p><code>${esc(data.settings.root)}</code></p>
    ${toLms ? '<p class="muted">「始める」のあと、大学サービスとつなぐ手順に進みます。</p>' : ''}
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn" data-action="pick-dir">フォルダを選択…</button><button class="btn btn--primary" data-action="finish-setup"${toLms ? ' data-next="/settings/lms"' : ''}>始める</button></div>`;
}
function stepSync(data, n) {
  return `<h2>${n}. 最初の同期</h2>
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
  document.querySelectorAll('[data-role]').forEach(
    (b) =>
      (b.onclick = () => {
        if ($('su-univ')) draft.university = $('su-univ').value;
        if (draft.role !== b.dataset.role) draft.uses = null; // 人を変えたら使い方は選び直す
        draft.role = b.dataset.role;
        reload();
      })
  );
  if ($('su-role'))
    $('su-role').onclick = async () => {
      const role = draft.role ?? document.querySelector('[data-role][aria-checked=true]')?.dataset.role;
      const university = $('su-univ')?.value.trim() ?? '';
      const r = await api['settings.update']({patch: {role, ...(role === 'student' ? {university} : {})}});
      if (r?.error) return toast(r.error, {error: true});
      draft.role = role;
      next();
    };
  document.querySelectorAll('[data-use]').forEach(
    (b) =>
      (b.onclick = () => {
        const now = [...document.querySelectorAll('[data-use][aria-pressed=true]')].map((x) => x.dataset.use);
        draft.uses = now.includes(b.dataset.use) ? now.filter((u) => u !== b.dataset.use) : [...now, b.dataset.use];
        reload();
      })
  );
  if ($('su-uses'))
    $('su-uses').onclick = async () => {
      const uses = [...document.querySelectorAll('[data-use][aria-pressed=true]')].map((x) => x.dataset.use);
      const r = await api['settings.update']({patch: {uses}});
      if (r?.error) return toast(r.error, {error: true});
      next();
    };
  document.querySelectorAll('[data-materials]').forEach(
    (b) =>
      (b.onclick = () => {
        draft.materials = b.dataset.materials;
        reload();
      })
  );
  if ($('su-import'))
    $('su-import').onclick = async () => {
      const r = await api['folder.importCourses']();
      if (r?.error) return toast(r.error, {error: true});
      if (r.canceled) return;
      draft.imported = r;
      reload();
    };
  if ($('su-materials')) $('su-materials').onclick = next;
  if ($('su-agree')) $('su-agree').onchange = (e) => ($('su-terms').disabled = !e.target.checked);
  if ($('su-terms'))
    $('su-terms').onclick = async () => {
      if (!$('su-agree').checked) return;
      const r = await api['settings.update']({patch: {acceptLmsTerms: LMS_TERMS_VERSION}});
      if (r?.error) return toast(r.error, {error: true});
      draft.agreed = true;
      next();
    };
  if ($('su-detect')) $('su-detect').onclick = detect;
  if ($('su-url')) $('su-url').onkeydown = (e) => e.key === 'Enter' && detect();
  document
    .querySelectorAll('input[name=cand]')
    .forEach((r) => (r.onchange = () => ([draft.connectorId, draft.kind] = r.value.split('|'))));
  if ($('su-next1'))
    $('su-next1').onclick = async () => {
      const r = await api['setup.createConnection']({
        connectorId: draft.connectorId,
        kind: draft.kind,
        baseUrl: draft.base || draft.url
      });
      if (r.error) return toast(r.error, {error: true});
      draft.connectionId = r.connectionId;
      next();
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
      next();
    };
  if ($('su-skip')) $('su-skip').onclick = next;
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
      next();
    };
  if ($('su-next4'))
    $('su-next4').onclick = async () => {
      const r = await api['term.save']({term: readTermForm(null)});
      if (r.error) return toast(r.error, {error: true});
      next();
    };
  if ($('su-sync'))
    $('su-sync').onclick = async () => {
      const r = await api['sync.run']({full: true});
      if (r?.error) return toast(r.error, {error: true});
      resetSetup();
      location.hash = '#/';
    };
}
