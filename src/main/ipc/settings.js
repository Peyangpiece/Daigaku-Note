// IPC の窓口：設定・ブラウザ・外部（settings.*・browser.install・shell.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {dialog, shell, app} from 'electron';
import {CLASSIC_ID, isHex, lookByTemplate, templateIdOf} from '../../shared/skin.js';
import {checkDownloadDir} from '../../shared/paths.js';
import {cleanUses, isRole} from '../../shared/profile.js';
import {LMS_TERMS_VERSION} from '../../shared/lms-terms.js';
import {id, httpsUrl, loginItem, FOLDER_LOOK_PARTS, bad} from './common.js';

export function register({handle, ctx, repo}) {
  handle('settings.pickDownloadDir', async () => {
    const r = await dialog.showOpenDialog({
      title: '資料の保存先のフォルダ',
      defaultPath: ctx.rootDir(),
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled) return {dir: null};
    const dir = checkDownloadDir(r.filePaths[0], app.getPath('home'));
    repo.setSetting('storage.root', dir);
    return {dir};
  });

  handle('settings.update', ({patch}) => {
    if (typeof patch.syncTime === 'string' && /^\d{2}:\d{2}$/.test(patch.syncTime))
      repo.setSetting('sync.time', patch.syncTime);
    if (typeof patch.classStart === 'boolean') repo.setSetting('sync.classStart', patch.classStart);
    if ([0, 1, 3, 6].includes(patch.everyHours)) repo.setSetting('sync.everyHours', patch.everyHours);
    if (['system', 'light', 'dark'].includes(patch.theme)) repo.setSetting('ui.theme', patch.theme);
    if (['normal', 'light', 'none'].includes(patch.rules)) repo.setSetting('ui.rules', patch.rules);
    if (typeof patch.experiments === 'boolean') repo.setSetting('experiments.makerPens', patch.experiments);
    if (typeof patch.notifications === 'boolean') repo.setSetting('ui.notifications', patch.notifications);
    if (typeof patch.calendarDismiss === 'string' && /^[\w-]{1,40}$/.test(patch.calendarDismiss))
      repo.setSetting('calendar.dismissed', [
        ...new Set([...repo.getSetting('calendar.dismissed', []), patch.calendarDismiss])
      ]);
    // 使う人・使い方・大学名（大学名はいまは記録するだけ）。人を変えたら、その人の使い方に合わないものは外す
    if (isRole(patch.role)) {
      repo.setSetting('profile.role', patch.role);
      repo.setSetting('profile.uses', cleanUses(patch.role, patch.uses ?? repo.getSetting('profile.uses', [])));
    } else if (patch.uses !== undefined)
      repo.setSetting('profile.uses', cleanUses(repo.getSetting('profile.role', null), patch.uses));
    if (patch.acceptLmsTerms === LMS_TERMS_VERSION)
      repo.setSetting('lms.terms', {version: LMS_TERMS_VERSION, at: new Date().toISOString()});
    if (typeof patch.university === 'string')
      repo.setSetting('profile.university', patch.university.trim().slice(0, 60));
    // フォルダごとの色（タブ・フォルダ・マスキングテープ・新着の知らせ）。color が null ならその色を元に戻す。reset ですべて元に戻す
    if (patch.folderLook && typeof patch.folderLook === 'object') {
      const {courseId: fcid, part, color: c, reset} = patch.folderLook;
      const cid = id(fcid) ?? bad('このフォルダは見つかりませんでした');
      repo.get('course', cid) ?? bad('このフォルダは見つかりませんでした');
      const map = {...repo.getSetting('skin.folderLooks', {})};
      // 色は今のテンプレートで選んだものとして、テンプレートごとに覚える（ほかのテンプレートで選んだ色は残す）
      const tid = templateIdOf(repo.getSetting('skin.global', CLASSIC_ID));
      const by = {...lookByTemplate(map[cid], tid)};
      const look = {...(by[tid] ?? {})};
      if (reset === true) Object.keys(look).forEach((k) => delete look[k]);
      else {
        if (!FOLDER_LOOK_PARTS.includes(part)) bad('変える場所が不正です');
        if (c === null) delete look[part];
        else if (isHex(c)) look[part] = c.toLowerCase();
        else bad('色が不正です');
      }
      if (Object.keys(look).length) by[tid] = look;
      else delete by[tid];
      if (Object.keys(by).length) map[cid] = {byTemplate: by};
      else delete map[cid];
      repo.setSetting('skin.folderLooks', map);
    }
    if (patch.resetRoot === true) repo.setSetting('storage.root', null);
    if (patch.skipSetup === true) repo.setSetting('setup.skipped', true); // 初回のセットアップを終えた（次から起動時に出さない。LMS は任意で、設定からつなぐ）
    if (typeof patch.openAtLogin === 'boolean') {
      if (!loginItem().available) bad('ログイン時の起動は、アプリとして入れた大学ノートでだけ設定できます');
      app.setLoginItemSettings({openAtLogin: patch.openAtLogin});
    }
    return {ok: true};
  });

  handle('browser.install', async () => {
    if (ctx.browser?.state === 'pending') return {ok: true, message: '準備中です'};
    ctx.browser = {state: 'pending', message: ''};
    await ctx.installBrowser?.();
    return {ok: ctx.browser.state === 'ready', message: ctx.browser.message};
  });

  handle('shell.openExternal', ({url}) => {
    const u = httpsUrl(url) ?? bad('URL が不正です');
    shell.openExternal(u);
    return {ok: true};
  });

  handle('shell.openRoot', () => shell.openPath(ctx.rootDir()).then((e) => (e ? {error: e} : {ok: true})));
}
