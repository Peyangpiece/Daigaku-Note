// ホーム（SPEC §8.1）：罫線ノートの上に、マスキングテープで貼った授業フォルダ。
import {esc, jaWrap, progressText} from '../app.js';
import {browserState} from './settings.js';
import {folderShown, scopeLabel} from './folder.js';
import {folderLook, shapesOf, skinOf, stickerImg, stickerLayer} from '../skin.js';

// shared/ids.js の tapeAngle と同じ計算（レンダラは main のモジュールを読まないので写す）
function hash32(str) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(str)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const tapeAngle = (id) => (hash32(id) % 13) - 6;

const DAYS = '日月火水木金土';
const slotOf = (c) => `${c.weekday}曜${c.period ? ` ${c.period}限` : ''}`;
const byPeriod = (a, b) => (a.period ?? 99) - (b.period ?? 99);
/** 授業の並び：月曜の 1 限から週の順（月→日、同じ曜日は時限の若い順）。曜日の分からない授業は最後（もとの並びのまま） */
export function weekOrder(courses) {
  const day = (c) => (c.weekday && '月火水木金土日'.includes(c.weekday) ? '月火水木金土日'.indexOf(c.weekday) : 7);
  return courses
    .map((c, i) => [c, i])
    .sort(([a, i], [b, j]) => day(a) - day(b) || byPeriod(a, b) || i - j)
    .map(([c]) => c);
}

/** 今日の授業（時限の順）と、今日がなければ次に授業のある日の授業。曜日の分からない授業は数えない */
export function classDays(courses, now = new Date()) {
  const dow = now.getDay();
  const on = (d) => courses.filter((c) => c.weekday === DAYS[d]).sort(byPeriod);
  const today = on(dow);
  for (let i = 1; i <= 7 && !today.length; i++) {
    const list = on((dow + i) % 7);
    if (list.length) return {today, next: {list, inDays: i}};
  }
  return {today, next: null};
}

// 名前の中の、折り返せない一続き（<wbr> の間）が長いときは字を小さくして、「マーケティング／・リサーチ」のような変な切れ方をさせない
const longestRun = (html) => Math.max(...html.split('<wbr>').map((s) => [...s.replace(/&[a-z#0-9]+;/g, '_')].length));

/**
 * 授業フォルダのカード。見た目は着せ替え（SPEC-KISEKAE）のテンプレートから。
 * 着せ替えページの見本では skin（直している途中の見た目）を渡し、edit で貼ったシールを選べるようにする（ボタンにしない）。
 * edit.still は動かない見本（テンプレートの一覧）
 */
// 新着のバッジの色：授業の曜日ごと（曜日のない授業・自分のフォルダは授業の色）
const WEEKDAY_BADGE = {月: 'var(--c2)', 火: 'var(--c6)', 水: 'var(--c1)', 木: 'var(--c3)', 金: 'var(--c4)', 土: 'var(--c5)', 日: 'var(--c8)'};
export const badgeColor = (course) => WEEKDAY_BADGE[course.weekday] ?? `var(--c${course.color ?? 1})`;

export function folderCard(course, {today = false, data = null, skin = null, edit = null} = {}) {
  const sub = course.kind === 'folder' ? scopeLabel(course) : course.weekday ? slotOf(course) : '';
  const name = jaWrap(course.name);
  const sk = skin ?? skinOf(data, course);
  const look = folderLook(course, sk);
  const shapes = shapesOf(data);
  const stickers = sk.stickers.filter((s) => s.place === 'folder').map((s) => [s]); // 直している見本では s.index が直しているテンプレートの何枚目か
  const badges = [
    course.unread
      ? `<span class="badge" style="--badge-color: ${badgeColor(course)}">新着 ${course.unread}</span>`
      : '',
    course.review ? `<span class="badge">復習 ${course.review}</span>` : ''
  ].join('');
  const cls = `folder${course.hidden ? ' folder--hidden' : ''}${course.kind === 'folder' ? ' folder--mine' : ''}${today ? ' folder--today' : ''}${stickers.length ? ' folder--stickered' : ''}`;
  const live = edit && !edit.still;
  const inner = `<span class="tape tape--${esc(look.pattern)}"${live ? ' data-edit="tape" title="押すとマスキングテープを変えられます"' : ''} style="--tape-color: ${look.tapeColor}; --tape-angle: ${tapeAngle(course.id)}deg${look.tapeImage ? `; --tape-image: ${look.tapeImage}` : ''}"></span>
    ${stickers.length ? `<span class="folder__stickers"${edit ? '' : ' aria-hidden="true"'}>${stickers.map(([st]) => (edit?.render ? edit.render(st) : stickerImg(st, shapes, edit && !edit.still && st.index != null ? {index: st.index, selected: edit.selected === st.index} : {}))).join('')}</span>` : ''}
    <span class="folder__name ja-wrap${longestRun(name) > 6 ? ' folder__name--long' : ''}">${name}</span>
    <span class="folder__sub">${today ? '<span class="folder__today">今日</span> ' : ''}${esc(sub)}</span>
    <span class="folder__badges">${badges}</span>`;
  if (edit)
    return `<div class="${cls} folder--preview" style="${look.style}"${edit.still ? ' aria-hidden="true"' : ' data-drop-place="folder" data-edit="folder" title="押すとフォルダの色を変えられます。シールをここへドラッグすると貼れます"'}>${inner}</div>`;
  return `<button class="${cls}" style="${look.style}" data-action="open-course" data-id="${esc(course.id)}"${today ? ' aria-describedby="today-label"' : ''}>
    ${inner}
  </button>`;
}

export function renderHome({data, progress}) {
  const all = data.courses.filter((c) => !c.hidden && c.kind !== 'folder');
  // 今日の授業（なければ次の授業）を上の 1 行に
  const {today, next} = classDays(all);
  const courses = weekOrder(all); // 月曜の 1 限から週の順。今日の授業には「今日」を付ける
  const todayIds = new Set(today.map((c) => c.id));
  const dayLine = today.length
    ? `<p class="home-day" id="today-label"><strong>今日の授業</strong> ${today.map((c) => `${esc(c.name)}（${c.period ? `${c.period}限` : '時限なし'}）`).join('・')}</p>`
    : next
      ? `<p class="home-day"><strong>次の授業</strong> ${next.inDays === 1 ? '明日' : `${esc(next.list[0].weekday)}曜`}　${next.list.map((c) => `${esc(c.name)}${c.period ? `（${c.period}限）` : ''}`).join('・')}</p>`
      : '';
  const hidden = data.courses.filter((c) => c.hidden);
  // 自分のフォルダ：マイフォルダと今学期のフォルダ。前の学期のフォルダは畳んで下に
  const mine = data.courses.filter((c) => c.kind === 'folder' && !c.hidden);
  const shown = mine.filter((c) => folderShown(c, data.currentTermId));
  const past = mine.filter((c) => !folderShown(c, data.currentTermId));
  const myFolders = `<section class="my-folders" aria-labelledby="my-folders-title">
      <h2 class="my-folders__title" id="my-folders-title">自分のフォルダ</h2>
      ${shown.length ? `<div class="folders">${shown.map((c) => folderCard(c, {data})).join('')}</div>` : ''}
      <div class="actions">
        <button class="btn" data-action="nav" data-route="/folder-new?mode=new">＋ フォルダを作る</button>
        <button class="btn" data-action="nav" data-route="/folder-new?mode=link">＋ パソコンのフォルダを登録</button>
      </div>
      ${past.length ? `<details class="my-folders__past" id="my-folders-past"><summary>前の学期のフォルダ ${past.length}</summary><div class="folders">${past.map((c) => folderCard(c, {data})).join('')}</div></details>` : ''}
    </section>`;
  const last = data.lastSync;
  const status = progress
    ? esc(progressText(progress))
    : last
      ? `前回の同期 ${new Date(last.finished_at).toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}（授業 ${last.courses} 件・資料 ${last.materials} 件保存・失敗 ${last.failures} 件）`
      : 'まだ同期していません';
  const attention = data.connections
    .filter((c) => c.status === 'login-required')
    .map(
      (c) =>
        `<li>${esc(c.label)} へのログインが必要です。<button class="btn btn--small" data-action="login" data-id="${esc(c.id)}">ログイン窓を開く</button></li>`
    );
  // LMS の登録は任意。つないでいなければ、同期のボタンとブラウザの準備の知らせは出さない
  const hasLms = data.connections.some((c) => c.kind !== 'manual' && c.status !== 'disabled');
  if (hasLms && data.browser?.state === 'failed')
    attention.push(
      `<li>LMS を読むためのブラウザの${browserState(data.browser)}<button class="btn btn--small" data-action="install-browser">準備し直す</button></li>`
    );
  const preparing = data.browser?.state === 'pending';
  const syncing = !!progress || (data.jobs ?? []).some((j) => j.kind === 'sync');
  return `
    ${stickerLayer(skinOf(data).stickers, 'home', data)}
    <div class="home${attention.length ? ' home--attention' : ''}">
      ${attention.length ? `<aside class="sticky attention" style="--sticky-color: var(--c2)" aria-labelledby="attention-title"><strong id="attention-title">要確認</strong><ul>${attention.join('')}</ul></aside>` : ''}
      <div class="home__main">
      ${
        courses.length
          ? `${dayLine}<section class="folders" aria-label="授業">${courses.map((c) => folderCard(c, {today: todayIds.has(c.id), data})).join('')}${hidden.length ? `<button class="folder folder--hidden" data-action="nav" data-route="/settings"><span class="tape"></span><span class="folder__name">非表示 ${hidden.length}</span><span class="folder__sub">設定で戻せます</span><span class="folder__badges"></span></button>` : ''}</section>`
          : hasLms
            ? `<div class="empty"><p>まだ授業がありません。同期すると、ここにフォルダが貼られます。</p><button class="btn btn--primary" data-action="sync" ${syncing ? 'disabled' : ''}>同期する</button></div>`
            : '' /* LMS をつないでいなければ授業の段は出さない（つなぐのは 設定 → LMS との連携 から） */
      }
      ${myFolders}
      </div>
    </div>
    <footer class="home-foot">
      ${data.quiz?.reviewDue ? `<button class="btn btn--primary" data-action="nav" data-route="/review">今日の復習 ${data.quiz.reviewDue} 問</button>` : ''}
      ${
        hasLms
          ? `<button class="btn" data-action="sync" ${syncing ? 'disabled' : ''}>${syncing ? '同期中…' : '同期'}</button>
      <span class="muted" id="sync-status" role="status">${preparing ? 'LMS を読むためのブラウザを準備しています（初回だけ。数分かかります）。終わると同期が始まります。' : status}</span>`
          : ''
      }
      <span style="margin-left:auto"></span>
      <button class="btn" data-action="open-root">資料のフォルダ</button>
      <button class="btn" data-action="nav" data-route="/settings">⚙ 設定</button>
    </footer>`;
}
