// スマホのページ（docs/MOBILE.md §5）：ホーム・授業・資料（PDF）・復習・写真。中身はその場でパソコンに聞き、スマホには持たない
import {NotPaired, Unreachable, call, forget, hello, initPairing, paired} from './client.js';
import {esc, toast} from './ui.js';
import {openPdf} from './viewer.js';
import {openReview} from './review.js';
import {jstNow, todayJst} from '/m/shared/schedule.js';
import {classWeekday, termCalendar} from '/m/shared/calendar.js';
import {addDays, weekdayOf} from '/m/shared/holidays.js';

const app = document.getElementById('app');
const DAYS = '日月火水木金土';
const LAST_COURSE = 'daigaku-note.lastCourse';
let home = null; // 最後に読んだホームの中身
let leave = null; // 開いている画面の後片付け

const course = (id) => home?.courses.find((c) => c.id === id) ?? null;
const remember = (id) => {
  try {
    localStorage.setItem(LAST_COURSE, id);
  } catch {
    // 覚えられなくてもよい
  }
};

// ---- つながらないとき ----
function showProblem(e) {
  if (e instanceof NotPaired)
    app.innerHTML = `<div class="m-empty"><h2>パソコンとつながっていません</h2><p>パソコンの大学ノートで「設定 → スマホとつなぐ → スマホを追加」を押し、出てきた QR をこのスマホのカメラで読んでください。</p></div>`;
  else if (e instanceof Unreachable)
    app.innerHTML = `<div class="m-empty"><h2>パソコンに届きません</h2><p>パソコンの大学ノートが開いていて、「スマホとつなぐ」がオンで、パソコンとスマホが同じ Wi-Fi にあるか確かめてください。大学の Wi-Fi ではつながらないことがあります。</p><button class="m-btn m-btn--primary" data-retry>もう一度</button></div>`;
  else
    app.innerHTML = `<div class="m-empty"><h2>うまくいきませんでした</h2><p>${esc(e.message)}</p><button class="m-btn m-btn--primary" data-retry>もう一度</button></div>`;
  app.querySelector('[data-retry]')?.addEventListener('click', () => route());
}

// ---- 今日の授業（パソコンのホームと同じ数え方：学年暦があればそれで） ----
function todayCourses(data, now = new Date()) {
  const term = (data.terms ?? []).find((t) => t.id === data.currentTermId) ?? null;
  const cal = term ? termCalendar(term) : null;
  const day = todayJst(now);
  const wd = cal ? classWeekday(cal, day) : DAYS[weekdayOf(day)];
  const list = wd ? data.courses.filter((c) => c.kind !== 'folder' && c.weekday === wd) : [];
  return list.sort((a, b) => (a.period ?? 99) - (b.period ?? 99));
}

/** いまの時限の授業（始まって 110 分まで）。なければ今日このあとの授業。なければ null */
function currentCourse(data, now = new Date()) {
  const term = (data.terms ?? []).find((t) => t.id === data.currentTermId) ?? null;
  let periods = {};
  try {
    periods = JSON.parse(term?.periods_json ?? '{}') ?? {};
  } catch {
    periods = {};
  }
  const {hm} = jstNow(now);
  const min = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const today = todayCourses(data, now).filter((c) => periods[c.period]);
  return (
    today.find((c) => min(hm) >= min(periods[c.period]) && min(hm) < min(periods[c.period]) + 110) ??
    today.find((c) => min(periods[c.period]) > min(hm)) ??
    null
  );
}

/** 写真を送る回：今日の回、なければ今日より前でいちばん新しい回、なければ最後の回 */
function roundFor(data, courseId, now = new Date()) {
  const rounds = (data.rounds[courseId] ?? []).slice().sort((a, b) => a.number - b.number);
  const day = todayJst(now);
  return (
    rounds.find((r) => r.date === day) ?? rounds.filter((r) => r.date && r.date <= day).at(-1) ?? rounds.at(-1) ?? null
  );
}

const roundLabel = (r) => `第${r.number}回${r.title_user || r.title ? ` ${r.title_user || r.title}` : ''}`;
const isPdf = (m) => /\.pdf$/i.test(m.name);
const nextDay = (data, now = new Date()) => {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(todayJst(now), i);
    const wd = DAYS[weekdayOf(d)];
    if (data.courses.some((c) => c.weekday === wd)) return `${i === 1 ? '明日' : `${i} 日後`}（${wd}）`;
  }
  return '';
};

// ---- 画面 ----
async function renderHome() {
  home = await call('home');
  const today = todayCourses(home);
  const recent = Object.entries(home.materials)
    .flatMap(([cid, list]) => list.map((m) => ({...m, courseId: cid})))
    .sort((a, b) => String(b.downloadedAt ?? '').localeCompare(String(a.downloadedAt ?? '')))
    .slice(0, 20);
  const courseBtn = (c) =>
    `<li><a class="m-item" href="#/course/${esc(c.id)}"><span class="m-dot" style="--c: var(--c${c.color ?? 1})"></span>${esc(c.name)}<span class="m-sub">${c.weekday ? `${esc(c.weekday)}${c.period ? ` ${c.period}限` : ''}` : ''}</span></a></li>`;
  app.innerHTML = `
    <header class="m-head"><h1>大学ノート</h1><a class="m-btn" href="#/photo">📷 写真</a></header>
    <a class="m-card m-review${home.reviewDue ? ' is-due' : ''}" href="#/review"><strong>今日の復習</strong><span>${home.reviewDue ? `${home.reviewDue} 問` : 'ありません'}</span></a>
    <section class="m-card"><h2>今日の授業</h2>${today.length ? `<ul class="m-list">${today.map(courseBtn).join('')}</ul>` : `<p class="m-muted">今日の授業はありません。${esc(nextDay(home))}</p>`}</section>
    <section class="m-card"><h2>最近の資料</h2>${
      recent.length
        ? `<ul class="m-list">${recent
            .map((m) => {
              const c = course(m.courseId);
              return `<li>${isPdf(m) ? `<a class="m-item" href="#/pdf/${esc(m.id)}">` : '<span class="m-item m-item--off">'}${esc(m.name)}<span class="m-sub">${esc(c?.name ?? '')}</span>${isPdf(m) ? '</a>' : '</span>'}</li>`;
            })
            .join('')}</ul>`
        : '<p class="m-muted">まだ資料がありません。</p>'
    }</section>
    <section class="m-card"><h2>授業の一覧</h2><ul class="m-list">${home.courses.map(courseBtn).join('')}</ul></section>`;
}

async function renderCourse(id) {
  home ??= await call('home');
  const c = course(id);
  if (!c)
    return void (app.innerHTML =
      '<div class="m-empty"><p>この授業は見つかりませんでした。</p><a class="m-btn" href="#/">ホームへ</a></div>');
  remember(id);
  const mats = home.materials[id] ?? [];
  const rounds = (home.rounds[id] ?? []).slice().sort((a, b) => b.number - a.number);
  const item = (m) =>
    `<li>${isPdf(m) ? `<a class="m-item" href="#/pdf/${esc(m.id)}">` : '<span class="m-item m-item--off" title="PDF だけ開けます">'}${esc(m.name)}${isPdf(m) ? '</a>' : '</span>'}</li>`;
  const blocks = rounds
    .map((r) => {
      const list = mats.filter((m) => m.roundId === r.id);
      return `<section class="m-card"><h2>${esc(roundLabel(r))}${r.date ? `<span class="m-sub">${esc(r.date.slice(5).replace('-', '/'))}</span>` : ''}</h2>${list.length ? `<ul class="m-list">${list.map(item).join('')}</ul>` : '<p class="m-muted">資料はありません。</p>'}<a class="m-btn m-btn--small" href="#/photo?course=${esc(id)}&round=${esc(r.id)}">📷 この回に写真を送る</a></section>`;
    })
    .join('');
  const loose = mats.filter((m) => !m.roundId || !rounds.some((r) => r.id === m.roundId));
  app.innerHTML = `
    <header class="m-head"><a class="m-btn" href="#/">← ホーム</a><h1>${esc(c.name)}</h1></header>
    ${blocks}
    ${loose.length ? `<section class="m-card"><h2>回の決まっていない資料</h2><ul class="m-list">${loose.map(item).join('')}</ul></section>` : ''}
    ${!rounds.length && !loose.length ? '<p class="m-empty">まだ資料がありません。</p>' : ''}`;
}

// ---- 写真（docs/MOBILE.md §5）：いまの時限の授業と今日の回を初めから選んでおく ----
async function renderPhoto(params) {
  home ??= await call('home');
  const now = new Date();
  let last = null;
  try {
    last = localStorage.getItem(LAST_COURSE);
  } catch {
    last = null;
  }
  const courses = home.courses;
  const pick =
    course(params.get('course'))?.id ?? currentCourse(home, now)?.id ?? course(last)?.id ?? courses[0]?.id ?? null;
  if (!pick)
    return void (app.innerHTML =
      '<div class="m-empty"><p>授業がまだありません。</p><a class="m-btn" href="#/">ホームへ</a></div>');
  const roundOptions = (cid, chosen) => {
    const rounds = (home.rounds[cid] ?? []).slice().sort((a, b) => a.number - b.number);
    const def = chosen ?? roundFor(home, cid, now)?.id ?? '';
    return `<option value="">回を決めない</option>${rounds.map((r) => `<option value="${esc(r.id)}" ${r.id === def ? 'selected' : ''}>${esc(roundLabel(r))}</option>`).join('')}`;
  };
  app.innerHTML = `
    <header class="m-head"><a class="m-btn" href="#/">← ホーム</a><h1>写真を送る</h1></header>
    <section class="m-card">
      <label class="m-field">授業<select data-v="course">${courses.map((c) => `<option value="${esc(c.id)}" ${c.id === pick ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="m-field">回<select data-v="round">${roundOptions(pick, params.get('round'))}</select></label>
      <div class="m-row">
        <label class="m-btn m-btn--primary m-btn--wide">📷 撮る<input type="file" accept="image/*" capture="environment" data-v="shoot" hidden></label>
        <label class="m-btn m-btn--wide">写真を選ぶ<input type="file" accept="image/*" multiple data-v="pickfile" hidden></label>
      </div>
      <p class="m-muted" data-v="status">送った写真は、パソコンの授業の回のフォルダに入ります。</p>
    </section>`;
  const sel = app.querySelector('[data-v="course"]');
  const rsel = app.querySelector('[data-v="round"]');
  sel.onchange = () => (rsel.innerHTML = roundOptions(sel.value, null));
  const status = app.querySelector('[data-v="status"]');
  const upload = async (files) => {
    const list = [...files].slice(0, 20);
    if (!list.length) return;
    let done = 0;
    for (const f of list) {
      status.textContent = `送っています… ${done + 1} / ${list.length}`;
      try {
        if (f.size > 30 * 1024 * 1024) throw new Error(`${f.name} は大きすぎます（30MB まで）`);
        const data = new Uint8Array(await f.arrayBuffer());
        await call('photo.upload', {courseId: sel.value, roundId: rsel.value || null, files: [{data}]});
        done++;
      } catch (e) {
        toast(e.message, {error: true});
      }
    }
    status.textContent = `${done} 枚を送りました。続けて撮れます。`;
    if (done) toast(`${done} 枚をパソコンへ送りました`);
    remember(sel.value);
    home = null; // 資料の一覧が変わった
  };
  app.querySelector('[data-v="shoot"]').onchange = (e) => upload(e.target.files).finally(() => (e.target.value = ''));
  app.querySelector('[data-v="pickfile"]').onchange = (e) =>
    upload(e.target.files).finally(() => (e.target.value = ''));
}

// ---- 道案内 ----
async function route() {
  leave?.();
  leave = null;
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  const params = new URLSearchParams(query);
  window.scrollTo(0, 0);
  try {
    if (path.startsWith('/course/')) await renderCourse(path.slice(8));
    else if (path.startsWith('/pdf/')) leave = await openPdf(app, path.slice(5), {back: () => history.back()});
    else if (path === '/review') leave = await openReview(app);
    else if (path === '/photo') await renderPhoto(params);
    else await renderHome();
  } catch (e) {
    showProblem(e);
  }
}

async function start() {
  const how = initPairing();
  if (how === 'none') return showProblem(new NotPaired());
  try {
    if (!paired()) {
      await hello();
      toast('パソコンとつながりました');
    }
  } catch (e) {
    if (e instanceof NotPaired) forget();
    return showProblem(e);
  }
  window.addEventListener('hashchange', route);
  route();
}

start();
