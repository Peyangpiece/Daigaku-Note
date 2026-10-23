// ホーム（SPEC §8.1）：罫線ノートの上に、マスキングテープで貼った授業フォルダ。
import {esc, jaWrap, progressText} from '../app.js';
import {browserState} from './settings.js';
import {folderShown, scopeLabel} from './folder.js';
import {features} from '../../shared/profile.js';
import {LMS_TERMS_VERSION} from '../../shared/lms-terms.js';
import {folderLook, shapesOf, skinOf, stickerImg, stickerLayer} from '../skin.js';
import {classWeekday, termCalendar} from '../../shared/calendar.js';
import {addDays, weekdayOf} from '../../shared/holidays.js';

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

/**
 * 今日の授業（時限の順）と、今日がなければ次に授業のある日の授業。曜日の分からない授業は数えない。
 * cal（学期の学年暦：休講日・振替授業日）があれば、その日に行う授業の曜日で数える（休講日・祝日は授業なし、振替授業日はその曜日の授業）
 */
export function classDays(courses, now = new Date(), cal = null) {
  const today0 = now.toLocaleDateString('sv-SE'); // その場所の今日（YYYY-MM-DD）
  const wdOn = (i) => {
    const d = addDays(today0, i);
    return cal ? classWeekday(cal, d) : DAYS[weekdayOf(d)];
  };
  const on = (i) => {
    const wd = wdOn(i);
    return wd ? courses.filter((c) => c.weekday === wd).sort(byPeriod) : [];
  };
  const today = on(0);
  for (let i = 1; i <= 14 && !today.length; i++) {
    const list = on(i);
    if (list.length)
      return {today, next: {list, inDays: i, weekday: wdOn(i), dayOfWeek: DAYS[weekdayOf(addDays(today0, i))]}};
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
// 新着のバッジの色：授業の色（曜日ごとの色はやめた。色の体系を授業の色に寄せ、ホームと授業画面で同じ色が同じ授業を指すように）
export const badgeColor = (course) => `var(--c${course.color ?? 1})`;

/** フォルダごとに選んだ色（右クリック →「着せ替え…」）。タブ・フォルダ・マスキングテープ・新着の知らせ。選んでいなければ空 */
export const folderLookOf = (data, course) => data?.settings?.folderLooks?.[course.id] ?? {};
/** テンプレートの見た目に、フォルダごとに選んだ色を重ねる */
export function withFolderLook(sk, over) {
  if (!over.card && !over.tab && !over.tape) return sk;
  return {
    ...sk,
    folder: {card: over.card ?? sk.folder.card, tab: over.tab ?? sk.folder.tab},
    tape: {...sk.tape, color: over.tape ?? sk.tape.color}
  };
}

export function folderCard(course, {today = false, data = null, skin = null, edit = null} = {}) {
  const sub = course.kind === 'folder' ? scopeLabel(course) : course.weekday ? slotOf(course) : '';
  const name = jaWrap(course.name);
  // 着せ替えページの見本（skin・edit を渡す）では、フォルダごとの色は重ねない（テンプレートの見た目を見せる）
  const over = skin || edit ? {} : folderLookOf(data, course);
  const sk = skin ?? withFolderLook(skinOf(data, course), over);
  const look = folderLook(course, sk);
  const shapes = shapesOf(data);
  const stickers = sk.stickers.filter((s) => s.place === 'folder').map((s) => [s]); // 直している見本では s.index が直しているテンプレートの何枚目か
  const badges = [
    course.unread
      ? `<span class="badge" style="--badge-color: ${over.badge ?? badgeColor(course)}">新着 ${course.unread}</span>`
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

/** 復習の入口（常設）。今日の問題があれば強調、なければ次の予定を添える（間隔反復の仕組みが見える） */
function reviewButton(quiz) {
  if (!quiz) return '';
  if (quiz.reviewDue)
    return `<button class="btn btn--primary" data-action="nav" data-route="/review">今日の復習 ${quiz.reviewDue} 問</button>`;
  const next = quiz.reviewNext;
  const when = next
    ? `次は ${new Date(next.due).toLocaleDateString('ja-JP', {month: 'numeric', day: 'numeric'})} に ${next.count} 問`
    : '今日はありません';
  return `<button class="btn" data-action="nav" data-route="/review" title="復習は、解いた問題を忘れかけたころにもう一度出します">復習 <span class="muted">${when}</span></button>`;
}

export function renderHome({data, progress}) {
  const all = data.courses.filter((c) => !c.hidden && c.kind !== 'folder');
  // 今日の授業（なければ次の授業）を上の 1 行に。学期の学年暦（休講日・振替授業日）があればそれで数える
  const term = (data.terms ?? []).find((t) => t.id === data.currentTermId) ?? null;
  const cal = term ? termCalendar(term) : null;
  const {today, next} = classDays(all, new Date(), cal);
  const courses = weekOrder(all); // 月曜の 1 限から週の順。今日の授業には「今日」を付ける
  const todayIds = new Set(today.map((c) => c.id));
  const dayLine = today.length
    ? `<p class="home-day" id="today-label"><strong>今日の授業</strong> ${today.map((c) => `${esc(c.name)}（${c.period ? `${c.period}限` : '時限なし'}）`).join('・')}</p>`
    : next
      ? `<p class="home-day"><strong>次の授業</strong> ${next.inDays === 1 ? '明日' : `${esc(next.dayOfWeek)}曜`}${next.weekday !== next.dayOfWeek ? `（${esc(next.weekday)}曜日の授業の日）` : ''}　${next.list.map((c) => `${esc(c.name)}${c.period ? `（${c.period}限）` : ''}`).join('・')}</p>`
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
        ${data.settings.role === 'student' && data.settings.uses?.includes('lms') ? '<button class="btn" data-action="import-courses">＋ PC内の授業フォルダを取り込む</button>' : ''}
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
  // 規約の版が上がった（または v0.5.11 より前につないだ）ときは、同意し直すまで同期しない
  if (hasLms && data.settings.lmsTerms?.version !== LMS_TERMS_VERSION)
    attention.push(
      '<li>大学の LMS とつなぐ機能の利用規約に同意すると、同期を続けます。<button class="btn btn--small" data-action="nav" data-route="/settings/lms-terms">利用規約を読む</button></li>'
    );
  // LMS をつないでいる人には、学年暦（休講日・振替授業日）がまだない学期で案内する（「この学期は入れない」で消せる）
  if (
    hasLms &&
    term &&
    cal &&
    !cal.holidays.length &&
    !cal.swaps.length &&
    !(data.settings.calendarDismissed ?? []).includes(term.id)
  )
    attention.push(
      `<li>大学の学年暦（休講日・振替授業日）を入れると、回の日付と「今日の授業」が大学の予定どおりになります。<button class="btn btn--small" data-action="nav" data-route="/settings/term?calendar=1">学年暦を入れる</button> <button class="btn btn--small btn--quiet" data-action="calendar-dismiss" data-term-id="${esc(term.id)}">この学期は入れない</button></li>`
    );
  if (hasLms && data.browser?.state === 'failed')
    attention.push(
      `<li>LMS を読むためのブラウザの${browserState(data.browser)}<button class="btn btn--small" data-action="install-browser">準備し直す</button></li>`
    );
  const preparing = data.browser?.state === 'pending';
  // 使い方に合わせた並び：LMS を使わない人・社会人は自分のフォルダを先に
  const foldersFirst = features(data.settings).foldersFirst;
  const syncing = !!progress || (data.jobs ?? []).some((j) => j.kind === 'sync');
  return `
    ${stickerLayer(skinOf(data).stickers, 'home', data)}
    <div class="home${attention.length ? ' home--attention' : ''}">
      ${attention.length ? `<aside class="sticky attention" style="--sticky-color: var(--c2)" aria-labelledby="attention-title"><strong id="attention-title">要確認</strong><ul>${attention.join('')}</ul></aside>` : ''}
      <div class="home__main">
      ${foldersFirst ? myFolders : ''}
      ${
        courses.length
          ? `${dayLine}<section class="folders" aria-label="授業">${courses.map((c) => folderCard(c, {today: todayIds.has(c.id), data})).join('')}${hidden.length ? `<button class="folder folder--hidden" data-action="nav" data-route="/settings"><span class="tape"></span><span class="folder__name">非表示 ${hidden.length}</span><span class="folder__sub">設定で戻せます</span><span class="folder__badges"></span></button>` : ''}</section>`
          : hasLms
            ? `<div class="empty"><p>まだ授業がありません。同期すると、ここにフォルダが貼られます。</p><button class="btn btn--primary" data-action="sync" ${syncing ? 'disabled' : ''}>同期する</button></div>`
            : features(data.settings).lms
              ? `<div class="empty"><p>大学の LMS（manaba・Moodle など）とつなぐと、授業の資料が自動で集まり、ここに授業のフォルダが貼られます。</p><button class="btn btn--primary" data-action="nav" data-route="/settings/lms">大学の LMS とつなぐ</button></div>`
              : '' /* LMS を使わない人には授業の段を出さない（自分のフォルダだけ） */
      }
      ${foldersFirst ? '' : myFolders}
      </div>
    </div>
    <footer class="home-foot">
      ${reviewButton(data.quiz)}
      ${
        hasLms
          ? `<button class="btn" data-action="sync" ${syncing ? 'disabled' : ''}>${syncing ? '同期中…' : '同期'}</button>
      <span class="muted" id="sync-status" role="status">${preparing ? 'LMS を読むためのブラウザを準備しています（初回だけ。数分かかります）。終わると同期が始まります。' : status}</span>`
          : ''
      }
      <span style="margin-left:auto"></span>
      <button class="btn btn--quiet" data-action="nav" data-route="/kisekae">✿ 着せ替え</button>
      <button class="btn btn--quiet" data-action="nav" data-route="/fudebako">✎ 筆箱</button>
      <button class="btn" data-action="open-root">資料のフォルダ</button>
      <button class="btn" data-action="nav" data-route="/settings">⚙ 設定</button>
    </footer>`;
}
