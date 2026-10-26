// 学期の設定（SPEC §6.14・§12.2）。セットアップの手順 4 と、設定 → 学期 の編集画面で同じ入力欄を使う。
// 学期名は候補から選ぶか、自由に入力する（大学によって「1学期」「Fall」などがあるため）
import {confirmDialog, esc, toast} from '../ui-kit.js';
import {navigate, refresh, reload} from '../store.js';
import {TERM_LABELS, classDatesFor, defaultTermDates, overlapping} from '../../shared/term.js';
import {WD, cleanCalendar, termCalendar} from '../../shared/calendar.js';

const api = window.daigaku;
const ROUNDS = [15, 14, 8, 7];
let editingId; // undefined = いちばん新しい学期、null = 新しい学期を追加
// 学年暦（休講日・振替授業日）の下書き。学期を選び直すと、その学期の値から作り直す。保存は「保存」で（readTermForm が返す）
// cal.rounds：学年暦の授業回（[{date, weekday, n}]）。保存のとき、学期の期間に入る並びを曜日ごとに選んで class_dates_json に入れる
let cal = null;
let calFor;

/** 設定から入り直したときは、いちばん新しい学期から（app.js が呼ぶ） */
export function resetTerm() {
  editingId = undefined;
  cal = null;
  calFor = undefined;
}

const fmt = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${m}/${day}（${WD[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]}）`;
};

/** 学年暦の区画：ファイルから読み取る・手で足す・一覧（×で消す）。保存は学期の「保存」でまとめて */
function calendarSection(term, focus) {
  const inTerm = (d) => !term || (d >= term.start_date && d <= term.end_date);
  const li = (kind, e) =>
    `<li${inTerm(e.date) ? '' : ' class="muted" title="学期の期間の外の日（数えません）"'}><span>${fmt(e.date)}</span>${kind === 'swap' ? `<span>→ ${esc(e.weekday)}曜日の授業</span>` : ''}${e.label ? `<span class="muted">${esc(e.label)}</span>` : ''}<button type="button" class="cal-remove" data-cal-remove="${kind}" data-date="${esc(e.date)}" aria-label="${fmt(e.date)} を消す" title="消す">×</button></li>`;
  return `<section class="card" style="max-width: 760px" id="tm-calendar"${focus ? ' data-scroll-into-view' : ''}>
      <h3>学年暦（授業回・休講日・振替授業日）</h3>
      <p class="muted">大学の学年暦を入れると、回の日付と「今日の授業」が大学の予定どおりになります。学年暦に授業回（①〜⑮ や「第○回」）があれば、その日をそのまま第○回の日付にします。なければ、休講日を飛ばし、振替授業日（例：5/7（水）は月曜日の授業）を数えて計算します。祝日は自動で休みにします（祝日に授業を行う日は、その日の曜日で振替授業日に足してください）。</p>
      <div class="actions"><button type="button" class="btn btn--primary" id="tm-cal-read">学年暦のファイルから読み取る…</button><span class="muted">PDF・Word・テキスト。授業回の丸数字・灰色のます目（休講）・「休講・休業・試験・○曜日の授業」などの言葉から読み取り、ここで確かめてから保存します（AI には送りません）</span></div>
      ${cal.rounds?.length ? '<div class="cal-check" id="tm-round-check" aria-live="polite"></div>' : ''}
      <div class="cal-cols">
        <div>
          <h4>休講日 <span class="muted">${cal.holidays.length} 日</span></h4>
          <ul class="cal-list" id="tm-cal-holidays">${cal.holidays.map((e) => li('holiday', e)).join('') || '<li class="muted">まだありません</li>'}</ul>
          <div class="cal-add"><input type="date" class="input" id="tm-hol-date" aria-label="休講日"><button type="button" class="btn btn--small" id="tm-hol-add">休講日に足す</button></div>
        </div>
        <div>
          <h4>振替授業日 <span class="muted">${cal.swaps.length} 日</span></h4>
          <ul class="cal-list" id="tm-cal-swaps">${cal.swaps.map((e) => li('swap', e)).join('') || '<li class="muted">まだありません</li>'}</ul>
          <div class="cal-add"><input type="date" class="input" id="tm-swap-date" aria-label="振替授業日"><select class="input" id="tm-swap-wd" aria-label="行う授業の曜日">${[...'月火水木金土'].map((w) => `<option>${w}</option>`).join('')}</select><span>曜日の授業</span><button type="button" class="btn btn--small" id="tm-swap-add">足す</button></div>
        </div>
      </div>
      <p class="muted">学期の期間の外の日は数えません。保存すると、その学期の授業の回の日付を計算し直します（LMS から来た日付はそのままです）。</p>
      <div class="actions"><button type="button" class="btn btn--primary" data-tm-save>保存</button></div>
    </section>`;
}

/** 年度は 4 月はじまり（1〜3 月は前の年度）。学期名は 4〜9 月なら春学期、それ以外は秋学期 */
function defaults() {
  const d = new Date();
  const m = d.getMonth() + 1;
  return {year: m < 4 ? d.getFullYear() - 1 : d.getFullYear(), label: m >= 4 && m <= 9 ? '春学期' : '秋学期'};
}

/** 入力欄。term があればその値を入れる（id は tm-*） */
export function termForm(data, term, {compact = false} = {}) {
  const d = defaults();
  const year = term?.year ?? d.year;
  const label = term?.label ?? d.label;
  return `<div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2)">
      <label>年度<input class="input" id="tm-year" type="number" value="${esc(year)}"></label>
      <label>学期名<input class="input" id="tm-label" list="tm-labels" maxlength="20" value="${esc(label)}" placeholder="例：前期・秋学期" autocomplete="off"><datalist id="tm-labels">${TERM_LABELS.map((l) => `<option value="${esc(l)}"></option>`).join('')}</datalist></label>
      ${compact ? '</div><details class="settings__more"><summary>くわしく設定（開始日・終了日・回数・時限の開始時刻。空のままなら学期名からの既定）</summary><div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-2)">' : ''}
      <label>開始日<input class="input" id="tm-start" type="date" value="${esc(term?.start_date ?? '')}"></label>
      <label>終了日<input class="input" id="tm-end" type="date" value="${esc(term?.end_date ?? '')}"></label>
      <label>回数<select class="input" id="tm-rounds">${[...new Set([...ROUNDS, term?.rounds ?? 15])].map((n) => `<option ${n === (term?.rounds ?? 15) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>時限の開始時刻<select class="input" id="tm-preset"><option value="">${term?.periods_json ? '（いまの設定のまま）' : '（あとで設定）'}</option>${(data.presets ?? []).map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
    </div>${compact ? '</details>' : ''}
    <p class="muted">開始日・終了日を空にすると学期名からの既定（春・前期 4/1〜9/30、秋・後期 10/1〜3/31）になります。学期名を変えても日付は変わらないので、時期も変わるときは開始日・終了日を直してください。</p>`;
}

/** 入力欄から term.save に渡す値。時限と休みの日は、選び直さなければいまの設定を引き継ぐ */
export function readTermForm(term) {
  const $ = (id) => document.getElementById(id);
  const preset = $('tm-preset').value;
  return {
    id: term?.id ?? null, // 直している学期（学期名・年度を変えても同じ学期のまま）
    year: Number($('tm-year').value),
    label: $('tm-label').value,
    start: $('tm-start').value,
    end: $('tm-end').value,
    rounds: Number($('tm-rounds').value),
    preset,
    periods: !preset && term?.periods_json ? JSON.parse(term.periods_json) : undefined,
    holidays: cal ? cal.holidays.map((h) => h.date) : termCalendar(term).holidays,
    swaps: cal ? cal.swaps.map(({date, weekday}) => ({date, weekday})) : termCalendar(term).swaps,
    classDates: cal ? termClassDates().classDates : termCalendar(term).classDates
  };
}

export function renderTerm({data}, route = '/settings/term') {
  const terms = data.terms ?? [];
  if (editingId === undefined || (editingId && !terms.some((t) => t.id === editingId)))
    editingId = terms.at(-1)?.id ?? null;
  const term = terms.find((t) => t.id === editingId) ?? null;
  if (!cal || calFor !== editingId) {
    const c = termCalendar(term);
    cal = {
      holidays: c.holidays.map((date) => ({date})),
      swaps: c.swaps.map((s) => ({...s})),
      rounds: Object.entries(c.classDates).flatMap(([weekday, ds]) => ds.map((date, i) => ({date, weekday, n: i + 1})))
    };
    calFor = editingId;
  }
  const focusCal = /[?&]calendar=1/.test(route); // ホームの「学年暦を入れる」から来たときは学年暦の区画へ
  queueMicrotask(() => bind(term));
  return `
    <nav class="page-nav">
      <button class="btn" data-action="nav" data-route="/settings">← 設定</button><h2>学期</h2>
    </nav>
    <section class="card" style="max-width: 760px">
      <label style="display:block; margin-bottom: var(--space-2)">編集する学期<select class="input" id="tm-pick" data-keep="off">${terms.map((t) => `<option value="${esc(t.id)}" ${t.id === editingId ? 'selected' : ''}>${t.year} ${esc(t.label)}</option>`).join('')}<option value="" ${editingId === null ? 'selected' : ''}>＋ 新しい学期を追加</option></select></label>
      <div data-form="${esc(editingId ?? 'new')}">${termForm(data, term)}</div>
      ${(() => {
        const over = term ? overlapping(terms, term) : [];
        return over.length
          ? `<p class="muted">この学期は ${over.map((t) => `${t.year} ${esc(t.label)}`).join('・')} と期間が重なっています。重なっている日は、期間の短い学期を「今の学期」として使います。</p>`
          : '';
      })()}
      ${term ? '<p class="muted">年度・学期名を変えると、パソコンの学期フォルダ（例：2026_秋学期）の名前も変わります。授業や資料はこの学期に付いたままです。</p>' : ''}
      <div class="actions"><button class="btn btn--primary" id="tm-save">保存</button>${
        term && terms.length > 1 && !(data.courses ?? []).some((c) => c.term_id === term.id)
          ? '<button class="btn btn--quiet" id="tm-remove" title="授業・フォルダのない学期だけ消せます">この学期を消す</button>'
          : ''
      }</div>
    </section>
    ${calendarSection(term, focusCal)}`;
}

/** 下書きの授業回から、いまの入力の期間に入る並びを曜日ごとに選ぶ（shared/term.js の classDatesFor） */
function termClassDates() {
  const $ = (id) => document.getElementById(id);
  const def = defaultTermDates($('tm-label')?.value, Number($('tm-year')?.value));
  return classDatesFor(cal?.rounds ?? [], {
    start: $('tm-start')?.value || def.start,
    end: $('tm-end')?.value || def.end
  });
}

/** 学年暦の授業回：曜日ごとに第 1 回〜最終回の日を見せる。回の日付はこれをそのまま使う */
function renderRoundCheck() {
  const box = document.getElementById('tm-round-check');
  if (!box || !cal.rounds?.length) return;
  const $ = (id) => document.getElementById(id);
  const res = termClassDates();
  const li = (r) =>
    `<li><strong>${r.weekday}曜日</strong> 第 1 回 ${fmt(r.first.date)} 〜 第 ${r.last.n} 回 ${fmt(r.last.date)}（${r.count} 回）${
      r.missing.length ? `<span class="is-off">　第 ${r.missing.join('・')} 回が読み取れませんでした</span>` : ''
    }</li>`;
  const parts = [res.start && `開始日を ${fmt(res.start)}に`, res.end && `終了日を ${fmt(res.end)}に`].filter(Boolean);
  box.innerHTML = res.rows.length
    ? `<h4>授業回 <span class="muted">学年暦の丸数字の日を、そのまま第○回の日付にします（第 N 回 ＝ その曜日の N 番目の丸数字の日）</span></h4>
    <ul class="cal-check__list">${res.rows.map(li).join('')}</ul>
    ${parts.length ? `<p class="muted">学年暦の授業回が学期の期間からはみ出しています。</p><div class="actions"><button type="button" class="btn btn--small" id="tm-round-fix">期間を学年暦に合わせる（${parts.join('・')}）</button></div>` : ''}
    <div class="actions"><button type="button" class="btn btn--small btn--quiet" id="tm-round-clear">授業回を使わない（休講日・振替授業日から計算する）</button></div>`
    : `<h4>授業回</h4><p class="muted">読み取った授業回に、この学期の期間の日がありません。開始日・終了日を確かめてください。</p>
    <div class="actions"><button type="button" class="btn btn--small btn--quiet" id="tm-round-clear">授業回を使わない</button></div>`;
  const b = $('tm-round-fix');
  if (b)
    b.onclick = () => {
      if (res.start) $('tm-start').value = res.start;
      if (res.end) $('tm-end').value = res.end;
      refresh();
      toast(`期間を学年暦に合わせました（${parts.join('・')}）。内容を確かめて「保存」を押してください`);
    };
  const c = $('tm-round-clear');
  if (c)
    c.onclick = () => {
      cal.rounds = [];
      refresh();
    };
}

/** 読み取った・足した日を下書きに入れる（同じ日は 1 つに。振替授業日が休講日より強い） */
function addToCal({holidays = [], swaps = []}) {
  const c = cleanCalendar({holidays: [...cal.holidays, ...holidays], swaps: [...cal.swaps, ...swaps]});
  const labels = new Map([...cal.holidays, ...cal.swaps, ...holidays, ...swaps].map((e) => [e.date, e.label]));
  cal = {
    holidays: c.holidays.map((date) => ({date, label: labels.get(date)})),
    swaps: c.swaps.map((s) => ({...s, label: labels.get(s.date)})),
    rounds: cal.rounds
  };
}

function bindCalendar(term) {
  const $ = (id) => document.getElementById(id);
  const read = $('tm-cal-read');
  if (read)
    read.onclick = async () => {
      read.disabled = true;
      const year = Number($('tm-year')?.value) || term?.year;
      const r = await api['term.readCalendar']({year}).finally(() => (read.disabled = false));
      if (r?.error) return toast(r.error, {error: true});
      if (!r?.ok) return;
      if (!r.dates)
        return toast(`${r.file}：日付が見つかりませんでした。文字の入った PDF かテキストにしてください`, {error: true});
      addToCal(r);
      if (r.rounds?.length) cal.rounds = r.rounds; // 新しく読んだ学年暦の授業回にする
      const inTerm = (d) => !term || (d >= term.start_date && d <= term.end_date);
      const n = r.holidays.filter((e) => inTerm(e.date)).length + r.swaps.filter((e) => inTerm(e.date)).length;
      toast(
        `${r.file} から 休講日 ${r.holidays.length} 日・振替授業日 ${r.swaps.length} 日を読み取りました${term ? `（この学期の期間内 ${n} 日）` : ''}${r.rounds?.length ? `、授業回 ${r.rounds.length} 回分` : ''}${r.unknown ? `。言葉の分からなかった日付 ${r.unknown} 件は入れていません` : ''}。内容を確かめて「保存」を押してください`
      );
      refresh();
    };
  if ($('tm-hol-add'))
    $('tm-hol-add').onclick = () => {
      const d = $('tm-hol-date').value;
      if (!d) return toast('日付を選んでください', {error: true});
      addToCal({holidays: [{date: d}]});
      refresh();
    };
  if ($('tm-swap-add'))
    $('tm-swap-add').onclick = () => {
      const d = $('tm-swap-date').value;
      if (!d) return toast('日付を選んでください', {error: true});
      addToCal({swaps: [{date: d, weekday: $('tm-swap-wd').value}]});
      refresh();
    };
  for (const b of document.querySelectorAll('[data-cal-remove]'))
    b.onclick = () => {
      const {calRemove, date} = b.dataset;
      if (calRemove === 'holiday') cal.holidays = cal.holidays.filter((e) => e.date !== date);
      else cal.swaps = cal.swaps.filter((e) => e.date !== date);
      refresh();
    };
  // 授業回の確かめ：期間・回数を変えたら比べ直す
  renderRoundCheck();
  for (const id of ['tm-year', 'tm-label', 'tm-start', 'tm-end', 'tm-rounds'])
    document.getElementById(id)?.addEventListener('change', renderRoundCheck);
}

function bind(term) {
  bindCalendar(term);
  const $ = (id) => document.getElementById(id);
  if ($('tm-pick'))
    $('tm-pick').onchange = (e) => {
      editingId = e.target.value || null;
      reload();
    };
  for (const b of document.querySelectorAll('#tm-save, [data-tm-save]'))
    b.onclick = async () => {
      const r = await api['term.save']({term: readTermForm(term)});
      if (r.error) return toast(r.error, {error: true});
      editingId = r.term?.id ?? editingId;
      cal = null; // 次に開いたときは保存した値から
      // 画面の学期の一覧・上の学期名を読み直してから戻る（読み直さないと、前の名前のまま見える）
      await reload();
      toast(r.redated ? `学期を保存しました。回の日付を ${r.redated} 件計算し直しました` : '学期を保存しました');
      navigate('/settings');
    };
  if ($('tm-remove'))
    $('tm-remove').onclick = async () => {
      if (
        !(await confirmDialog(`${term.year} ${term.label} を消しますか？（授業・フォルダはありません）`, {
          ok: '消す',
          danger: true
        }))
      )
        return;
      const r = await api['term.remove']({termId: term.id});
      if (r.error) return toast(r.error, {error: true});
      editingId = undefined;
      toast('学期を消しました');
      reload();
    };
}
