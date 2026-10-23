// 設定（SPEC §12.2）。学期・授業・保存先・クイズ・見た目、下に LMS との連携（任意）と同期。変更はすぐ保存する。
import {esc, reload, toast} from '../app.js';
import {ROLES, USES, features} from '../../shared/profile.js';

const api = window.daigaku;
const KIND_LABEL = {api: 'API で読む', recipe: '画面を読む', generic: '汎用の読み取り', manual: '手動で取り込む'};
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
  if (c.save_password)
    return `<div class="muted" style="margin-top: 6px">自動ログイン：オン（保存した ID とパスワードで入ります）${learned ? '' : '。<strong>最初に一度「ログインし直す」で窓からログインしてください</strong>（通るページを覚えて、次から自動で入ります）'} <button class="btn btn--small" data-forget-pass="${esc(c.id)}">自動ログインをやめる</button></div>`;
  return `<details style="margin-top: 6px"><summary class="muted">自動ログイン：オフ — ID とパスワードを保存して自動でログインする</summary>
    <div data-form="${esc(c.id)}" style="display:grid; gap: var(--space-1); max-width: 360px; margin-top: var(--space-1)">
      <label class="sr-only" for="st-user-${esc(c.id)}">ID</label><input class="input" id="st-user-${esc(c.id)}" placeholder="ID（学籍番号など）" autocomplete="username">
      <label class="sr-only" for="st-pass-${esc(c.id)}">パスワード</label><input class="input" id="st-pass-${esc(c.id)}" type="password" placeholder="パスワード" autocomplete="current-password">
      <p class="muted" style="margin:0">このパソコンの中だけに暗号化して保存します。メールの認証コードを聞かれたときは、要確認からログイン窓を開いてコードを入れてください。</p>
      <div><button class="btn btn--small" data-save-pass="${esc(c.id)}">保存してオンにする</button></div>
    </div></details>`;
}

/** クイズ（SPEC §11.8・§11.9）：API キー・同意・モデル・問題数と種類・上限・今月の使用量 */
const TYPE_NAMES = {choice: '選択', tf: '正誤', cloze: '穴埋め', num: '数値', card: '記述カード'};
function quizSection(q, focus = false) {
  if (!q) return '';
  const key = q.key?.set
    ? `<p>API キー：<code>••••${esc(q.key.last4)}</code> <button class="btn btn--small" data-quiz-removekey>削除</button></p>`
    : `<p class="muted">クイズを作るには、自分の Claude API キーが要ります（<a href="#" data-action="open-external" data-url="https://console.anthropic.com/settings/keys">Anthropic Console</a> で作れます。使った分だけ費用がかかります）。</p>
       <details class="consent"><summary>AI に送るもの・送らないもの</summary>
         <p><strong>送る</strong>：その回の資料の本文（学籍番号などの ID・メール・電話番号は消してから）、授業名、回のタイトル、その回のメモ。</p>
         <p><strong>送らない</strong>：大学のアカウント・パスワード・Cookie、資料のファイルそのもの、ほかの回の資料、成績、名前、LMS の URL。</p>
       </details>
       <label style="display:block; margin: var(--space-1) 0"><input type="checkbox" id="qz-consent"> 上の内容で、資料の本文を Claude API に送ることに同意します</label>
       <div style="display:flex; gap: var(--space-1); align-items:end"><label style="flex:1">API キー<input class="input" id="qz-key" type="password" placeholder="sk-ant-…" autocomplete="off" data-keep="off"></label><button class="btn btn--primary" data-quiz-setkey>確かめて保存</button></div>`;
  const mix = Object.entries(TYPE_NAMES)
    .map(
      ([t, label]) =>
        `<label>${label}<input class="input" type="number" min="0" max="30" id="qz-mix-${t}" value="${q.mix?.[t] ?? 0}"></label>`
    )
    .join('');
  return `<section class="card" id="st-quiz"${focus ? ' data-scroll-into-view' : ''}><h3>クイズ</h3>
    ${key}
    <p class="muted" style="margin: var(--space-1) 0 0">今月の費用：$${(q.monthUsd ?? 0).toFixed(2)} ／ 上限 $${q.perMonthUsd}・今日の作成 ${q.today} ／ ${q.perDay} 回</p>
    <details class="settings__more"><summary>問題の数と種類・AI のモデル・費用の上限</summary>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-2)">
      <label>AI のモデル<select class="input" id="qz-model">${Object.entries(q.models ?? {})
        .map(([id, label]) => `<option value="${esc(id)}" ${id === q.model ? 'selected' : ''}>${esc(label)}</option>`)
        .join('')}</select></label>
    </div>
    <p style="margin: var(--space-2) 0 4px">1 回分の問題数と種類（合計 1〜30 問）</p>
    <div class="qz-mix">${mix}</div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-2)">
      <label>1 日に作れる回数<input class="input" type="number" min="1" max="200" id="qz-perday" value="${q.perDay}"></label>
      <label>1 か月の費用の上限（ドル）<input class="input" type="number" min="0.5" max="500" step="0.5" id="qz-permonth" value="${q.perMonthUsd}"></label>
    </div>
    <div class="actions"><button class="btn" data-quiz-save>クイズの設定を保存</button></div>
    </details>
  </section>`;
}

/** ブラウザの準備の状態。技術的な文言は「くわしく」の中へ */
export function browserState(b) {
  if (b?.state === 'ready') return '用意できています';
  if (b?.state === 'pending') return '準備中…（初回だけ。数分かかります）';
  return `準備に失敗しました。ネットにつながっているか確かめて、「準備し直す」を押してください。${b?.message ? `<details class="muted"><summary>くわしく</summary>${esc(b.message)}</details>` : ''}`;
}

export function renderSettings({data}, route = '/settings') {
  const s = data.settings;
  const hidden = data.courses.filter((c) => c.hidden);
  // 「手動」の接続はアプリの中の仕組み（自分のファイルの置き場）なので出さない。同期の設定は LMS をつないだときだけ出す
  const lmsConns = data.connections.filter((c) => c.kind !== 'manual');
  const hasLms = lmsConns.length > 0;
  const focus = new URLSearchParams(route.split('?')[1] ?? '').get('focus');
  // 使い方に合わせて項目を出す。使っていない機能でも、もう設定してあるもの（LMS の接続・API キー）は出す
  const f = features({role: s.role, uses: s.uses});
  const showLms = f.lms || hasLms;
  const showQuiz = f.quiz || !!data.quiz?.key?.set || focus === 'quiz';
  queueMicrotask(bind);
  return `
    <nav class="page-nav">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button><h2>設定</h2>
    </nav>
    <div class="settings">
      <h3 class="settings__group">ふだんの設定</h3>
      <div class="settings__grid">
      <section class="card" id="st-profile"><h3>使い方</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2)">
          <label>使う人<select class="input" id="st-role">${s.role ? '' : '<option value="">（未設定）</option>'}${Object.entries(
            ROLES
          )
            .map(([v, l]) => `<option value="${v}" ${s.role === v ? 'selected' : ''}>${l}</option>`)
            .join('')}</select></label>
          ${s.role === 'student' ? `<label>大学名<input class="input" id="st-univ" maxlength="60" placeholder="例：〇〇大学" value="${esc(s.university ?? '')}"></label>` : ''}
        </div>
        ${s.role ? `<div style="margin-top: var(--space-2)">${USES[s.role].map(([k, l]) => `<label style="display:block"><input type="checkbox" data-st-use="${k}" ${s.uses.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>` : ''}
      </section>
      ${
        f.terms
          ? `<section class="card"><h3>学期</h3>
        ${data.terms.length ? `<ul style="padding-left: 1.2em">${data.terms.map((t) => `<li>${t.year} ${esc(t.label)} <span class="muted">${esc(t.start_date)}〜${esc(t.end_date)}・${t.rounds} 回${t.periods_json ? '・時限あり' : '・時限未設定'}</span></li>`).join('')}</ul>` : '<p class="muted">学期の設定がありません。</p>'}
        <button class="btn" data-action="nav" data-route="/settings/term">${data.terms.length ? '学期を編集・追加' : '学期を設定'}</button>
      </section>`
          : ''
      }
      <section class="card"><h3>保存先</h3>
        <p><code>${esc(s.root)}</code>${s.root === s.defaultRoot ? ' <span class="muted">（既定）</span>' : ''}</p>
        <div style="display:flex; gap: var(--space-1)"><button class="btn" data-action="pick-dir">フォルダを選択…</button>${s.root !== s.defaultRoot ? '<button class="btn" data-action="reset-dir">既定に戻す</button>' : ''}<button class="btn" data-action="open-root">開く</button></div>
      </section>
      <section class="card"><h3>見た目</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2)">
          <label>テーマ<select class="input" id="st-theme">${[
            ['system', 'OS に合わせる'],
            ['light', '明るい'],
            ['dark', '暗い']
          ]
            .map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`)
            .join('')}</select></label>
          <p class="muted" style="align-self:end">ノートの種類・色・線の濃さは<button class="btn btn--small" data-action="nav" data-route="/kisekae">着せ替え</button>で変えられます</p>
        </div>
      </section>
      <section class="card"><h3>実験</h3>
        <label><input type="checkbox" id="st-experiments" ${s.experiments ? 'checked' : ''} /> 既製品の見た目のペン（ジェットストリーム・サラサクリップ）を筆箱のショップに出す</label>
        <p class="muted">個人で試すための試作です。メーカーの許しを得ていないので、一般に配る版では使わないでください。</p>
      </section>
        ${
          hidden.length
            ? `<section class="card"><h3>非表示の授業・フォルダ</h3>
                <p class="muted">ホームに出さない授業とフォルダ（授業は同期もしません）：</p>
                <ul style="padding-left: 1.2em">${hidden.map((c) => `<li style="margin-bottom: 6px">${esc(c.name)} <button class="btn btn--small" data-show-course="${esc(c.id)}">${c.kind === 'folder' ? 'ホームに戻す' : '表示して同期する'}</button></li>`).join('')}</ul>
              </section>`
            : ''
        }
      </div>
      ${
        showQuiz
          ? `<h3 class="settings__group">復習</h3>
      <div class="settings__grid">
      ${quizSection(data.quiz, focus === 'quiz')}
      </div>`
          : ''
      }
      <div${showLms ? '' : ' hidden'}>
      <h3 class="settings__group">LMS</h3>
      <div class="settings__grid">
      <section class="card" id="st-lms"><h3>LMS との連携</h3>
        <p class="muted">つなぐと授業の資料を自動で集めます（いま使えるのは Moodle と manabo（試験中））。</p>
        ${
          lmsConns.length
            ? `<ul style="padding-left: 1.2em">${lmsConns
                .map(
                  (
                    c
                  ) => `<li style="margin-bottom: 6px"><span data-rename-box><span data-rename-target>${esc(c.label)}</span> <button type="button" class="rename-btn" data-action="rename" data-what="conn" data-id="${esc(c.id)}" data-value="${esc(c.label)}" title="名前を変える" aria-label="${esc(c.label)}の名前を変える">✎</button></span> <span class="muted">${esc(KIND_LABEL[c.kind] ?? c.kind)}${c.base_url ? ` ・ ${esc(c.base_url)}` : ''} ・ 前回の同期 ${esc(fmtDate(c.last_sync_at))}${c.status !== 'ok' ? ` ・ <strong>${c.status === 'login-required' ? 'ログインが必要です' : esc(c.status)}</strong>` : ''}</span>
                    <span style="display:inline-flex; gap: 6px; margin-left: 8px">
                      ${c.kind !== 'manual' ? `<button class="btn" data-login="${esc(c.id)}">ログインし直す</button>` : ''}
                      <button class="btn" data-remove-conn="${esc(c.id)}">削除</button>
                    </span>${c.kind === 'recipe' ? autoLogin(c) : ''}</li>`
                )
                .join('')}</ul>`
            : '<p class="muted">LMS とはつないでいません。</p>'
        }
        <button class="btn${lmsConns.length ? '' : ' btn--primary'}" data-action="nav" data-route="/settings/lms">${lmsConns.length ? '別の LMS を追加' : 'LMS とつなぐ'}</button>
        <div class="muted" style="margin-top: var(--space-2)">LMS を読むためのブラウザ：${browserState(data.browser)}
          <button class="btn btn--small" data-action="install-browser" ${data.browser?.state === 'pending' ? 'disabled' : ''}>準備し直す</button></div>
      </section>
      <section class="card"${hasLms ? '' : ' hidden'}><h3>LMS の同期</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2)">
          <label>毎日の同期の時刻<input class="input" id="st-time" type="time" value="${esc(s.syncTime)}"></label>
          <label>定期の確認<select class="input" id="st-every">${[0, 1, 3, 6].map((h) => `<option value="${h}" ${s.everyHours === h ? 'selected' : ''}>${h ? `${h} 時間ごと` : 'オフ'}</option>`).join('')}</select></label>
        </div>
        <label style="display:block; margin-top: var(--space-2)"><input type="checkbox" id="st-class" ${s.classStart ? 'checked' : ''}> 授業の開始時刻に、その授業を同期する（学期の設定に時限の時刻が要ります）</label>
        <label style="display:block; margin-top: var(--space-2)"><input type="checkbox" id="st-notify" ${s.notifications === false ? '' : 'checked'}> 新しい資料・ログインの必要・クイズの完成・同期の失敗を、パソコンの通知で知らせる</label>
        <label style="display:block; margin-top: var(--space-2)"><input type="checkbox" id="st-login" ${s.openAtLogin?.on ? 'checked' : ''} ${s.openAtLogin?.available ? '' : 'disabled'}> パソコンにログインしたら大学ノートを起動する（同期はアプリが起動している間だけ動きます）</label>
        ${s.openAtLogin?.available ? '' : '<p class="muted" style="margin-top: 4px">アプリとして入れたとき（Mac は <code>npm run install:mac</code>）に設定できます。</p>'}
      </section>
      </div>
      </div>
      ${showQuiz && showLms ? '' : '<p class="muted">使わない機能の設定は出していません。出すには、上の「使い方」で選んでください。</p>'}
      <section class="card"><h3>情報</h3><p class="muted">大学ノート ${esc(data.version)}</p></section>
    </div>`;
}

function bind() {
  const $ = (id) => document.getElementById(id);
  const qset = document.querySelector('[data-quiz-setkey]');
  if (qset)
    qset.onclick = async () => {
      if (!$('qz-consent').checked) return toast('送る内容への同意にチェックを入れてください', {error: true});
      qset.disabled = true;
      qset.textContent = '確かめています…';
      const r = await api['quiz.setKey']({apiKey: $('qz-key').value});
      qset.disabled = false;
      qset.textContent = '確かめて保存';
      if (r?.error) return toast(r.error, {error: true});
      $('qz-key').value = '';
      toast('API キーを保存しました。授業画面からクイズを作れます');
      reload();
    };
  const qrm = document.querySelector('[data-quiz-removekey]');
  if (qrm)
    qrm.onclick = async () => {
      if (!confirm('API キーを削除しますか？（作った問題と記録は残ります）')) return;
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
      toast('クイズの設定を保存しました');
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
  $('st-experiments')?.addEventListener('change', (e) => save({experiments: e.target.checked}));
  $('st-role')?.addEventListener('change', (e) => e.target.value && save({role: e.target.value}));
  document
    .querySelectorAll('[data-st-use]')
    .forEach((c) =>
      c.addEventListener('change', () =>
        save({uses: [...document.querySelectorAll('[data-st-use]:checked')].map((x) => x.dataset.stUse)})
      )
    );
  $('st-univ')?.addEventListener('change', (e) => save({university: e.target.value}));
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
      toast('自動ログインをオンにしました。次の同期から使います');
      reload();
    })
  );
  document.querySelectorAll('[data-forget-pass]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = await api['connection.forgetPassword']({connectionId: b.dataset.forgetPass});
      if (r?.error) return toast(r.error, {error: true});
      toast('自動ログインをやめ、保存した ID とパスワードを消しました');
      reload();
    })
  );
  document.querySelectorAll('[data-remove-conn]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('この接続を削除しますか？ 授業・資料・注釈は残ります。')) return;
      const r = await api['connection.remove']({connectionId: b.dataset.removeConn});
      if (r?.error) toast(r.error, {error: true});
      else toast('接続を削除しました');
      reload();
    })
  );
}
