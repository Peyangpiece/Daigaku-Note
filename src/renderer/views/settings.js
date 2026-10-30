// 設定（SPEC §12.2）。学期・授業・保存先・クイズ・見た目、下に LMS との連携（任意）と同期。変更はすぐ保存する。
import {AI_CONSENT_VERSION, AI_NOT_SENDS, AI_SENDS} from '../../shared/policy.js';
import {confirmDialog, esc, toast} from '../ui-kit.js';
import {reload} from '../store.js';
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
    ? `<p>API キー：<code>••••${esc(q.key.last4)}</code> <button class="btn btn--small" data-quiz-removekey>削除（同意も取り消す）</button></p>
       <p class="muted">${consentLine(q.consent)}</p>`
    : `<p class="muted">クイズを作るには、自分の Claude API キーが要ります（<button type="button" class="link" data-action="open-external" data-url="https://console.anthropic.com/settings/keys">Anthropic Console</button> で作れます）。費用は使った分だけで、1 回の作成はおよそ十数円（資料の量で前後します）。月の上限は下で決められます。</p>
       <details class="consent"><summary>AI に送るもの・送らないもの（${esc(AI_CONSENT_VERSION)} 版）</summary>
         <p><strong>送る</strong>：${AI_SENDS.map(esc).join('。')}。</p>
         <p><strong>送らない</strong>：${AI_NOT_SENDS.map(esc).join('。')}。</p>
       </details>
       <label style="display:block; margin: var(--space-1) 0"><input type="checkbox" id="qz-consent"> 上の内容で、資料の本文を Claude API に送ることに同意します</label>
       <div style="display:flex; gap: var(--space-1); align-items:end"><label style="flex:1">API キー<input class="input" id="qz-key" type="password" placeholder="キーを貼り付け（sk-ant- で始まります）" autocomplete="off" data-keep="off"></label><button class="btn btn--primary" data-quiz-setkey>確かめて保存</button></div>`;
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
      <section class="card" id="st-mobile"><h3>スマホとつなぐ</h3><div data-v="mobile">読み込み中…</div></section>
      <section class="card" id="st-data"><h3>データ</h3>
        <p class="muted">授業・回・資料の記録、書き込み、クイズ、設定をまとめた 1 つのファイル（.sqlite）です。大学のアカウントの情報と資料のファイルは含みません。毎日の写しは 7 日分、自動で取っています。</p>
        <div class="about__row"><button type="button" class="btn btn--small" data-backup="export">バックアップを書き出す</button><button type="button" class="btn btn--small" data-backup="import">バックアップを読み込む…</button><button type="button" class="btn btn--small btn--quiet" data-backup="dir">自動バックアップのフォルダを開く</button></div>
        <p class="muted">読み込むと、いまのデータはそのファイルの中身に置き換わります（いまのものは before-restore という名前で残します）。別のパソコンへ移すときは、資料のフォルダをコピーし、同じ保存先にしてから読み込み、LMS にログインし直してください。</p>
      </section>
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
          <p class="muted" style="align-self:end">ノートの種類・色・線の濃さは<button class="btn btn--small" data-action="nav" data-route="/kisekae">着せ替え</button>で、PDF に書くペンは<button class="btn btn--small" data-action="nav" data-route="/fudebako">筆箱</button>で変えられます</p>
        </div>
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
      ${quizSection(data.quiz && {...data.quiz, consent: data.settings.aiConsent}, focus === 'quiz')}
      </div>`
          : ''
      }
      <div${showLms ? '' : ' hidden'}>
      <h3 class="settings__group">大学の LMS</h3>
      <div class="settings__grid">
      <section class="card" id="st-lms"><h3>大学の LMS とつなぐ</h3>
        <p class="muted">大学の LMS（学習支援サービス）とつなぐと、授業の資料を自動で集めます（いま使えるのは Moodle と manabo（試験中））。</p>
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
            : '<p class="muted">大学の LMS（manaba・Moodle など）とはつないでいません。</p>'
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
        ${s.openAtLogin?.available ? '' : '<p class="muted" style="margin-top: 4px">インストールしたアプリから起動しているときに設定できます（開発中の起動では使えません）。</p>'}
      </section>
      </div>
      </div>
      ${showQuiz && showLms ? '' : '<p class="muted">使わない機能の設定は出していません。出すには、上の「使い方」で選んでください。</p>'}
      <section class="card" id="st-about"><h3>情報</h3>
        <p>大学ノート ${esc(data.version)}<span class="about__alpha">α 版</span></p>
        <p class="muted">試験中の版です。動かないことやデータが消えることがあります。大切な資料は元の場所にも残してください。</p>
        <div class="about__row"><button type="button" class="btn btn--small" data-action="policy">利用規約とプライバシーポリシー</button><button type="button" class="btn btn--small" data-action="notices">第三者のソフトウェアのライセンス</button></div>
        <p class="muted">データの場所：<code>${esc(data.dataDir ?? '')}</code></p>
        <div class="about__row"><button type="button" class="btn btn--small" data-action="open-data-dir">データの場所を開く</button><button type="button" class="btn btn--small" data-action="open-logs">ログを開く</button></div>
        <p class="muted">不具合は GitHub の Peyangpiece/Daigaku-Note の Issues へ。ログは 7 日分残り、パスワードや Cookie は含みません。</p>
      </section>
    </div>`;
}

/** AI への同意の記録の 1 行 */
function consentLine(c) {
  if (!c?.at) return 'AI に送る内容への同意の記録がありません。';
  const at = new Date(c.at).toLocaleString('ja-JP', {dateStyle: 'medium', timeStyle: 'short'});
  return c.version === AI_CONSENT_VERSION
    ? `AI に送る内容に同意：${esc(at)}（${esc(c.version)} 版）`
    : `送る内容の説明が ${esc(c.version)} 版から変わりました。キーを削除して、同意し直してください。`;
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
    <p class="muted">同じ Wi-Fi のスマホのブラウザで、今日の復習・資料と書き込みを見る・メモやマーカーを書く・写真を回のフォルダへ送る、ができます。資料はこのパソコンの中にだけあり、インターネットには送りません。</p>
    <label style="display:block"><input type="checkbox" data-mobile-on ${s.enabled ? 'checked' : ''}> スマホとつなぐ（大学ノートを開いている間だけ）</label>
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
      <p class="muted">つながらないとき：パソコンとスマホが同じ Wi-Fi にあるか確かめてください。大学の Wi-Fi は端末どうしがつながらない設定のことが多く、家の Wi-Fi で使うのがおすすめです。</p>`
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
      if (!$('qz-consent').checked) return toast('送る内容への同意にチェックを入れてください', {error: true});
      qset.disabled = true;
      qset.textContent = '確かめています…';
      const r = await api['quiz.setKey']({apiKey: $('qz-key').value, consent: true});
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
