// contextBridge で window.daigaku を出す（DESIGN-M0 §4）。許した種類だけ。
const {contextBridge, ipcRenderer} = require('electron');

const INVOKE = [
  'state.get', 'setup.detect', 'setup.createConnection', 'setup.excludeCourses', 'connection.login', 'connection.savePassword', 'connection.forgetPassword', 'connection.remove',
  'term.save', 'courses.list', 'course.update', 'sync.run', 'material.open', 'material.reveal', 'material.move',
  'quiz.status', 'quiz.setKey', 'quiz.removeKey', 'quiz.settings', 'quiz.generate', 'quiz.list', 'quiz.questions', 'quiz.answer', 'quiz.review', 'question.update',
  'settings.pickDownloadDir', 'settings.update', 'shell.openExternal', 'shell.openRoot', 'app.version', 'app.openWindow', 'browser.install'
];
const ON = ['quiz.progress', 'quiz.finished', 'state.changed', 'sync.progress', 'sync.finished', 'attention.changed', 'login.required', 'route'];

const api = {};
for (const ch of INVOKE) api[ch] = (arg) => ipcRenderer.invoke(ch, arg);
api.on = (ch, fn) => {
  if (!ON.includes(ch)) throw new Error(`知らない通知: ${ch}`);
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, listener);
  return () => ipcRenderer.removeListener(ch, listener);
};
contextBridge.exposeInMainWorld('daigaku', api);
