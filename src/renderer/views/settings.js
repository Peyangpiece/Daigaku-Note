// 設定（SPEC §12.2）。接続・学期・授業・保存先・同期・見た目。変更はすぐ保存する。
import {esc, reload, toast} from '../app.js';

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

/** ブラウザの準備の状態。技術的な文言は「くわしく」の中へ */
export function browserState(b) {
  if (b?.state === 'ready') return '用意できています';
  if (b?.state === 'pending') return '準備中…（初回だけ。数分かかります）';
  return `準備に失敗しました。ネットにつながっているか確かめて、「準備し直す」を押してください。${b?.message ? `<details class="muted"><summary>くわしく</summary>${esc(b.message)}</details>` : ''}`;
}

export function renderSettings({data}) {
  const s = data.settings;
  const hidden = data.courses.filter((c) => c.hidden);
  queueMicrotask(bind);
  return `
    <nav class="page-nav">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button><h2>設定</h2>
    </nav>
    <div style="display:grid; gap: var(--space-3); max-width: 760px">
      <section class="card"><h3>接続（LMS）</h3>
        ${
          data.connections.length
            ? `<ul style="padding-left: 1.2em">${data.connections
                .map(
                  (
                    c
                  ) => `<li style="margin-bottom: 6px">${esc(c.label)} <span class="muted">${esc(KIND_LABEL[c.kind] ?? c.kind)}${c.base_url ? ` ・ ${esc(c.base_url)}` : ''} ・ 前回の同期 ${esc(fmtDate(c.last_sync_at))}${c.status !== 'ok' ? ` ・ <strong>${c.status === 'login-required' ? 'ログインが必要です' : esc(c.status)}</strong>` : ''}</span>
                    <span style="display:inline-flex; gap: 6px; margin-left: 8px">
                      ${c.kind !== 'manual' ? `<button class="btn" data-login="${esc(c.id)}">ログインし直す</button>` : ''}
                      <button class="btn" data-remove-conn="${esc(c.id)}">削除</button>
                    </span>${c.kind === 'recipe' ? autoLogin(c) : ''}</li>`
                )
                .join('')}</ul>`
            : '<p class="muted">接続がありません。</p>'
        }
        <button class="btn" data-action="nav" data-route="/setup">接続を追加</button>
      </section>
      <section class="card"><h3>学期</h3>
        ${data.terms.length ? `<ul style="padding-left: 1.2em">${data.terms.map((t) => `<li>${t.year} ${esc(t.label)} <span class="muted">${esc(t.start_date)}〜${esc(t.end_date)}・${t.rounds} 回${t.periods_json ? '・時限あり' : '・時限未設定'}</span></li>`).join('')}</ul>` : '<p class="muted">学期の設定がありません。</p>'}
        <button class="btn" data-action="nav" data-route="/settings/term">${data.terms.length ? '学期を編集・追加' : '学期を設定'}</button>
      </section>
      <section class="card"><h3>授業</h3>
        ${
          hidden.length
            ? `<p class="muted">非表示の授業（同期もしません）：</p><ul style="padding-left: 1.2em">${hidden.map((c) => `<li style="margin-bottom: 6px">${esc(c.name)} <button class="btn btn--small" data-show-course="${esc(c.id)}">表示して同期する</button></li>`).join('')}</ul>`
            : '<p class="muted">非表示の授業はありません。</p>'
        }
      </section>
      <section class="card"><h3>保存先</h3>
        <p><code>${esc(s.root)}</code>${s.root === s.defaultRoot ? ' <span class="muted">（既定）</span>' : ''}</p>
        <div style="display:flex; gap: var(--space-1)"><button class="btn" data-action="pick-dir">フォルダを選択…</button>${s.root !== s.defaultRoot ? '<button class="btn" data-action="reset-dir">既定に戻す</button>' : ''}<button class="btn" data-action="open-root">開く</button></div>
      </section>
      <section class="card"><h3>同期</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2)">
          <label>毎日の同期の時刻<input class="input" id="st-time" type="time" value="${esc(s.syncTime)}"></label>
          <label>定期の確認<select class="input" id="st-every">${[0, 1, 3, 6].map((h) => `<option value="${h}" ${s.everyHours === h ? 'selected' : ''}>${h ? `${h} 時間ごと` : 'オフ'}</option>`).join('')}</select></label>
        </div>
        <label style="display:block; margin-top: var(--space-2)"><input type="checkbox" id="st-class" ${s.classStart ? 'checked' : ''}> 授業の開始時刻に、その授業を同期する（学期の設定に時限の時刻が要ります）</label>
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
          <label>罫線<select class="input" id="st-rules">${[
            ['normal', '標準'],
            ['light', '薄い'],
            ['none', 'なし']
          ]
            .map(([v, l]) => `<option value="${v}" ${s.rules === v ? 'selected' : ''}>${l}</option>`)
            .join('')}</select></label>
        </div>
      </section>
      <section class="card"><h3>LMS を読むためのブラウザ</h3>
        <div class="muted">状態：${browserState(data.browser)}</div>
        <button class="btn" data-action="install-browser" ${data.browser?.state === 'pending' ? 'disabled' : ''}>ブラウザを準備し直す</button>
      </section>
      <section class="card"><h3>情報</h3><p class="muted">大学ノート ${esc(data.version)}</p></section>
    </div>`;
}

function bind() {
  const $ = (id) => document.getElementById(id);
  const save = async (patch) => {
    const r = await api['settings.update']({patch});
    if (r?.error) toast(r.error, {error: true});
    else reload();
  };
  $('st-time')?.addEventListener('change', (e) => save({syncTime: e.target.value}));
  $('st-every')?.addEventListener('change', (e) => save({everyHours: Number(e.target.value)}));
  $('st-class')?.addEventListener('change', (e) => save({classStart: e.target.checked}));
  $('st-theme')?.addEventListener('change', (e) => save({theme: e.target.value}));
  $('st-rules')?.addEventListener('change', (e) => save({rules: e.target.value}));
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
      await api['connection.remove']({connectionId: b.dataset.removeConn});
      reload();
    })
  );
}
