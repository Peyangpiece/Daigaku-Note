// ホーム（SPEC §8.1）：罫線ノートの上に、マスキングテープで貼った授業フォルダ。
import {todayJst} from '../../shared/schedule.js';
import {esc, jaWrap, progressText} from '../ui-kit.js';
import {tapeAngle} from '../../shared/hash.js';
import {browserState} from './settings.js';
import {folderShown, scopeLabel} from './folder.js';
import {features} from '../../shared/profile.js';
import {LMS_TERMS_VERSION} from '../../shared/lms-terms.js';
import {folderLook, globalId, shapesOf, skinOf, stickerImg, stickerLayer} from '../skin.js';
import {folderLookFor} from '../../shared/skin.js';
import {classWeekday, termCalendar} from '../../shared/calendar.js';
import {addDays, weekdayOf} from '../../shared/holidays.js';
import {applyOrder} from '../../shared/arrange.js';

const DAYS = '日月火水木金土';
const slotOf = (c) => `${c.weekday}曜${c.period ? ` ${c.period}限` : ''}`;
const byPeriod = (a, b) => (a.period ?? 99) - (b.period ?? 99);
/** 授業の並び：月曜の 1 限から週の順（月→日、同じ曜日は時限の若い順）。曜日の分からない授業は最後（もとの並びのまま） */
function weekOrder(courses) {
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
function classDays(courses, now = new Date(), cal = null) {
  const today0 = todayJst(now); // 日本時間の今日（YYYY-MM-DD。main と同じ）
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
// 新着のバッジの色：フォルダごとに選んだ色 → タブの色（v0.17.9）→ 授業の色（タブに色のない着せ替えのとき）
const badgeColor = (course) => `var(--c${course.color ?? 1})`;

/**
 * フォルダごとに選んだ色（右クリック →「着せ替え…」）。タブ・フォルダ・マスキングテープ・新着の知らせ。選んでいなければ空。
 * 選んだときと同じテンプレートのときだけ（ほかのテンプレートに替えたら持ち越さない）
 */
export const folderLookOf = (data, course) => folderLookFor(data?.settings?.folderLooks, globalId(data), course);
/** テンプレートの見た目に、フォルダごとに選んだ色を重ねる */
function withFolderLook(sk, over) {
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
      ? `<span class="badge" style="--badge-color: ${over.badge ?? look.tab ?? badgeColor(course)}">新着 ${course.unread}</span>`
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
  // 右上の「…」：右クリックと同じメニュー（名前を変える・着せ替え・ホームから外す）。右クリックに気づかなくても使えるように
  return `<div class="folder-slot" data-sort-key="${esc(course.id)}"><button class="${cls}" style="${look.style}" data-action="open-course" data-id="${esc(course.id)}"${today ? ' aria-describedby="today-label"' : ''}>
    ${inner}
  </button><button type="button" class="folder__more" data-action="card-menu" data-id="${esc(course.id)}" aria-label="${esc(course.name)} のメニュー" title="メニュー（右クリックでも出ます）" aria-haspopup="menu">⋯</button></div>`;
}

/** 今日の復習の入口：問題があるときだけ、授業の上に出す（上のボタンの数だけでは気づきにくいため） */
function reviewEntry(data) {
  const due = data.quiz?.reviewDue ?? 0;
  if (!due) return '';
  return `<button type="button" class="home-review" data-action="nav" data-route="/review">
      <span class="home-review__mark" aria-hidden="true">✓</span>
      <span class="home-review__text"><strong>今日の復習 ${due} 問</strong></span>
      <span class="home-review__go">始める →</span>
    </button>`;
}

/** 同期：ボタンと前回の結果（失敗があれば押すと中身が出る）。上の行の右に置く */
function syncBox(data, progress, syncing) {
  const last = data.lastSync;
  const preparing = data.browser?.state === 'pending';
  const time = last ? new Date(last.finished_at).toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) : '';
  const status = preparing
    ? 'LMS を読む準備をしています（初回だけ数分）'
    : progress
      ? progressText(progress)
      : last
        ? `前回の同期 ${time}（資料 ${last.materials} 件）`
        : 'まだ同期していません';
  const errors = !progress && last?.failures ? (last.errors ?? []) : [];
  const fail = errors.length
    ? `<details class="home-sync__fail"><summary>失敗 ${last.failures} 件</summary><ul>${errors
        .map((e) => `<li>${e.course ? `<strong>${esc(e.course)}</strong>：` : ''}${esc(e.message)}</li>`)
        .join('')}</ul></details>`
    : '';
  return `<div class="home-sync">
      <span class="muted home-sync__status" id="sync-status" role="status">${esc(status)}</span>${fail}${last && !progress ? '<button type="button" class="link home-sync__log" data-action="nav" data-route="/settings?tab=lms&amp;show=history">記録</button>' : ''}
      <button class="btn btn--small" data-action="sync" ${syncing ? 'disabled' : ''}>${syncing ? '同期中…' : '同期'}</button>
    </div>`;
}

/** 振り分け待ちの授業の候補：今学期の授業と、いま出している自分のフォルダ */
export function importTargets(data) {
  return data.courses.filter(
    (c) => !c.hidden && (c.kind === 'folder' ? folderShown(c, data.currentTermId) : c.term_id === data.currentTermId)
  );
}

/** 回の選択肢（授業ごと）。自分のフォルダには回がない */
export function importRoundOptions(data, courseId, selected = null) {
  const course = data.courses.find((c) => c.id === courseId);
  if (!course || course.kind === 'folder') return '';
  const rounds = (data.rounds ?? [])
    .filter((r) => r.course_id === courseId)
    .sort((a, b) => (a.number || 999) - (b.number || 999));
  const name = (r) =>
    r.user_made
      ? `付箋「${r.title_user || r.number}」`
      : r.number
        ? `第${r.number}回${r.title ? ` ${r.title}` : ''}`
        : 'その他';
  return `<option value="">回を選ばない（振り分け前）</option>${rounds
    .map((r) => `<option value="${esc(r.id)}" ${r.id === selected ? 'selected' : ''}>${esc(name(r))}</option>`)
    .join('')}`;
}

// 授業資料の自動取り込みの振り分け待ち（import-watch.js）：授業と回を選んで「入れる」。推定できたものは選んである
function importsPanel(data) {
  const items = data.imports ?? [];
  if (!items.length) return '';
  const targets = importTargets(data);
  const from = (p) =>
    p.from === 'folder'
      ? '取り込みフォルダから'
      : p.team
        ? `Teams「${esc(p.team.site)}」から`
        : p.source === 'university'
          ? `大学のサイト（${esc(p.host)}）から`
          : p.source === 'teams'
            ? `Teams${p.host ? `（${esc(p.host)}）` : ''}から`
            : 'ダウンロード元が分からないファイル';
  const row = (p) => `<li class="imports__item" data-import-id="${esc(p.id)}">
      <div class="imports__name"><strong>${esc(p.name)}</strong> <span class="muted">${from(p)}</span></div>
      <div class="imports__pick">
        <select class="input" data-import-course aria-label="入れる授業">${
          p.team
            ? `<option value="new" ${p.courseId ? '' : 'selected'}>新しい授業を作る</option>`
            : '<option value="">授業を選ぶ</option>'
        }${targets
          .map((c) => `<option value="${esc(c.id)}" ${c.id === p.courseId ? 'selected' : ''}>${esc(c.name)}</option>`)
          .join('')}</select>
        ${p.team ? `<input class="input" data-import-newname aria-label="新しい授業の名前" maxlength="80" value="${esc(p.team.name)}" ${p.courseId ? 'hidden' : ''}>` : ''}
        <select class="input" data-import-round aria-label="入れる回" ${p.courseId && data.courses.find((c) => c.id === p.courseId)?.kind !== 'folder' ? '' : 'hidden'}>${importRoundOptions(data, p.courseId, p.roundId)}</select>
        <button class="btn btn--small btn--primary" data-import-accept>入れる</button>
        <button class="btn btn--small btn--quiet" data-import-dismiss>取り込まない</button>
      </div>
      ${
        p.team
          ? `<label class="imports__remember"><input type="checkbox" data-import-remember checked> 次から「${esc(p.team.site)}」の資料はこの授業に自動で入れる</label>`
          : p.source === 'teams' && p.host
            ? `<label class="imports__remember"><input type="checkbox" data-import-remember checked> 次から ${esc(p.host)} の資料を大学の資料にする</label>`
            : ''
      }
    </li>`;
  return `<section class="imports card" aria-labelledby="imports-title"><h2 class="home-sec" id="imports-title">振り分け待ち ${items.length}</h2>
    <ul class="imports__list">${items.map(row).join('')}</ul></section>`;
}

export function renderHome({data, progress}) {
  const all = data.courses.filter((c) => !c.hidden && c.kind !== 'folder');
  // 今日の授業（なければ次の授業）を上の 1 行に。学期の学年暦（休講日・振替授業日）があればそれで数える
  const term = (data.terms ?? []).find((t) => t.id === data.currentTermId) ?? null;
  const cal = term ? termCalendar(term) : null;
  const {today, next} = classDays(all, new Date(), cal);
  // 月曜の 1 限から週の順。今日の授業には「今日」を付ける。右クリック →「並べ替え」で並べた並びがあればそれに合わせる（新しい授業は後ろ）
  const order = data.settings?.order ?? {};
  const courses = applyOrder(weekOrder(all), (c) => c.id, order['home:classes']);
  const todayIds = new Set(today.map((c) => c.id));
  const dayLine = today.length
    ? `<p class="home-day" id="today-label"><strong>今日の授業</strong> ${today.map((c) => `${esc(c.name)}（${c.period ? `${c.period}限` : '時限なし'}）`).join('・')}</p>`
    : next
      ? `<p class="home-day"><strong>次の授業</strong> ${next.inDays === 1 ? '明日' : `${esc(next.dayOfWeek)}曜`}${next.weekday !== next.dayOfWeek ? `（${esc(next.weekday)}曜日の授業の日）` : ''}　${next.list.map((c) => `${esc(c.name)}${c.period ? `（${c.period}限）` : ''}`).join('・')}</p>`
      : '';
  const hidden = data.courses.filter((c) => c.hidden);
  // 自分のフォルダ：マイフォルダと今学期のフォルダ。前の学期のフォルダは畳んで下に。
  // 足すのは並びの最後の「＋ フォルダを追加」のカードから（作る・パソコンのフォルダを登録を選ぶ）
  const mine = data.courses.filter((c) => c.kind === 'folder' && !c.hidden);
  // まだ何もない（フォルダも授業もない）：最初の一歩を言葉で案内する
  const starter =
    !mine.length && !all.length
      ? '<p class="home-start">まず「＋ フォルダを追加」でフォルダを作り、開いた画面に PDF をドラッグすると入ります。PDF に書き込んだり、資料からクイズを作ったりできます。</p>'
      : '';
  const shown = applyOrder(
    mine.filter((c) => folderShown(c, data.currentTermId)),
    (c) => c.id,
    order['home:folders']
  );
  const past = mine.filter((c) => !folderShown(c, data.currentTermId));
  const addCard = `<button type="button" class="folder folder--add" data-action="folder-add" aria-haspopup="menu"><span class="folder__add-plus" aria-hidden="true">＋</span><span class="folder__name">フォルダを追加</span></button>`;
  const myFolders = `<section class="my-folders" aria-labelledby="my-folders-title">
      <h2 class="home-sec" id="my-folders-title">自分のフォルダ</h2>
      ${starter}
      <div class="folders" data-sort-scope="home:folders">${shown.map((c) => folderCard(c, {data})).join('')}${addCard}</div>
      ${past.length ? `<details class="my-folders__past" id="my-folders-past"><summary>前の学期のフォルダ ${past.length}</summary><div class="folders">${past.map((c) => folderCard(c, {data})).join('')}</div></details>` : ''}
    </section>`;
  // 要確認：すぐ手当てが要るものだけ（ログイン・規約・ブラウザ）。急がないお勧め（学年暦）は 1 行の知らせにする
  const attention = data.connections
    .filter((c) => c.status === 'login-required')
    .map((c) =>
      // 自動ログインがオンなのに保存した ID・パスワードを読めないときは、窓でのログインより入れ直しを先に案内する（v0.18.10）
      c.password_unreadable
        ? `<li>${esc(c.label)} の自動ログインに使う ID とパスワードを読めません。入れ直してください。<button class="btn btn--small" data-action="nav" data-route="/settings?tab=lms">入れ直す</button></li>`
        : `<li>${esc(c.label)} へのログインが必要です。<button class="btn btn--small" data-action="login" data-id="${esc(c.id)}">ログイン</button></li>`
    );
  // LMS の登録は任意。つないでいなければ、同期のボタンとブラウザの準備の知らせは出さない
  const hasLms = data.connections.some((c) => c.kind !== 'manual' && c.status !== 'disabled');
  // 規約の版が上がった（または v0.5.11 より前につないだ）ときは、同意し直すまで同期しない
  if (hasLms && data.settings.lmsTerms?.version !== LMS_TERMS_VERSION)
    attention.push(
      '<li>大学の LMS とつなぐ機能の利用規約に同意すると、同期を続けます。<button class="btn btn--small" data-action="nav" data-route="/settings/lms-terms">利用規約を読む</button></li>'
    );
  if (hasLms && data.browser?.state === 'failed')
    attention.push(
      `<li>LMS を読むためのブラウザの${browserState(data.browser)}<button class="btn btn--small" data-action="install-browser">準備し直す</button></li>`
    );
  // LMS をつないでいる人には、学年暦（休講日・振替授業日）がまだない学期で案内する（「この学期は入れない」で消せる）
  const tip =
    hasLms &&
    term &&
    cal &&
    !cal.holidays.length &&
    !cal.swaps.length &&
    !(data.settings.calendarDismissed ?? []).includes(term.id)
      ? `<p class="home-tip"><span class="muted">学年暦を入れると、休講日と振替授業日が予定に反映されます。</span><span class="home-tip__acts"><button class="btn btn--small" data-action="nav" data-route="/settings/term?calendar=1">入れる</button><button class="btn btn--small btn--quiet" data-action="calendar-dismiss" data-term-id="${esc(term.id)}">今学期は入れない</button></span></p>`
      : '';
  // 使い方に合わせた並び：LMS を使わない人・社会人は自分のフォルダを先に。LMS をまだつないでいない人も、
  // まず自分のフォルダから始められるように先に出す（LMS とつなぐ案内は、その下に小さく）
  const foldersFirst = features(data.settings).foldersFirst || !hasLms;
  const syncing = !!progress || (data.jobs ?? []).some((j) => j.kind === 'sync');
  // 上の行：今日の授業（なければ次の授業）と、同期
  const top =
    dayLine || hasLms
      ? `<div class="home-top">${dayLine || '<span></span>'}${hasLms ? syncBox(data, progress, syncing) : ''}</div>`
      : '';
  const classes = courses.length
    ? `<section aria-labelledby="classes-title"><h2 class="home-sec" id="classes-title">授業</h2><div class="folders" data-sort-scope="home:classes">${courses.map((c) => folderCard(c, {today: todayIds.has(c.id), data})).join('')}${hidden.length ? `<button class="folder folder--hidden" data-action="nav" data-route="/settings?tab=basic"><span class="tape"></span><span class="folder__name">非表示 ${hidden.length}</span><span class="folder__badges"></span></button>` : ''}</div></section>`
    : hasLms
      ? `<div class="empty"><p>まだ授業がありません</p><button class="btn btn--primary" data-action="sync" ${syncing ? 'disabled' : ''}>同期する</button></div>`
      : features(data.settings).lms
        ? `<p class="home-tip home-lms-tip"><span class="muted">manabo とつなぐと、授業の資料が自動で集まり、授業のフォルダが貼られます（つながなくても使えます）。</span><span class="home-tip__acts"><button class="btn btn--small" data-action="nav" data-route="/settings/lms">manabo とつなぐ</button></span></p>`
        : ''; /* manabo を使わない人には授業の段を出さない（自分のフォルダだけ。授業資料はダウンロードから取り込む） */
  // さがす：資料が 1 つでもあれば出す（資料の名前・本文・書き込み・回のメモを、授業をまたいで探す。views/search.js）
  const anyMaterial = Object.values(data.materials ?? {}).some((list) => list.length);
  const searchBar = anyMaterial
    ? `<form class="home-search" role="search" data-search-form="home"><input class="input home-search__input" type="search" name="q" maxlength="200" autocomplete="off" placeholder="資料をさがす（名前・本文・書き込み）" aria-label="資料をさがす"><button type="submit" class="btn btn--small">さがす</button></form>`
    : '';
  return `
    ${stickerLayer(skinOf(data).stickers, 'home', data)}
    <div class="home${attention.length ? ' home--attention' : ''}">
      ${attention.length ? `<aside class="sticky attention" style="--sticky-color: var(--c2)" aria-labelledby="attention-title"><strong id="attention-title">要確認</strong><ul>${attention.join('')}</ul></aside>` : ''}
      <div class="home__main">
      ${searchBar}
      ${top}
      ${importsPanel(data)}
      ${reviewEntry(data)}
      ${tip}
      ${foldersFirst ? myFolders : ''}
      ${classes}
      ${foldersFirst ? '' : myFolders}
      </div>
    </div>`;
}
