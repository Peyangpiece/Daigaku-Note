// IPC の窓口：状態の読み込みとポイント（state.get・points.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {app} from 'electron';
import path from 'node:path';
import {CLASSIC_ID, templateIdOf} from '../../shared/skin.js';
import {defaultRoot} from '../../shared/paths.js';
import {currentTerm} from '../../shared/term.js';
import {PERIOD_PRESETS, todayJst} from '../../shared/schedule.js';
import {annoKey} from '../pdf-save.js';
import {stationeryState} from '../../shared/stationery.js';
import {claimLogin, pointsState} from '../../shared/points.js';
import {loginItem, reviewSummary} from './common.js';

/**
 * フォルダごとの色。前の版で選んだ色（どのテンプレートで選んだかの tid がない）は、今のテンプレートで選んだものとして印を付けて残す
 */
function folderLooks(repo, courses) {
  const looks = repo.getSetting('skin.folderLooks', {}) ?? {};
  const global = repo.getSetting('skin.global', CLASSIC_ID);
  let changed = false;
  for (const [cid, look] of Object.entries(looks)) {
    if (look?.tid) continue;
    const course = courses.find((c) => c.id === cid);
    if (!course) continue;
    looks[cid] = {...look, tid: templateIdOf(global, course)};
    changed = true;
  }
  if (changed) repo.setSetting('skin.folderLooks', looks);
  return looks;
}

export function register({handle, ctx, repo}) {
  // ログインボーナス：その日に初めて開いたときに 1 回だけ（shared/points.js）。画面が起動のあとに 1 回呼ぶ（state.get は読むだけ）
  handle('points.claimLogin', () => {
    const login = claimLogin(repo.getSetting('points', null));
    if (login.gained) repo.setSetting('points', login.points);
    return {gained: login.gained, points: pointsState(login.points)};
  });

  handle('state.get', async () => {
    const terms = repo.listTerms();
    const connections = repo.listConnections().map(({session_json: _session, ...c}) => c); // ログインの記録は渡さない
    // 授業ごとに引かず、全授業ぶんをまとめて引いて配る（授業が増えても問い合わせの数が増えない）
    const unread = repo.countUnreadAll();
    const courses = repo.listCourses().map((c) => ({...c, unread: unread[c.id] ?? 0}));
    const roundsAll = repo.listRoundsAll();
    const materialsAll = repo.listMaterialsAll();
    const quizzesAll = repo.listQuizzesAll();
    const rounds = Object.fromEntries(courses.map((c) => [c.id, roundsAll[c.id] ?? []]));
    // 自分のフォルダの資料は、フォルダの中のどの下のフォルダにあるか（sub）も渡す。パスそのものは渡さない
    const sub = (c, m) =>
      c.kind === 'folder' && c.dir ? path.relative(c.dir, path.dirname(m.path)).split(path.sep).join('/') : '';
    // しおりと文字隠しマーカーは注釈の鍵（上書き保存した PDF は元の中身の base_sha256）で数える
    const marks = repo.bookmarkCounts();
    const maskCounts = repo.maskCounts();
    const materials = Object.fromEntries(
      courses.map((c) => [
        c.id,
        (materialsAll[c.id] ?? []).map(({path: p, ...m}) => ({
          ...m,
          sub: sub(c, {path: p}),
          bookmarks: marks[annoKey(m)] ?? 0,
          masks: maskCounts[annoKey(m)] ?? 0
        }))
      ])
    );
    const today = todayJst();
    return {
      today, // 日本時間の今日（画面もこれを使う）
      connections,
      terms,
      currentTermId: currentTerm(terms, today)?.id ?? terms.at(-1)?.id ?? null,
      courses: courses.map(({dir, ...c}) => (c.kind === 'folder' ? {...c, dirName: path.basename(dir ?? '')} : c)),
      rounds,
      materials,
      settings: {
        root: ctx.rootDir(),
        defaultRoot: defaultRoot(app.getPath('desktop')),
        syncTime: repo.getSetting('sync.time', '16:30'),
        classStart: repo.getSetting('sync.classStart', true),
        everyHours: repo.getSetting('sync.everyHours', 0),
        theme: repo.getSetting('ui.theme', 'system'),
        rules: repo.getSetting('ui.rules', 'normal'),
        folderLooks: folderLooks(repo, courses), // フォルダごとの色 {授業の id: {tid, card, tab, tape, badge}}（右クリック →「着せ替え…」）
        ownColors: repo.getSetting('ui.ownColors', {}), // 授業ごとの「振り分け前」の付箋の色（5 色の何番目か）
        role: repo.getSetting('profile.role', null), // 使う人（profile.js の ROLES）。まだ選んでいなければ null
        uses: repo.getSetting('profile.uses', []), // 使い方（profile.js の USES の鍵）
        university: repo.getSetting('profile.university', ''),
        lmsTerms: repo.getSetting('lms.terms', null), // 大学サービスとの連携の利用規約に同意した版と日時
        aiConsent: repo.getSetting('quiz.consent', null), // AI に送るものへの同意（版と日時。shared/policy.js）
        experiments: repo.getSetting('experiments.makerPens', false), // 実験：既製品の見た目のペンをショップに出す（個人の試作）
        notifications: repo.getSetting('ui.notifications', true) !== false, // OS の通知（新しい資料・ログインの必要・クイズの完成・同期の失敗）
        calendarDismissed: repo.getSetting('calendar.dismissed', []), // ホームの「学年暦を入れる」案内を「この学期は入れない」にした学期の id
        openAtLogin: loginItem()
      },
      skin: {
        global: repo.getSetting('skin.global', CLASSIC_ID),
        templates: repo.listSkinTemplates(),
        stickers: repo.listStickers(),
        recent: repo.getSetting('skin.recentColors', []),
        introduced: repo.getSetting('skin.introduced', false)
      },
      stationery: stationeryState(repo.getSetting('stationery', null)), // 文房具：持ち物・筆箱の中身・ペンケース（shared/stationery.js）
      orders: repo.getSetting('stationery.orders', []), // ショップの注文の記録（新しい順。α 版はデモ決済）
      points: pointsState(repo.getSetting('points', null)), // アプリ内のポイント：残高・履歴（shared/points.js）
      lastSync: repo.lastSyncRun(),
      browser: ctx.browser ?? {state: 'pending', message: ''},
      status: ctx.status ?? '',
      jobs: repo.pendingJobs().map((j) => ({id: j.id, kind: j.kind, status: j.status})),
      presets: Object.keys(PERIOD_PRESETS),
      quizzes: Object.fromEntries(
        courses.map((c) => [
          c.id,
          (quizzesAll[c.id] ?? []).map(({source_json, course_id: _c, ...z}) => ({
            ...z,
            notes: JSON.parse(source_json ?? '{}').notes ?? []
          }))
        ])
      ),
      quiz: ctx.quiz ? {...ctx.quiz.status(), key: await ctx.quiz.keyInfo(), ...reviewSummary(ctx.quiz)} : null,
      dev: !app.isPackaged, // 開発中の起動（npm start）か。実験の区画など、配る版には出さないものの出し分けに使う
      version: app.getVersion(),
      dataDir: app.getPath('userData') // 設定の「情報」に出す（データの場所）
    };
  });
}
