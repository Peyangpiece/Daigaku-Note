// contextBridge で window.daigaku を出す（DESIGN-M0 §4）。許した種類だけ。
const {contextBridge, ipcRenderer, webFrame} = require('electron');

const INVOKE = [
  'state.get',
  'setup.detect',
  'import.list',
  'import.accept',
  'import.dismiss',
  'import.scan',
  'setup.createConnection',
  'setup.excludeCourses',
  'connection.login',
  'connection.update',
  'connection.savePassword',
  'connection.forgetPassword',
  'connection.savedLogin',
  'connection.remove',
  'term.save',
  'term.remove',
  'courses.list',
  'course.update',
  'sync.run',
  'material.open',
  'material.reveal',
  'material.move',
  'material.upload',
  'material.uploadData',
  'material.remove',
  'folder.create',
  'folder.scan',
  'folder.reveal',
  'folder.update',
  'folder.renameSub',
  'folder.addSub',
  'folder.removeSub',
  'folder.remove',
  'round.add',
  'round.remove',
  'round.update',
  'quiz.setKey',
  'quiz.removeKey',
  'quiz.detectCli',
  'quiz.setEngine',
  'quiz.ask',
  'quiz.settings',
  'quiz.generate',
  'quiz.fromMasks',
  'quiz.questions',
  'quiz.answer',
  'quiz.review',
  'question.update',
  'pdf.open',
  'pdf.asset',
  'pdf.export',
  'pdf.save',
  'pdf.textStyle',
  'note.open',
  'note.addPage',
  'note.trial',
  'note.addScanPages',
  'scan.remoteOpen',
  'scan.remoteState',
  'scan.remoteClose',
  'scan.remoteReply',
  'note.trialEnd',
  'note.removePage',
  'note.setHeader',
  'note.setPaper',
  'photo.add',
  'photo.data',
  'annotation.save',
  'annotation.remove',
  'bookmark.save',
  'bookmark.remove',
  'settings.pickDownloadDir',
  'settings.update',
  'shell.openExternal',
  'shell.openRoot',
  'app.notices',
  'app.openDataDir',
  'app.openLogs',
  'term.readCalendar',
  'points.claimLogin',
  'backup.export',
  'backup.import',
  'backup.openDir',
  'app.relaunch',
  'browser.install',
  'skin.save',
  'skin.remove',
  'skin.apply',
  'skin.recentColor',
  'skin.introduced',
  'sticker.add',
  'sticker.update',
  'sticker.remove',
  'sticker.data',
  'stationery.purchase',
  'stationery.arrange',
  'stationery.myNoteSave',
  'stationery.myNoteRemove',
  'stationery.noteDefault',
  'stationery.model',
  'mobile.status',
  'mobile.enable',
  'mobile.pair',
  'mobile.rename',
  'mobile.remove',
  'mobile.setFull',
  'search.query',
  'material.refetch',
  'sync.history',
  'annotation.memorize',
  'cloud.status',
  'cloud.link',
  'cloud.unlink',
  'cloud.push',
  'cloud.wipe',
  'cloud.keyQr',
  'cloud.setPassphrase',
  'cloud.unlock',
  'cloud.adoptIpad',
  'cloud.replace',
  'annotation.list'
];
const ON = [
  'quiz.progress',
  'quiz.finished',
  'state.changed',
  'import.pending',
  'import.done',
  'sync.progress',
  'sync.finished',
  'login.required',
  'route',
  'zoom',
  'annotations.changed',
  'note.pages',
  'note.removed',
  'scan.photo'
];

const api = {};
for (const ch of INVOKE) api[ch] = (arg) => ipcRenderer.invoke(ch, arg);
api.on = (ch, fn) => {
  if (!ON.includes(ch)) throw new Error(`知らない通知: ${ch}`);
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, listener);
  return () => ipcRenderer.removeListener(ch, listener);
};
// アプリ全体の拡大（メニューの「拡大」「縮小」）。PDF の編集画面のあいだは 100% にしておき（hold）、離れたら戻す（release）。
// 編集画面では PDF だけを拡大するので、前に拡大したままだとツールバーや背景まで大きくなるため
let held = null;
api.appZoom = (cmd) => {
  if (cmd === 'hold') {
    if (held === null) held = webFrame.getZoomLevel();
    webFrame.setZoomLevel(0);
  } else if (cmd === 'release') {
    if (held !== null) webFrame.setZoomLevel(held);
    held = null;
  } else {
    const level = cmd === 'reset' ? 0 : webFrame.getZoomLevel() + (cmd === 'in' ? 0.5 : -0.5);
    webFrame.setZoomLevel(Math.max(-3, Math.min(5, level)));
  }
};
contextBridge.exposeInMainWorld('daigaku', api);
