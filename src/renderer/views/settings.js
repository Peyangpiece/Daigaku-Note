// 設定（SPEC §12.2）。接続・学期・保存先・同期・見た目。変更はすぐ保存する。
import {esc, reload, toast} from '../app.js';

const api = window.daigaku;

export function renderSettings({data}) {
  const s = data.settings;
  queueMicrotask(bind);
  return `
    <nav style="display:flex; gap: var(--space-2); align-items:center; margin-bottom: var(--space-3)">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button><h2>設定</h2>
    </nav>
    <div style="display:grid; gap: var(--space-3); max-width: 760px">
      <section class="card"><h3>接続（LMS）</h3>
        ${
          data.connections.length
            ? `<ul style="padding-left: 1.2em">${data.connections
                .map(
                  (c) => `<li style="margin-bottom: 6px">${esc(c.label)} <span class="muted">${esc(c.kind)} / ${esc(c.connector_id)}${c.base_url ? ` / ${esc(c.base_url)}` : ''}${c.status !== 'ok' ? ` / <strong>${c.status === 'login-required' ? 'ログインが必要' : esc(c.status)}</strong>` : ''}</span>
                    <span style="display:inline-flex; gap: 6px; margin-left: 8px">
                      ${c.kind !== 'manual' ? `<button class="btn" data-login="${esc(c.id)}">ログインし直す</button>` : ''}
                      <button class="btn" data-remove-conn="${esc(c.id)}">削除</button>
                    </span></li>`
                )
                .join('')}</ul>`
            : '<p class="muted">接続がありません。</p>'
        }
        <button class="btn" data-action="nav" data-route="/setup">接続を追加</button>
      </section>
      <section class="card"><h3>学期</h3>
        ${data.terms.length ? `<ul style="padding-left: 1.2em">${data.terms.map((t) => `<li>${t.year} ${esc(t.label)} <span class="muted">${esc(t.start_date)}〜${esc(t.end_date)}・${t.rounds} 回${t.periods_json ? '・時限あり' : '・時限未設定'}</span></li>`).join('')}</ul>` : '<p class="muted">学期の設定がありません。</p>'}
        <button class="btn" data-action="nav" data-route="/setup">学期を設定</button>
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
          <label>テーマ<select class="input" id="st-theme">${[['system', 'OS に合わせる'], ['light', '明るい'], ['dark', '暗い']].map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>罫線<select class="input" id="st-rules">${[['normal', '標準'], ['light', '薄い'], ['none', 'なし']].map(([v, l]) => `<option value="${v}" ${s.rules === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
      </section>
      <section class="card"><h3>ブラウザ（LMS の画面を読むための Chromium）</h3>
        <p class="muted">状態：${data.browser?.state === 'ready' ? '用意できています' : data.browser?.state === 'pending' ? '準備中…' : `失敗：${esc(data.browser?.message ?? '')}`}</p>
        <button class="btn" data-action="install-browser" ${data.browser?.state === 'pending' ? 'disabled' : ''}>ブラウザを準備し直す</button>
      </section>
      <section class="card"><h3>情報</h3><p class="muted">大学ノート ${esc(data.version)}</p></section>
    </div>`;
}

function bind() {
  const $ = (id) => document.getElementById(id);
  const save = async (patch) => {
    const r = await api['settings.update']({patch});
    if (r?.error) toast(r.error);
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
      toast(r?.ok ? 'ログインしました' : r?.message || r?.error || 'ログインできませんでした');
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
