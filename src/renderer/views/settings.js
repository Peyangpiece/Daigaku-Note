// 設定（SPEC §12.2）。学期・授業・保存先・クイズ・見た目、下に LMS との連携（任意）と同期。変更はすぐ保存する。
import {AI_CONSENT_VERSION, AI_NOT_SENDS, AI_SENDS} from '../../shared/policy.js';
import {confirmDialog, esc, toast} from '../ui-kit.js';
import {reload} from '../store.js';
import {ROLES, USES, features, importFor, isChukyo} from '../../shared/profile.js';
import {sharedHost} from '../../shared/import-sites.js';

const api = window.daigaku;
const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleString('ja-JP', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})
    : 'まだ';

/** 自動ログイン（SPEC §6.4）：オンなら「やめる」、オフなら ID とパスワードの欄 */
function autoLogin(c) {
  // 統合認証のページ（別のホスト）には、見えるログイン窓で一度通ったところにだけ入力する。まだ通っていなければ案内する
  const learned = (() => {
    try {
      return JSON.parse(c.allowed_hosts_json ?? '[]').length > 0;
    } catch {
      return false;
    }
  })();
  const form = (
    label
  ) => `<div data-form="${esc(c.id)}" style="display:grid; gap: var(--space-1); max-width: 360px; margin-top: var(--space-1)">
      <label class="sr-only" for="st-user-${esc(c.id)}">ID</label><input class="input" id="st-user-${esc(c.id)}" placeholder="ID（学籍番号など）" autocomplete="username">
      <label class="sr-only" for="st-pass-${esc(c.id)}">パスワード</label><input class="input" id="st-pass-${esc(c.id)}" type="password" placeholder="パスワード" autocomplete="current-password">
      <div><button class="btn btn--small" data-save-pass="${esc(c.id)}">${label}</button></div>
    </div>`;
  // オンなのに保存した ID・パスワードを読めない（キーチェーンで拒否された・アプリの署名が変わったなど）：その場で入れ直せるようにする（v0.18.10）
  if (c.save_password && c.password_unreadable)
    return `<div style="margin-top: 6px"><div class="muted">自動ログイン：オン。<strong>保存した ID とパスワードを読めません。</strong>入れ直すと、次の同期から自動でログインします <button class="btn btn--small" data-forget-pass="${esc(c.id)}">自動ログインをやめる</button></div>${form('入れ直す')}</div>`;
  if (c.save_password)
    return `<div class="muted" style="margin-top: 6px">自動ログイン：オン${learned ? '' : '。<strong>最初に一度「ログイン」で窓からログインしてください</strong>'} <button class="btn btn--small" data-forget-pass="${esc(c.id)}">自動ログインをやめる</button></div>`;
  return `<details style="margin-top: 6px"><summary class="muted">自動ログイン：オフ</summary>
    ${form('保存してオンにする')}</details>`;
}

/** クイズ（SPEC §11.8・§11.9）：問題を作る AI・同意・問題の数と種類・モデル・上限 */
const TYPE_NAMES = {choice: '選択', tf: '正誤', cloze: '穴埋め', num: '数値', card: '記述'};
// 問題を作る AI（SPEC §11.8）：Claude API キー・このパソコンの Claude Code・Codex
const ENGINE_NOTE = {
  api: '使った分だけ課金（1 回およそ十数円）',
  'claude-code': 'Claude の契約（Pro・Max など）で使えます',
  codex: 'ChatGPT の契約で使えます'
};
function engineChoice(q) {
  const engine = q.key?.engine ?? 'api';
  const row = (id) => {
    const found = id === 'api' ? null : q.cli?.[id];
    const state =
      id === 'api'
        ? q.key?.apiKey
          ? `キー ••••${esc(q.key.last4 ?? '')}`
          : 'キー未登録'
        : q.cli == null
          ? '探しています…'
          : found
            ? `v${esc(found.version)}`
            : '見つかりません';
    const off = id !== 'api' && !found;
    return `<label class="qz-engine${off ? ' qz-engine--off' : ''}"><input type="radio" name="qz-engine" value="${id}"${id === engine ? ' checked' : ''}${off ? ' disabled' : ''}>
      <span><strong>${esc(q.engines?.[id] ?? id)}</strong> <span class="muted">${state}${id === engine && q.key?.set ? '・使用中' : ''}</span><br><span class="muted">${esc(ENGINE_NOTE[id])}</span></span></label>`;
  };
  return `<fieldset class="qz-engines"><legend class="sr-only">問題を作る AI</legend>
      ${['api', 'claude-code', 'codex'].map(row).join('')}
      <div><button type="button" class="btn btn--small btn--quiet" data-quiz-detect>Claude Code・Codex を探し直す</button></div>
    </fieldset>`;
}
let cliDetected = false; // このアプリを開いてから探したか
function quizSection(q) {
  if (!q) return '';
  const engine = q.key?.engine ?? 'api';
  const consentOk = q.consent?.version === AI_CONSENT_VERSION && (q.consent.engine ?? 'api') === engine;
  const apiKey = q.key?.apiKey
    ? `<p>API キー <code>••••${esc(q.key.last4)}</code> <button class="btn btn--small btn--quiet" data-quiz-removekey>削除</button></p>`
    : `<div class="qz-apikey" style="display:flex; gap: var(--space-1); align-items:end"><label style="flex:1">API キー（<button type="button" class="link" data-action="open-external" data-url="https://console.anthropic.com/settings/keys">取得</button>）<input class="input" id="qz-key" type="password" placeholder="sk-ant-…" autocomplete="off" data-keep="off"></label><button class="btn btn--primary" data-quiz-setkey>保存して使う</button></div>`;
  // 同意：済んでいれば 1 行。まだなら送る内容（畳む）とチェック
  const consent = `${consentOk ? `<p class="muted" data-qz-agreed>${consentLine(q.consent)}</p>` : ''}
    <div data-qz-consent${consentOk ? ' hidden' : ''}><details class="consent"><summary>AI に送る内容</summary>
         <p><strong>送る</strong>：${AI_SENDS.map(esc).join('。')}。</p>
         <p><strong>送らない</strong>：${AI_NOT_SENDS.map(esc).join('。')}。</p>
         <p><strong>送り先</strong>：Claude API キー・Claude Code は Anthropic、Codex は OpenAI。</p>
       </details>
       <label style="display:block; margin: var(--space-1) 0"><input type="checkbox" id="qz-consent"> 送る内容に同意する</label></div>`;
  // 出し分けに使う今の状態（bind の syncEngine が読む）
  const key = `<div data-qz-state data-engine="${esc(engine)}" data-agreed="${consentOk ? '1' : ''}" data-ready="${q.key?.set ? '1' : ''}" hidden></div>
       ${engineChoice(q)}
       <div data-qz-api${engine === 'api' ? '' : ' hidden'}>${apiKey}</div>
       ${consent}
       <div class="actions" data-qz-use${(engine === 'api' && !q.key?.apiKey) || (consentOk && q.key?.set) ? ' hidden' : ''}><button class="btn btn--primary" data-quiz-engine>この AI を使う</button></div>`;
  const mix = Object.entries(TYPE_NAMES)
    .map(
      ([t, label]) =>
        `<label>${label}<input class="input" type="number" min="0" max="30" id="qz-mix-${t}" value="${q.mix?.[t] ?? 0}"></label>`
    )
    .join('');
  return `<section class="card" id="st-quiz"><h3>問題を作る AI</h3>
    ${key}
    <p class="muted" style="margin: var(--space-1) 0 0">今日の作成 ${q.today} ／ ${q.perDay} 回${engine === 'api' ? `・今月 $${(q.monthUsd ?? 0).toFixed(2)} ／ $${q.perMonthUsd}` : ''}</p>
  </section>
  <section class="card"><h3>1 回に作る問題</h3>
    <p class="muted" style="margin: 0 0 4px">種類ごとの数（合計 1〜30 問）</p>
    <div class="qz-mix">${mix}</div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-2)">
      <label>モデル（API キー・Claude Code）<select class="input" id="qz-model">${Object.entries(q.models ?? {})
        .map(([id, label]) => `<option value="${esc(id)}" ${id === q.model ? 'selected' : ''}>${esc(label)}</option>`)
        .join('')}</select></label>
      <label>1 日に作れる回数<input class="input" type="number" min="1" max="200" id="qz-perday" value="${q.perDay}"></label>
      <label>月の費用の上限（ドル・API キー）<input class="input" type="number" min="0.5" max="500" step="0.5" id="qz-permonth" value="${q.perMonthUsd}"></label>
    </div>
    <div class="actions"><button class="btn" data-quiz-save>保存</button></div>
  </section>`;
}

/**
 * 設定する前からダウンロードにあったファイルを探して取り込み、結果を知らせる（今学期の期間にダウンロードしたものだけ。v0.17.0）。
 * オンにしたとき（セットアップ・設定）と、設定の「すでにダウンロードしたファイルを探す」から
 */
export async function scanDownloads({quietNoTerm = false} = {}) {
  const r = await api['import.scan']();
  if (r?.error) return toast(r.error, {error: true});
  if (r.noTerm && quietNoTerm) return;
  if (r.noTerm)
    return toast(
      '今学期が設定されていないため、すでにダウンロードしたファイルは探していません（学期を設定すると探せます）'
    );
  const parts = [
    r.imported ? `${r.imported} 件を入れました` : '',
    r.pending ? `${r.pending} 件はホームの「振り分け待ち」です` : ''
  ].filter(Boolean);
  toast(
    parts.length
      ? `ダウンロード済みの授業資料（${r.term}の期間）：${parts.join('・')}`
      : `${r.term}の期間にダウンロードした授業資料で、新しく取り込むものはありませんでした`
  );
}

/** ブラウザの準備の状態。技術的な文言は「くわしく」の中へ */
export function browserState(b) {
  if (b?.state === 'ready') return '用意できています';
  if (b?.state === 'pending') return '準備中…（初回だけ数分）';
  return `準備に失敗しました。ネットにつながっているか確かめて、「準備し直す」を押してください。${b?.message ? `<details class="muted"><summary>くわしく</summary>${esc(b.message)}</details>` : ''}`;
}

// 設定のタブ。#/settings?tab=<鍵>（focus=quiz はクイズのタブ）。前は 1 枚に全部並べていて、探しにくかった
const TABS = [
  ['basic', '基本'],
  ['lms', '授業と資料'],
  ['quiz', 'クイズ'],
  ['mobile', 'スマホ'],
  ['data', 'データ'],
  ['about', '情報']
];
export const settingsTab = (route) => {
  const q = new URLSearchParams(route.split('?')[1] ?? '');
  const tab = q.get('tab') ?? (q.get('focus') === 'quiz' ? 'quiz' : 'basic');
  return TABS.some(([k]) => k === tab) ? tab : 'basic';
};

export function renderSettings({data}, route = '/settings') {
  const s = data.settings;
  const hidden = data.courses.filter((c) => c.hidden);
  // 「手動」の接続はアプリの中の仕組み（自分のファイルの置き場）なので出さない。同期の設定は LMS をつないだときだけ出す
  const lmsConns = data.connections.filter((c) => c.kind !== 'manual');
  const hasLms = lmsConns.length > 0;
  const tab = settingsTab(route);
  const f = features({role: s.role, uses: s.uses, university: s.university});
  // manabo の欄：中京大学の学生だけ（前につないだ接続がある人には、その接続を出す。v0.17.0）
  const showManabo = hasLms || (s.role === 'student' && isChukyo(s.university)) || !s.role;
  const imp = s.import ?? {enabled: false, mode: 'ask', sites: []};
  // Teams の資料の置き場所（大学ごとの SharePoint）と、ほかのサイト（v0.17.2）
  const teamsSites = imp.sites.filter((h) => /\.sharepoint\.com$/.test(h));
  const others = imp.sites.filter((h) => !/\.sharepoint\.com$/.test(h));
  queueMicrotask(bind);
  const tabs = `<nav class="settings__tabs" role="tablist" aria-label="設定">${TABS.map(
    ([k, l]) =>
      `<button type="button" role="tab" class="settings__tab" aria-selected="${k === tab}" data-action="nav" data-route="/settings?tab=${k}">${l}</button>`
  ).join('')}</nav>`;
  const panels = {
    basic: `
      <section class="card" id="st-profile"><h3>使い方</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2)">
          <label>使う人<select class="input" id="st-role">${s.role ? '' : '<option value="">（未設定）</option>'}${Object.entries(
            ROLES
          )
            .map(([v, l]) => `<option value="${v}" ${s.role === v ? 'selected' : ''}>${l}</option>`)
            .join('')}</select></label>
          ${s.role === 'student' ? `<label>大学名<input class="input" id="st-univ" maxlength="60" placeholder="例：〇〇大学" value="${esc(s.university ?? '')}"></label><label>大学のサイトの URL<input class="input" id="st-univ-url" type="url" maxlength="300" placeholder="例：https://www.example-u.ac.jp/" value="${esc(s.universityDomain ? `https://${s.universityDomain}/` : '')}"></label>` : ''}
        </div>
        ${s.role ? `<p class="muted" style="margin: var(--space-2) 0 4px">使う機能（ホームに出すもの）</p>${USES[s.role].map(([k, l]) => `<label style="display:block"><input type="checkbox" data-st-use="${k}" ${s.uses.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}` : ''}
      </section>
      <section class="card"><h3>見た目</h3>
        <label>テーマ<select class="input" id="st-theme">${[
          ['system', 'パソコンに合わせる'],
          ['light', '明るい'],
          ['dark', '暗い']
        ]
          .map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>
        <div class="about__row" style="margin-top: var(--space-2)"><button class="btn btn--small" data-action="nav" data-route="/kisekae">ノートの着せ替え</button><button class="btn btn--small" data-action="nav" data-route="/fudebako">ペン（持ち物）</button></div>
      </section>
      <section class="card"><h3>通知と起動</h3>
        <label style="display:block"><input type="checkbox" id="st-notify" ${s.notifications === false ? '' : 'checked'}> 新しい資料・クイズの完成・同期の失敗を通知する</label>
        ${s.openAtLogin?.available ? `<label style="display:block; margin-top: var(--space-1)"><input type="checkbox" id="st-login" ${s.openAtLogin?.on ? 'checked' : ''}> パソコンの起動時にパレットノートを開く</label>` : ''}
      </section>
      ${
        hidden.length
          ? `<section class="card"><h3>非表示の授業・フォルダ</h3>
              <ul style="padding-left: 1.2em">${hidden.map((c) => `<li style="margin-bottom: 6px">${esc(c.name)} <button class="btn btn--small" data-show-course="${esc(c.id)}">${c.kind === 'folder' ? 'ホームに戻す' : 'ホームに戻す（同期も再開）'}</button></li>`).join('')}</ul>
            </section>`
          : ''
      }`,
    lms: `
      ${
        f.terms
          ? `<section class="card"><h3>学期</h3>
        ${data.terms.length ? `<ul style="padding-left: 1.2em">${data.terms.map((t) => `<li>${t.year} ${esc(t.label)} <span class="muted">${esc(t.start_date)}〜${esc(t.end_date)}・${t.rounds} 回${t.periods_json ? '' : '・時限の時刻なし'}</span></li>`).join('')}</ul>` : '<p class="muted">学期がありません。</p>'}
        <button class="btn" data-action="nav" data-route="/settings/term">${data.terms.length ? '学期を編集' : '学期を設定'}</button>
      </section>`
          : ''
      }
      ${
        showManabo
          ? `<section class="card" id="st-lms"><h3>manabo</h3>
        ${
          lmsConns.length
            ? `<ul style="padding-left: 1.2em">${lmsConns
                .map(
                  (
                    c
                  ) => `<li style="margin-bottom: 6px"><span data-rename-box><span data-rename-target>${esc(c.label)}</span> <button type="button" class="rename-btn" data-action="rename" data-what="conn" data-id="${esc(c.id)}" data-value="${esc(c.label)}" title="名前を変える" aria-label="${esc(c.label)}の名前を変える">✎</button></span> <span class="muted">前回の同期 ${esc(fmtDate(c.last_sync_at))}${c.status !== 'ok' ? ` ・ <strong>${c.status === 'login-required' ? 'ログインが必要' : esc(c.status)}</strong>` : ''}</span>
                    <span style="display:inline-flex; gap: 6px; margin-left: 8px">
                      ${c.kind !== 'manual' ? `<button class="btn btn--small${c.status === 'login-required' ? ' btn--primary' : ''}" data-login="${esc(c.id)}">ログイン</button>` : ''}
                      <button class="btn btn--small btn--quiet" data-remove-conn="${esc(c.id)}">削除</button>
                    </span>${c.kind === 'recipe' ? autoLogin(c) : ''}</li>`
                )
                .join('')}</ul>`
            : ''
        }
        ${lmsConns.length ? '' : '<button class="btn btn--primary" data-action="nav" data-route="/settings/lms">manabo とつなぐ</button>'}
        ${data.browser?.state === 'failed' || data.browser?.state === 'pending' ? `<div class="muted" style="margin-top: var(--space-2)">manabo を読むブラウザ：${browserState(data.browser)} <button class="btn btn--small" data-action="install-browser" ${data.browser?.state === 'pending' ? 'disabled' : ''}>準備し直す</button></div>` : ''}
      </section>`
          : ''
      }
      ${
        importFor(s.role)
          ? `<section class="card" id="st-import"><h3>授業資料を自動で取り込む</h3>
        <p class="muted">大学のサイトからダウンロードした資料を、授業ごとに入れます。</p>
        <label style="display:block"><input type="checkbox" id="st-import-on" ${imp.enabled ? 'checked' : ''}> 取り込む</label>
        ${
          imp.enabled
            ? `<label style="display:block; margin-top: var(--space-1)"><input type="radio" name="st-import-mode" value="ask" ${imp.mode === 'auto' ? '' : 'checked'}> 入れる前に聞く（ホームの「振り分け待ち」）</label>
        <label style="display:block"><input type="radio" name="st-import-mode" value="auto" ${imp.mode === 'auto' ? 'checked' : ''}> 授業と回が分かったら聞かずに入れる</label>
        <div class="about__row" style="margin-top: var(--space-1)"><button class="btn btn--small" id="st-import-scan">すでにダウンロードしたファイルを探す</button></div>
        <p class="muted" style="margin: var(--space-2) 0 4px">大学のサイト：${s.universityDomain ? `<code>${esc(s.universityDomain)}</code>${s.university ? `（${esc(s.university)}）` : ''}` : '未登録（基本 → 大学のサイトの URL）'}</p>
        <p class="muted" style="margin: 0 0 4px">ほかの大学のサイト</p>
        ${others.length ? `<ul style="padding-left: 1.2em">${others.map((h) => `<li><code>${esc(h)}</code>${sharedHost(h) ? ' <span class="muted">（共通のサービスなので使っていません）</span>' : ''} <button class="btn btn--small btn--quiet" data-import-site-remove="${esc(h)}">外す</button></li>`).join('')}</ul>` : ''}
        <div class="about__row"><input class="input" id="st-import-site" type="url" placeholder="https://〇〇.app.box.com/" style="max-width: 22em"><button class="btn btn--small" id="st-import-site-add">足す</button></div>`
            : ''
        }
      </section>
      <details class="card st-teams" id="st-teams"><summary><h3>Teams と連携</h3>${teamsSites.length ? `<span class="muted">${teamsSites.length} か所を覚えています</span>` : ''}</summary>
        <p class="muted">大学の SharePoint のアドレスを覚えると、Teams の資料を取り込めます。</p>
        ${imp.enabled ? '' : '<p role="status">「授業資料を自動で取り込む」をオンにすると使えます。</p>'}
        <ol class="st-teams__how">
          <li>Teams で資料のファイルを開き、「…」→「ブラウザーで開く」（または「SharePoint で開く」）を押す</li>
          <li>ブラウザのアドレス欄の <code>https://〇〇.sharepoint.com/…</code> をコピーして、下に貼る</li>
        </ol>
        ${teamsSites.length ? `<ul style="padding-left: 1.2em">${teamsSites.map((h) => `<li><code>${esc(h)}</code> <button class="btn btn--small btn--quiet" data-import-site-remove="${esc(h)}">外す</button></li>`).join('')}</ul>` : '<p class="muted">まだ覚えていません。</p>'}
        <div class="about__row"><input class="input" id="st-teams-site" type="url" placeholder="https://〇〇.sharepoint.com/sites/…" style="max-width: 24em"><button class="btn btn--small" id="st-teams-site-add">覚える</button></div>
      </details>`
          : ''
      }
      ${
        hasLms
          ? `<section class="card"><h3>同期</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2)">
          <label>毎日の時刻<input class="input" id="st-time" type="time" value="${esc(s.syncTime)}"></label>
          <label>途中の確認<select class="input" id="st-every">${[0, 1, 3, 6].map((h) => `<option value="${h}" ${s.everyHours === h ? 'selected' : ''}>${h ? `${h} 時間ごと` : 'しない'}</option>`).join('')}</select></label>
        </div>
        <label style="display:block; margin-top: var(--space-2)"><input type="checkbox" id="st-class" ${s.classStart ? 'checked' : ''}> 授業の始まる時刻にも同期する</label>
      </section>`
          : ''
      }`,
    quiz: data.quiz ? quizSection({...data.quiz, consent: data.settings.aiConsent}) : '',
    mobile: `<section class="card" id="st-mobile"><h3>スマホ</h3><div data-v="mobile">読み込み中…</div></section>`,
    data: `
      <section class="card"><h3>保存先</h3>
        <p><code>${esc(s.root)}</code>${s.root === s.defaultRoot ? ' <span class="muted">（既定）</span>' : ''}</p>
        <div class="about__row"><button class="btn btn--small" data-action="open-root">開く</button><button class="btn btn--small" data-action="pick-dir">変える…</button>${s.root !== s.defaultRoot ? '<button class="btn btn--small btn--quiet" data-action="reset-dir">既定に戻す</button>' : ''}</div>
      </section>
      <section class="card" id="st-data"><h3>バックアップ</h3>
        <p class="muted">資料のファイルは含みません。毎日自動で 7 日分取っています。</p>
        <div class="about__row"><button type="button" class="btn btn--small" data-backup="export">書き出す</button><button type="button" class="btn btn--small" data-backup="import">読み込む…</button><button type="button" class="btn btn--small btn--quiet" data-backup="dir">自動バックアップを開く</button></div>
      </section>`,
    about: `
      <section class="card" id="st-about"><h3>情報</h3>
        <p>パレットノート ${esc(data.version)}<span class="about__alpha">α 版</span></p>
        <p class="muted">試験中の版です。大切な資料は元の場所にも残してください。</p>
        <div class="about__row"><button type="button" class="btn btn--small" data-action="policy">利用規約とプライバシーポリシー</button><button type="button" class="btn btn--small" data-action="notices">ライセンス</button></div>
        <div class="about__row"><button type="button" class="btn btn--small btn--quiet" data-action="open-data-dir">データの場所を開く</button><button type="button" class="btn btn--small btn--quiet" data-action="open-logs">ログを開く</button></div>
        <p class="muted">不具合の報告：GitHub の Peyangpiece/Daigaku-Note（Issues）</p>
      </section>`
  };
  return `
    <nav class="page-nav">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button><h2>設定</h2>
    </nav>
    <div class="settings">
      ${tabs}
      <div class="settings__grid" role="tabpanel">${panels[tab]}</div>
    </div>`;
}

/** AI への同意の記録の 1 行 */
function consentLine(c) {
  if (!c?.at) return 'AI に送る内容への同意の記録がありません。';
  const at = new Date(c.at).toLocaleString('ja-JP', {dateStyle: 'medium', timeStyle: 'short'});
  return c.version === AI_CONSENT_VERSION
    ? `送る内容に同意済み（${esc(at)}）`
    : '送る内容が変わりました。同意し直してください。';
}

/**
 * スマホ連携（docs/MOBILE.md §2）：入れる・切る、スマホを追加（QR）、つないだスマホの一覧。
 * QR は 10 分・1 回だけ使える。人に見せない（読んだ人がこのパソコンの資料を見られる）
 */
async function renderMobile(box, st = null, pair = null) {
  if (!box?.isConnected) return;
  const s = st ?? (await api['mobile.status']());
  if (s?.error) return void (box.textContent = s.error);
  const addr =
    s.enabled && s.hosts.length ? s.hosts.map((h) => `<code>http://${esc(h)}:${s.port}/m/</code>`).join('　') : '';
  const devices = s.devices.length
    ? `<ul class="mobile-devices">${s.devices
        .map(
          (d) =>
            `<li><strong>${esc(d.name)}</strong> <span class="muted">つないだ日 ${esc(fmtDate(d.created))}・最後に使った日 ${esc(fmtDate(d.lastSeen))}${d.ip ? `（${esc(d.ip)} から）` : ''}</span> <button type="button" class="btn btn--small btn--quiet" data-mobile-rename="${esc(d.id)}" data-name="${esc(d.name)}">名前</button><button type="button" class="btn btn--small btn--quiet" data-mobile-remove="${esc(d.id)}">外す</button></li>`
        )
        .join('')}</ul>`
    : '<p class="muted">つないだスマホはまだありません。</p>';
  box.innerHTML = `
    <p class="muted">同じ Wi-Fi のスマホで使えます。</p>
    <label style="display:block"><input type="checkbox" data-mobile-on ${s.enabled ? 'checked' : ''}> スマホとつなぐ</label>
    ${
      s.enabled
        ? `${addr ? `<p class="muted">アドレス：${addr}</p>` : '<p class="muted">Wi-Fi などのネットワークにつながっていません。</p>'}
      <div class="about__row"><button type="button" class="btn btn--small" data-mobile-pair ${s.hosts.length ? '' : 'disabled'}>スマホを追加</button></div>
      ${
        pair
          ? `<div class="mobile-qr"><div class="mobile-qr__code">${pair.svg}</div><p>スマホのカメラでこの QR を読んでください。ブラウザで開いて、そのままつながります（10 分間・1 回だけ使えます）。<br><strong>QR は人に見せないでください</strong>（読んだ人がこのパソコンの資料を見られます）。</p></div>`
          : ''
      }
      ${devices}
      <p class="muted">つながらないときは、家の Wi-Fi で試してください（大学の Wi-Fi は端末どうしがつながらないことが多い）。</p>`
        : devices
    }`;
  box.querySelector('[data-mobile-on]').onchange = async (e) => {
    const r = await api['mobile.enable']({on: e.target.checked});
    if (r?.error) toast(r.error, {error: true});
    renderMobile(box, r?.error ? null : r);
  };
  const pairBtn = box.querySelector('[data-mobile-pair]');
  if (pairBtn)
    pairBtn.onclick = async () => {
      const r = await api['mobile.pair']({host: s.hosts[0]});
      if (r?.error) return toast(r.error, {error: true});
      renderMobile(box, s, r);
      // 10 分たったら QR を消す。つながったら一覧に出す（開いている間、ときどき確かめる）
      const until = Date.now() + r.expiresIn;
      const before = s.devices.length;
      const tick = setInterval(async () => {
        if (!box.isConnected) return clearInterval(tick);
        const now = await api['mobile.status']();
        if (now?.error) return;
        if (now.devices.length > before || Date.now() > until) {
          clearInterval(tick);
          if (now.devices.length > before) toast(`${now.devices.at(-1).name} とつながりました`);
          renderMobile(box, now);
        }
      }, 2000);
    };
  for (const b of box.querySelectorAll('[data-mobile-remove]'))
    b.onclick = async () => {
      const ok = await confirmDialog(
        'このスマホを外しますか？ 外したスマホからは何もできなくなります。もう一度使うときは QR を読み直します。',
        {ok: '外す', danger: true}
      );
      if (!ok) return;
      const r = await api['mobile.remove']({deviceId: b.dataset.mobileRemove});
      if (r?.error) return toast(r.error, {error: true});
      renderMobile(box, r);
    };
  for (const b of box.querySelectorAll('[data-mobile-rename]'))
    b.onclick = async () => {
      const li = b.closest('li');
      li.innerHTML = `<input class="input" maxlength="40" value="${esc(b.dataset.name)}" aria-label="スマホの名前"> <button type="button" class="btn btn--small">決める</button>`;
      const input = li.querySelector('input');
      input.focus();
      const done = async () => {
        const r = await api['mobile.rename']({deviceId: b.dataset.mobileRename, name: input.value});
        if (r?.error) return toast(r.error, {error: true});
        renderMobile(box, r);
      };
      li.querySelector('button').onclick = done;
      input.onkeydown = (e) => e.key === 'Enter' && done();
    };
}

function bind() {
  const $ = (id) => document.getElementById(id);
  renderMobile(document.querySelector('[data-v="mobile"]'));
  for (const b of document.querySelectorAll('[data-backup]'))
    b.onclick = async () => {
      const what = b.dataset.backup;
      if (what === 'export') {
        const r = await api['backup.export']();
        if (r?.error) return toast(r.error, {error: true});
        if (r?.ok) toast('バックアップを書き出しました');
      } else if (what === 'dir') await api['backup.openDir']();
      else if (what === 'import') {
        if (
          !(await confirmDialog(
            'バックアップを読み込むと、いまのデータはそのファイルの中身に置き換わります（いまのものは before-restore として残します）。続けますか？',
            {ok: 'ファイルを選ぶ', danger: true}
          ))
        )
          return;
        const r = await api['backup.import']();
        if (r?.error) return toast(r.error, {error: true});
        if (!r?.ok) return;
        if (
          await confirmDialog('読み込む準備ができました。アプリを開き直すと入れ替わります。いま開き直しますか？', {
            ok: '開き直す'
          })
        )
          await api['app.relaunch']();
        else toast('次にアプリを開いたときに入れ替わります', {untilNavigate: true});
      }
    };
  const qset = document.querySelector('[data-quiz-setkey]');
  if (qset)
    qset.onclick = async () => {
      const st = document.querySelector('[data-qz-state]')?.dataset ?? {};
      if (!(st.engine === 'api' && st.agreed) && !$('qz-consent')?.checked)
        return toast('「送る内容に同意する」にチェックを入れてください', {error: true});
      qset.disabled = true;
      qset.textContent = '確かめています…';
      const r = await api['quiz.setKey']({apiKey: $('qz-key').value, consent: true});
      qset.disabled = false;
      qset.textContent = '確かめて保存';
      if (r?.error) return toast(r.error, {error: true});
      $('qz-key').value = '';
      toast('API キーを保存しました');
      reload();
    };
  // クイズを作る AI：選ぶと、API キーの欄（API キーを選んだときだけ）と「使う」を出し分ける
  const engines = [...document.querySelectorAll('input[name="qz-engine"]')];
  const syncEngine = () => {
    const pick = engines.find((x) => x.checked)?.value;
    const st = document.querySelector('[data-qz-state]')?.dataset ?? {};
    const same = pick === st.engine;
    const box = document.querySelector('[data-qz-api]');
    if (box) box.hidden = pick !== 'api';
    // 今の AI に同意済みなら同意の欄は畳んだまま。別の AI を選んだら、その送り先への同意を取る
    const agree = document.querySelector('[data-qz-consent]');
    if (agree) agree.hidden = same && !!st.agreed;
    const agreed = document.querySelector('[data-qz-agreed]');
    if (agreed) agreed.hidden = !same;
    // 「この AI を使う」：API キーがまだなら「保存」で始めるので出さない。今の AI がもう使えるなら出さない
    const use = document.querySelector('[data-qz-use]');
    if (use)
      use.hidden =
        (pick === 'api' && !document.querySelector('[data-quiz-removekey]')) || (same && !!st.agreed && !!st.ready);
  };
  engines.forEach((x) => x.addEventListener('change', syncEngine));
  const qeng = document.querySelector('[data-quiz-engine]');
  if (qeng)
    qeng.onclick = async () => {
      const engine = engines.find((x) => x.checked)?.value;
      if (!engine) return;
      const st = document.querySelector('[data-qz-state]')?.dataset ?? {};
      const already = engine === st.engine && !!st.agreed;
      if (!already && !$('qz-consent')?.checked)
        return toast('「送る内容に同意する」にチェックを入れてください', {error: true});
      const r = await api['quiz.setEngine']({engine, consent: true});
      if (r?.error) return toast(r.error, {error: true});
      toast('切り替えました');
      reload();
    };
  const qdet = document.querySelector('[data-quiz-detect]');
  const detectCli = async () => {
    cliDetected = true;
    if (qdet) {
      qdet.disabled = true;
      qdet.textContent = '探しています…';
    }
    const r = await api['quiz.detectCli']();
    if (r?.error) toast(r.error, {error: true});
    reload();
    return r;
  };
  if (qdet)
    qdet.onclick = async () => {
      const r = await detectCli();
      if (r && !r.error) {
        const names = [r['claude-code'] && 'Claude Code', r.codex && 'Codex'].filter(Boolean);
        toast(names.length ? `${names.join('・')} が見つかりました` : 'Claude Code・Codex は見つかりませんでした');
      }
    };
  // 設定を開いて最初に、このパソコンの Claude Code・Codex を探す（アプリを開いているあいだ 1 回）
  if (qdet && !cliDetected) detectCli();
  const qrm = document.querySelector('[data-quiz-removekey]');
  if (qrm)
    qrm.onclick = async () => {
      if (
        !(await confirmDialog('API キーを削除しますか？（作った問題と記録は残ります）', {ok: '削除する', danger: true}))
      )
        return;
      await api['quiz.removeKey']();
      reload();
    };
  const qsave = document.querySelector('[data-quiz-save]');
  if (qsave)
    qsave.onclick = async () => {
      const mix = Object.fromEntries(Object.keys(TYPE_NAMES).map((t) => [t, Number($(`qz-mix-${t}`).value) || 0]));
      const r = await api['quiz.settings']({
        patch: {
          model: $('qz-model').value,
          mix,
          perDay: Number($('qz-perday').value),
          perMonthUsd: Number($('qz-permonth').value)
        }
      });
      if (r?.error) return toast(r.error, {error: true});
      toast('保存しました');
      reload();
    };
  const save = async (patch) => {
    const r = await api['settings.update']({patch});
    if (r?.error) toast(r.error, {error: true});
    else reload();
  };
  $('st-time')?.addEventListener('change', (e) => save({syncTime: e.target.value}));
  $('st-every')?.addEventListener('change', (e) => save({everyHours: Number(e.target.value)}));
  $('st-class')?.addEventListener('change', (e) => save({classStart: e.target.checked}));
  $('st-notify')?.addEventListener('change', (e) => save({notifications: e.target.checked}));
  $('st-login')?.addEventListener('change', (e) => save({openAtLogin: e.target.checked}));
  $('st-theme')?.addEventListener('change', (e) => save({theme: e.target.value}));
  $('st-role')?.addEventListener('change', (e) => e.target.value && save({role: e.target.value}));
  document
    .querySelectorAll('[data-st-use]')
    .forEach((c) =>
      c.addEventListener('change', () =>
        save({uses: [...document.querySelectorAll('[data-st-use]:checked')].map((x) => x.dataset.stUse)})
      )
    );
  $('st-univ')?.addEventListener('change', (e) => save({university: e.target.value}));
  $('st-univ-url')?.addEventListener('change', (e) => save({universityUrl: e.target.value}));
  // 授業資料の自動取り込み（v0.17.0）
  $('st-import-on')?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    await save({importEnabled: on});
    if (on) await scanDownloads(); // オンにしたら、すでにダウンロードしたもの（今学期の期間）も探す
  });
  $('st-import-scan')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    await scanDownloads().finally(() => (e.target.disabled = false));
    reload();
  });
  document
    .querySelectorAll('input[name=st-import-mode]')
    .forEach((r) => r.addEventListener('change', () => save({importMode: r.value})));
  $('st-import-site-add')?.addEventListener('click', () => {
    const v = $('st-import-site').value.trim();
    if (v) save({importSiteAdd: v});
  });
  $('st-teams-site-add')?.addEventListener('click', () => {
    const v = $('st-teams-site').value.trim();
    if (v) save({teamsSiteAdd: v});
  });
  document
    .querySelectorAll('[data-import-site-remove]')
    .forEach((b) => b.addEventListener('click', () => save({importSiteRemove: b.dataset.importSiteRemove})));
  document.querySelectorAll('[data-login]').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'ログイン窓を開いています…';
      const r = await api['connection.login']({connectionId: b.dataset.login, mode: 'visible'});
      toast(r?.ok ? 'ログインしました' : r?.message || r?.error || 'ログインできませんでした', {error: !r?.ok});
      reload();
    })
  );
  document.querySelectorAll('[data-show-course]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = await api['course.update']({
        courseId: b.dataset.showCourse,
        patch: {hidden: false, sync_enabled: true}
      });
      if (r?.error) toast(r.error, {error: true});
      else reload();
    })
  );
  // ID とパスワードの欄に、前に入れた ID と「保存したパスワードを使う」を入れておく（v0.18.10）
  document.querySelectorAll('[data-form]').forEach((f) => {
    const cid = f.dataset.form;
    api['connection.savedLogin']({connectionId: cid}).then((r) => {
      const u = $(`st-user-${cid}`),
        p = $(`st-pass-${cid}`);
      if (!r || r.error || !u || u.value) return;
      u.value = r.user ?? '';
      if (r.hasPassword && p) p.placeholder = 'パスワード（保存したものを使います。変えるときだけ入れる）';
    });
  });
  document.querySelectorAll('[data-save-pass]').forEach((b) =>
    b.addEventListener('click', async () => {
      const cid = b.dataset.savePass;
      const r = await api['connection.savePassword']({
        connectionId: cid,
        user: $(`st-user-${cid}`).value,
        password: $(`st-pass-${cid}`).value
      });
      if (r?.error) return toast(r.error, {error: true});
      $(`st-pass-${cid}`).value = '';
      toast('自動ログインをオンにしました');
      reload();
    })
  );
  document.querySelectorAll('[data-forget-pass]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (
        !(await confirmDialog(
          '自動ログインをやめますか？ 保存した ID とパスワードを消します（資料と注釈は残ります。次の同期からはログインの窓が出ます）',
          {ok: 'やめる（消す）', danger: true}
        ))
      )
        return;
      const r = await api['connection.forgetPassword']({connectionId: b.dataset.forgetPass});
      if (r?.error) return toast(r.error, {error: true});
      toast('自動ログインをやめ、保存した ID とパスワードを消しました');
      reload();
    })
  );
  document.querySelectorAll('[data-remove-conn]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (
        !(await confirmDialog('この接続を削除しますか？ 授業・資料・注釈は残ります。', {ok: '削除する', danger: true}))
      )
        return;
      const r = await api['connection.remove']({connectionId: b.dataset.removeConn});
      if (r?.error) toast(r.error, {error: true});
      else toast('接続を削除しました');
      reload();
    })
  );
}
