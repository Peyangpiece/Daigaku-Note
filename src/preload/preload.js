// contextBridge で window.daigaku を出す（DESIGN-M0 §4）。許した種類だけ。
const {contextBridge, ipcRenderer, webFrame} = require('electron');

const INVOKE = [
  'state.get', 'setup.detect', 'setup.createConnection', 'setup.excludeCourses', 'connection.login', 'connection.update', 'connection.savePassword', 'connection.forgetPassword', 'connection.remove',
  'term.save', 'courses.list', 'course.update', 'sync.run', 'material.open', 'material.reveal', 'material.move', 'material.upload', 'material.uploadData', 'material.remove', 'folder.create', 'folder.scan', 'folder.reveal', 'folder.update', 'folder.renameSub', 'folder.importCourses', 'round.update',
  'quiz.status', 'quiz.setKey', 'quiz.removeKey', 'quiz.settings', 'quiz.generate', 'quiz.list', 'quiz.questions', 'quiz.answer', 'quiz.review', 'question.update',
  'pdf.open', 'pdf.asset', 'pdf.export', 'pdf.save', 'annotation.save', 'annotation.remove', 'bookmark.save', 'bookmark.remove',
  'settings.pickDownloadDir', 'settings.update', 'shell.openExternal', 'shell.openRoot', 'app.version', 'app.openWindow', 'browser.install',
  'skin.save', 'skin.remove', 'skin.apply', 'skin.recentColor', 'skin.introduced', 'sticker.add', 'sticker.update', 'sticker.remove', 'sticker.data', 'skin.export', 'skin.import',
  'stationery.acquire', 'stationery.arrange'
];
const ON = ['quiz.progress', 'quiz.finished', 'state.changed', 'sync.progress', 'sync.finished', 'attention.changed', 'login.required', 'route', 'zoom'];

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
