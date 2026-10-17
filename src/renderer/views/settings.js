// 設定（SPEC §12.2）。M0 は接続・学期・保存先・同期・見た目の骨格。
import {esc} from '../app.js';

export function renderSettings({data}) {
  const s = data.settings;
  return `
    <nav style="display:flex; gap: var(--space-2); align-items:center; margin-bottom: var(--space-3)">
      <button class="btn" data-action="nav" data-route="/">← ホーム</button><h2>設定</h2>
    </nav>
    <div style="display:grid; gap: var(--space-3); max-width: 760px">
      <section class="card"><h3>接続（LMS）</h3>
        ${data.connections.length ? `<ul style="padding-left: 1.2em">${data.connections.map((c) => `<li>${esc(c.label)} <span class="muted">${esc(c.kind)} / ${esc(c.connector_id)} ${c.base_url ? `/ ${esc(c.base_url)}` : ''} ${c.status !== 'ok' ? `/ <strong>${esc(c.status)}</strong>` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">接続がありません。</p>'}
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
        <p class="muted">毎日 ${esc(s.syncTime)} に全体を同期。授業開始の同期：${s.classStart ? 'オン' : 'オフ'}。定期の確認：${s.everyHours ? `${s.everyHours} 時間ごと` : 'オフ'}</p>
        <p class="muted">（時刻や設定の変更フォームは M1 で）</p>
      </section>
      <section class="card"><h3>見た目</h3>
        <p class="muted">テーマ：${esc(s.theme)}・罫線：${esc(s.rules)}（変更フォームは M1 で）</p>
      </section>
      <section class="card"><h3>情報</h3><p class="muted">大学ノート ${esc(data.version)}</p></section>
    </div>`;
}
