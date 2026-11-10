// iPad（パソコンと同じ画面。docs/MOBILE.md §8）：パソコンの画面の窓口（preload の INVOKE）のうち、iPad で形を変えるもの。
// パソコン（main/mobile/pad.js）と iPad のページ（src/pad/bridge.js）の両方で使う。副作用なし

/** iPad からは使わない窓口と、そのときに出す言葉（パソコンのフォルダ・窓を開く、スマホ・iPad をつなぐ設定） */
export const PAD_DENY = {
  'settings.pickDownloadDir': '保存先のフォルダは、パソコンの画面で選んでください',
  'material.reveal': 'フォルダは、パソコンの画面で開いてください',
  'folder.reveal': 'フォルダは、パソコンの画面で開いてください',
  'shell.openRoot': 'フォルダは、パソコンの画面で開いてください',
  'app.openDataDir': 'フォルダは、パソコンの画面で開いてください',
  'app.openLogs': 'フォルダは、パソコンの画面で開いてください',
  'backup.openDir': 'フォルダは、パソコンの画面で開いてください',
  'mobile.enable': 'スマホ・iPad の設定は、パソコンの画面で変えてください',
  'mobile.pair': 'スマホ・iPad の追加は、パソコンの画面でしてください',
  'mobile.setFull': 'スマホ・iPad の設定は、パソコンの画面で変えてください'
};

/** パソコンのフォルダを選んで登録する（パソコンの選ぶ窓が要る） */
export const PAD_LINK_FOLDER =
  'パソコンのフォルダを登録するのは、パソコンの画面でしてください（新しいフォルダは iPad でも作れます）';

/**
 * iPad の側で受ける窓口：パソコンの選ぶ・保存する窓や、パソコンのアプリで開く代わりに、iPad でファイルを選ぶ・保存する・開く
 * （bridge.js。中身はそれぞれ PAD_EXTRA の窓口でやりとりする）
 */
export const PAD_LOCAL = [
  'material.upload',
  'material.open',
  'pdf.export',
  'term.readCalendar',
  'backup.export',
  'backup.import',
  'shell.openExternal'
];

/** iPad だけが使う窓口（ファイルの中身を渡す・受ける。パソコンの画面にはない） */
export const PAD_EXTRA = [
  'material.data',
  'pdf.exportData',
  'term.readCalendarData',
  'backup.exportData',
  'backup.importData'
];

/** iPad とやりとりするファイル 1 つの大きさの上限（暗号化して JSON で運ぶので、iPad のメモリに収まる大きさに） */
export const PAD_FILE_MAX = 90 * 1024 * 1024;
/** 知らせを待つ長さ（この間に知らせがなければ空で返し、iPad はすぐ次を待つ） */
export const PAD_POLL_MS = 25_000;

/**
 * パソコンと iPad の一方で変えたら、もう一方の画面に「変わった」（state.changed）を知らせる。ただし次の窓口は知らせない：
 * 読むだけのもの、書き込みのたびに呼ぶもの（注釈・しおり・上書き保存・ノートのページ。それぞれ自分で知らせる）、
 * 終わったときに自分で知らせるもの（同期・クイズを作る）
 */
export const PAD_QUIET = new Set([
  'state.get',
  'setup.detect',
  'import.list',
  'import.scan',
  'courses.list',
  'connection.savedLogin',
  'connection.login',
  'sync.run',
  'material.open',
  'material.reveal',
  'material.data',
  'folder.reveal',
  'folder.scan',
  'quiz.detectCli',
  'quiz.generate',
  'quiz.fromMasks',
  'quiz.questions',
  'quiz.review',
  'quiz.answer',
  'pdf.open',
  'pdf.asset',
  'pdf.export',
  'pdf.exportData',
  'pdf.save',
  'pdf.textStyle',
  'note.addPage',
  'note.trial',
  'note.addScanPages',
  'note.removePage',
  'note.setHeader',
  'note.setPaper',
  'scan.remoteOpen',
  'scan.remoteState',
  'scan.remoteClose',
  'scan.remoteReply',
  'photo.add',
  'photo.data',
  'annotation.save',
  'annotation.remove',
  'annotation.list',
  'bookmark.save',
  'bookmark.remove',
  'settings.pickDownloadDir',
  'shell.openExternal',
  'shell.openRoot',
  'app.notices',
  'app.openDataDir',
  'app.openLogs',
  'app.relaunch',
  'term.readCalendar',
  'term.readCalendarData',
  'points.claimLogin',
  'backup.export',
  'backup.exportData',
  'backup.import',
  'backup.importData',
  'backup.openDir',
  'browser.install',
  'skin.recentColor',
  'skin.introduced',
  'sticker.data',
  'stationery.model',
  'mobile.status',
  'mobile.enable',
  'mobile.pair',
  'mobile.rename',
  'mobile.remove',
  'mobile.setFull'
]);
