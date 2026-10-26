// セットアップ（SPEC §6.3）。1 ページ 1 手順、付箋が順に貼られる表現。手順は多くても 6（SPEC §6.3）。
// 初回（#/setup）は あなたと使い方・授業の資料・（利用規約）・学期と保存先、大学の LMS とつなぐ人はそのまま LMS とつなぐ（URL とログイン）・授業の確認と同期（1 本の連番）。
// あとから LMS とつなぐ手順（#/settings/lms）は 設定 → 大学の LMS から入る
// （利用規約に同意していなければ最初に同意。Moodle の ID・パスワードと画面操作型のブラウザ窓。学期がまだなければ学期の設定も挟む）
import {esc, toast} from '../ui-kit.js';
import {navigate, reload} from '../store.js';
import {termForm, readTermForm} from './term.js';
import {ROLES, USES, features} from '../../shared/profile.js';
import {LMS_FEATURE, LMS_NOTICE, LMS_TERMS, LMS_TERMS_VERSION} from '../../shared/lms-terms.js';

const api = window.daigaku;
const FLOWS = {
  // 初回は 1 本の連番。大学の LMS とつなぐ人は、保存先のあとも同じ番号の続きで LMS の手順へ（番号が 1 に戻らない）
  first: [
    ['あなたと使い方', stepProfile],
    ['授業の資料', stepMaterials],
    ['利用規約', stepLmsTerms],
    ['学期と保存先', stepTermRoot], // 学期を使わない人（社会人）には「保存先」と出す
    ['LMS とつなぐ', stepLms],
    ['授業の確認と同期', stepCoursesSync]
  ],
  // 規約の版が上がったとき、今ある接続のために同意し直すだけの手順
  terms: [['利用規約', stepLmsTerms]],
  lms: [
    ['利用規約', stepLmsTerms],
    ['LMS とつなぐ', stepLms],
    ['学期の設定', stepTerm],
    ['授業の確認と同期', stepCoursesSync]
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
  materials: null, // 授業の資料の集め方：'folder'（PC の授業フォルダ）・'service'（大学の LMS とつなぐ）・'later'
  imported: null, // 取り込んだ授業フォルダの結果
  detected: false, // 「種類を判定」を押した（候補がなければ、まだ対応していないと知らせる）
  label: null, // 学習支援サービスの名前（自分で付ける。空なら判定した種類の名前）
  term: null, // 「学期と保存先」で入れかけの学期（保存先を選んで描き直しても消えないように）
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
  flow =
    kind === 'lms'
      ? FLOWS.lms.filter(([name]) => name !== '学期の設定' || (terms && !data?.terms?.length))
      : kind === 'terms'
        ? FLOWS.terms
        : FLOWS.first;
}
const termsAccepted = (data) => data.settings.lmsTerms?.version === LMS_TERMS_VERSION;
const LMS_STEPS = new Set(['LMS とつなぐ', '授業の確認と同期']);
/** 初回の流れで、大学の LMS とつなぐ手順まで進む人か：大学生は「授業の資料」で LMS を選んだとき、社会人は講座で LMS を使うとき */
function wantsLms(data) {
  const role = draft.role ?? data.settings.role;
  const uses = draft.uses ?? data.settings.uses ?? [];
  return role === 'student' ? draft.materials === 'service' : features({role, uses}).lms;
}
/** 選んだものに合わせた手順。授業の資料は大学生で「授業の資料を活用」を選んだときだけ、利用規約と LMS の手順は大学の LMS とつなぐときだけ（同意済みなら規約は出さない） */
function stepsOf(data) {
  const role = draft.role ?? data.settings.role;
  const uses = draft.uses ?? data.settings.uses ?? [];
  const needTerms = !termsAccepted(data) || draft.agreed;
  return flow
    .filter(([name]) => {
      // flow は FLOWS.lms を filter した別の配列なので、=== FLOWS.lms では比べない
      if (name === '利用規約') return needTerms && (flow !== FLOWS.first || wantsLms(data));
      if (flow !== FLOWS.first) return true;
      if (LMS_STEPS.has(name)) return wantsLms(data);
      if (name === '授業の資料') return role === 'student' && uses.includes('lms');
      return true;
    })
    .map(([name, fn]) => [name === '学期と保存先' && !features({role, uses: []}).terms ? '保存先' : name, fn]);
}
const next = () => ((step = Math.min(step + 1, steps.length - 1)), reload());

const KIND_LABEL = {manual: '手動で取り込む'}; // 候補には名前だけを出す（読み取りの方式や確からしさは使う人には関係がない）

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
  const title = flow === FLOWS.first ? 'はじめに' : flow === FLOWS.terms ? '利用規約への同意' : 'LMS とつなぐ';
  return `<div style="max-width: 720px"><p class="muted" style="margin: 0 0 var(--space-1)">${title}</p><ol class="steps" aria-label="${title}の手順">${list}</ol><section class="card">${body}</section></div>`;
}

// 大学の LMS とつなぐ：URL を入れて種類を判定し、接続ができたら同じ画面でログイン（2 つの画面を 1 つに。SPEC §6.3 の手順 1・2）
function stepLms(data, n) {
  const back =
    n > 1
      ? '<button class="btn" data-setup-back>戻る</button>'
      : '<button class="btn" data-action="nav" data-route="/settings">やめる</button>';
  if (!draft.connectionId)
    return `<h2>${n}. 大学の LMS とつなぐ</h2>
    <p class="muted">大学の LMS（manaba・Moodle などの学習支援サービス）のトップページの URL を入れて「種類を判定」を押します。いま使えるのは Moodle と manabo（試験中）です。つなぐと、授業の資料を自動で集めます。</p>
    <label class="sr-only" for="su-url">LMS の URL</label>
    <input class="input" id="su-url" type="url" placeholder="https://lms.example-u.ac.jp/" value="${esc(draft.url)}">
    <div id="su-cands" style="margin: var(--space-2) 0">${draft.candidates.map((c) => `<label style="display:block"><input type="radio" name="cand" value="${esc(c.connectorId)}|${esc(c.kind)}" ${c.connectorId === draft.connectorId ? 'checked' : ''}> ${esc(c.name)}${c.kind === 'manual' ? ` <span class="muted">${esc(KIND_LABEL.manual)}</span>` : ''}</label>`).join('')}</div>
    ${draft.connectorId ? `<label class="su-label">LMS の名前（ホームや設定に出ます）<input class="input" id="su-label" maxlength="60" placeholder="例：manaba・〇〇大学 LMS" value="${esc(draft.label ?? draft.candidates.find((c) => c.connectorId === draft.connectorId)?.name ?? '')}"></label>` : ''}
    <div class="actions">${back}<button class="btn btn--primary" id="su-next1">次へ</button></div>
    ${draft.connectorId ? '' : draft.detected ? '<p role="status">この LMS には、まだ対応していません（いま使えるのは Moodle と manabo（試験中）です）。URL がトップページかどうかも確かめてください。</p>' : '<p class="muted">「次へ」を押すと、URL から LMS の種類を調べます。</p>'}`;
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
  const name = draft.label || draft.candidates.find((c) => c.connectorId === draft.connectorId)?.name || 'LMS';
  return `<h2>${n}. 大学の LMS とつなぐ</h2>
    <p class="muted">${esc(name)}：<code>${esc(draft.base || draft.url)}</code> <button type="button" class="link" id="su-url-edit">URL を変える</button></p>
    <h3 class="su-sub">ログイン</h3>
    ${body}
    <p id="su-login-msg" class="muted" role="status"></p>
    <div class="actions">${back}<button class="btn btn--primary" id="su-login">${main}</button>${draft.kind === 'recipe' ? '<button class="btn" id="su-skip">あとでログインする</button>' : ''}</div>`;
}
// 授業の確認と最初の同期（SPEC §6.3 の手順 3・6 を 1 つに）：同期する授業を選んで、そのまま同期を始める
function stepCoursesSync(data, n) {
  const list = draft.courses.length
    ? `<p class="muted">同期する授業を選びます（既定は全部）。外した授業は同期せず、ホームでは「非表示」にまとめます（設定 → 授業 で戻せます）。</p>
       <div id="su-courses">${draft.courses.map((c, i) => `<label style="display:block"><input type="checkbox" id="su-c${i}" checked data-lms="${esc(c.lmsId)}"> ${esc(c.name)}${c.weekday ? ` <span class="muted">${esc(c.weekday)}曜${c.period ? ` ${c.period}限` : ''}</span>` : ''}</label>`).join('')}</div>`
    : `<p class="muted">${draft.coursesLoaded ? '授業が取れませんでした。ログインできているか、学期が始まっているかを確かめてください。' : 'まだ授業の一覧を読んでいません（ログインがまだのため）。'}最初の同期で、全部の授業を取り込みます。</p>`;
  return `<h2>${n}. 授業の確認と最初の同期</h2>
    ${list}
    <p class="muted">「同期を始める」で全授業・全回の資料を取り込みます。数分かかることがあります。進み具合はホームの下に出ます。</p>
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-sync">同期を始めてホームへ</button></div>`;
}
// 使う人と使い方を 1 つの画面で選ぶ（大学生のときだけ大学名を入れる。いまは記録するだけ）。使い方はいくつでも。ホームの並びと設定の項目がこれに合わせて変わる
function stepProfile(data, n) {
  const role = draft.role ?? data.settings.role;
  const university = draft.university ?? data.settings.university ?? '';
  const uses = draft.uses ?? data.settings.uses ?? [];
  return `<h2>${n}. あなたと使い方</h2>
    <p class="muted">大学ノートは α 版（試験中）です。続けると <button type="button" class="link" data-action="policy">利用規約とプライバシーポリシー</button> に同意したことになります。データはこのパソコンの中だけに保存します。</p>
    <div class="role-pick" role="radiogroup" aria-label="使う人">${Object.entries(ROLES)
      .map(
        ([k, l]) =>
          `<button type="button" class="role-pick__item" role="radio" data-role="${k}" aria-checked="${role === k}">${l}</button>`
      )
      .join('')}</div>
    ${role === 'student' ? `<label class="role-pick__univ">大学名<input class="input" id="su-univ" maxlength="60" placeholder="例：〇〇大学" value="${esc(university)}"></label>` : ''}
    ${
      role
        ? `<h3 class="su-sub">何に使いますか</h3>
    <p class="muted">いくつでも選べます（あとから 設定 → 使い方 で変えられます）。</p>
    <div class="use-pick" role="group" aria-label="使い方">${USES[role]
      .map(
        ([k, l, d]) =>
          `<button type="button" class="use-pick__item" data-use="${k}" aria-pressed="${uses.includes(k)}"><strong>${l}</strong><span class="muted">${d}</span></button>`
      )
      .join('')}</div>`
        : ''
    }
    <div class="actions"><button class="btn btn--primary" id="su-profile" ${role && uses.length ? '' : 'disabled'}>次へ</button></div>`;
}
// 授業の資料の集め方を選ぶ。PC の授業フォルダはその場で取り込む。大学サービスとの連携は、次の手順で利用規約に同意してから
const MATERIALS = [
  [
    'folder',
    'PC内の授業フォルダを取り込む',
    '授業ごとのフォルダが入ったフォルダを選ぶと、そのまま使えます（コピーしません）'
  ],
  [
    'service',
    '大学の LMS とつなぐ',
    '大学の LMS（manaba・Moodle などの学習支援サービス）から授業の資料を自動でダウンロードします'
  ],
  ['later', 'あとで設定', '設定からいつでも選べます']
];
function stepMaterials(data, n) {
  const m = draft.materials;
  const r = draft.imported;
  const done = r
    ? `<p role="status">${r.added.length ? `${r.added.length} 個の授業フォルダを取り込みました（${r.added.map(esc).join('・')}）` : '取り込めるフォルダがありませんでした'}${r.failed.length ? `<br><span class="muted">取り込めなかったもの：${r.failed.map((f) => `${esc(f.name)}（${esc(f.message)}）`).join('・')}</span>` : ''}</p>`
    : '';
  return `<h2>${n}. 授業の資料をどうしますか</h2>
    <div class="use-pick use-pick--one" role="radiogroup" aria-label="授業の資料の集め方">${MATERIALS.map(
      ([k, l, d]) =>
        `<button type="button" class="use-pick__item" role="radio" data-materials="${k}" aria-checked="${m === k}"><strong>${esc(l)}</strong><span class="muted">${esc(d)}</span></button>`
    ).join('')}</div>
    ${m === 'folder' ? `<div class="actions"><button class="btn" id="su-import">フォルダを選ぶ…</button></div>${done}` : ''}
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn btn--primary" id="su-materials" ${m ? '' : 'disabled'}>次へ</button></div>`;
}
// 大学サービスとの連携の注意書きと利用規約。同意にチェックしないと先へ進めない
function stepLmsTerms(data, n) {
  const ok = draft.agreed;
  return `<h2>${n}. 大学の LMS とつなぐ機能の利用規約</h2>
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
    <p class="muted">年度と学期名だけで始められます（期間は学期名からの既定。あとから 設定 → 学期 で直せます）。</p>
    ${termForm(data, null, {compact: true})}
    <div class="actions">${n > 1 ? '<button class="btn" data-setup-back>戻る</button>' : ''}<button class="btn btn--primary" id="su-next4">保存して次へ</button></div>`;
}
// 学期と保存先を 1 つの画面で（学期を使わない人は保存先だけ）。学期は「次へ」「始める」で保存する。
// 保存先を選ぶと描き直すので、入れかけの学期は draft.term に取っておく
function stepTermRoot(data, n) {
  const role = draft.role ?? data.settings.role;
  const uses = draft.uses ?? data.settings.uses ?? [];
  const terms = features({role, uses}).terms;
  // 大学の LMS とつなぐ人は、同じ番号の続きで LMS の手順へ（「次へ」）。そうでなければここで終わり（「始める」）
  const toLms = flow === FLOWS.first && wantsLms(data);
  const t = draft.term;
  const kept = t ? {year: t.year, label: t.label, start_date: t.start, end_date: t.end, rounds: t.rounds} : null;
  return `<h2>${n}. ${terms ? '学期と保存先' : '保存先'}</h2>
    ${
      terms
        ? `<h3 class="su-sub">学期</h3>
    <p class="muted">年度と学期名だけで始められます（期間は学期名からの既定。あとから 設定 → 学期 で直せます）。</p>
    ${termForm(data, kept, {compact: true})}
    <h3 class="su-sub">保存先</h3>`
        : ''
    }
    <p>${terms ? '資料はここに「学期 → 授業 → 回」のフォルダで保存します。' : '資料はここに保存します。'}</p>
    <p><code>${esc(data.settings.root)}</code></p>
    ${toLms ? `<p>次は、大学の LMS とつなぎます（あと ${steps.length - n} 手順）。</p>` : ''}
    <div class="actions"><button class="btn" data-setup-back>戻る</button><button class="btn" id="su-pick">フォルダを選択…</button>${toLms ? '<button class="btn btn--primary" id="su-root-next">次へ</button>' : '<button class="btn btn--primary" id="su-finish">始める</button>'}</div>`;
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
    draft.detected = true;
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
  if ($('su-profile'))
    $('su-profile').onclick = async () => {
      const role = draft.role ?? document.querySelector('[data-role][aria-checked=true]')?.dataset.role;
      const university = $('su-univ')?.value.trim() ?? '';
      const uses = [...document.querySelectorAll('[data-use][aria-pressed=true]')].map((x) => x.dataset.use);
      const r = await api['settings.update']({patch: {role, uses, ...(role === 'student' ? {university} : {})}});
      if (r?.error) return toast(r.error, {error: true});
      draft.role = role;
      draft.uses = uses;
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
  // 学期と保存先：学期の欄があれば保存してから進む。「次へ」は初回のセットアップを済んだことにして（次の起動で出さない）、
  // 同じ流れのまま LMS の手順へ。「始める」はホームへ
  const saveTerm = async () => {
    if (!$('tm-year')) return true;
    const r = await api['term.save']({term: readTermForm(null)});
    if (r.error) return (toast(r.error, {error: true}), false);
    draft.term = null;
    return true;
  };
  if ($('su-pick'))
    $('su-pick').onclick = async () => {
      if ($('tm-year')) draft.term = readTermForm(null); // 描き直しても入れかけの学期が残るように
      const r = await api['settings.pickDownloadDir']();
      if (r?.error) toast(r.error, {error: true});
      else if (r.dir) reload();
    };
  if ($('su-root-next'))
    $('su-root-next').onclick = async () => {
      if (!(await saveTerm())) return;
      const r = await api['settings.update']({patch: {skipSetup: true}});
      if (r?.error) return toast(r.error, {error: true});
      next();
    };
  if ($('su-finish'))
    $('su-finish').onclick = async () => {
      if (!(await saveTerm())) return;
      const r = await api['settings.update']({patch: {skipSetup: true}});
      if (r?.error) return toast(r.error, {error: true});
      await reload();
      navigate('/');
    };
  if ($('su-url-edit'))
    $('su-url-edit').onclick = () => {
      draft.connectionId = null; // 同じ LMS なら、次の「次へ」で同じ接続を使う（新しく作らない）
      reload();
    };
  if ($('su-agree')) $('su-agree').onchange = (e) => ($('su-terms').disabled = !e.target.checked);
  if ($('su-terms'))
    $('su-terms').onclick = async () => {
      if (!$('su-agree').checked) return;
      const r = await api['settings.update']({patch: {acceptLmsTerms: LMS_TERMS_VERSION}});
      if (r?.error) return toast(r.error, {error: true});
      draft.agreed = true;
      if (flow === FLOWS.terms) {
        toast('利用規約に同意しました。同期を続けます');
        resetSetup('first');
        location.hash = '#/';
        await reload(); // 「要確認」の知らせを消す
        return;
      }
      next();
    };
  if ($('su-detect')) $('su-detect').onclick = detect;
  if ($('su-url')) $('su-url').onkeydown = (e) => e.key === 'Enter' && !e.isComposing && $('su-next1')?.click();
  document.querySelectorAll('input[name=cand]').forEach(
    (r) =>
      (r.onchange = () => {
        [draft.connectorId, draft.kind] = r.value.split('|');
        // 名前を自分で入れていなければ、選んだ種類の名前にする
        if (draft.label === null && $('su-label'))
          $('su-label').value = draft.candidates.find((c) => c.connectorId === draft.connectorId)?.name ?? '';
      })
  );
  if ($('su-label')) $('su-label').oninput = (e) => (draft.label = e.target.value);
  if ($('su-next1'))
    $('su-next1').onclick = async () => {
      // URL を入れて「次へ」だけで進める：まだ調べていなければここで種類を調べ、候補があれば続ける
      if (!draft.connectorId) {
        const btn = $('su-next1');
        btn.disabled = true;
        btn.textContent = '調べています…';
        await detect().finally(() => ((btn.disabled = false), (btn.textContent = '次へ')));
        if (!draft.connectorId) return;
      }
      const r = await api['setup.createConnection']({
        connectorId: draft.connectorId,
        kind: draft.kind,
        baseUrl: draft.base || draft.url,
        label: $('su-label')?.value.trim() ?? ''
      });
      if (r.error) return toast(r.error, {error: true});
      draft.connectionId = r.connectionId;
      reload(); // 同じ手順のまま、ログインの欄を出す
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
  if ($('su-next4'))
    $('su-next4').onclick = async () => {
      const r = await api['term.save']({term: readTermForm(null)});
      if (r.error) return toast(r.error, {error: true});
      next();
    };
  if ($('su-sync'))
    $('su-sync').onclick = async () => {
      // 外した授業を覚えてから同期を始める
      const off = [...document.querySelectorAll('#su-courses input[data-lms]')]
        .filter((c) => !c.checked)
        .map((c) => c.dataset.lms);
      if (draft.connectionId && draft.courses.length) {
        const r0 = await api['setup.excludeCourses']({connectionId: draft.connectionId, lmsIds: off});
        if (r0?.error) return toast(r0.error, {error: true});
      }
      const r = await api['sync.run']({full: true});
      if (r?.error) return toast(r.error, {error: true});
      resetSetup();
      location.hash = '#/';
    };
}
