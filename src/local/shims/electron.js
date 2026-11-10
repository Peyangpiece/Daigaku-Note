// electron の代わり（iPad のアプリ）。パソコンの窓口が import するものを、iPad で意味のある形か「iPad ではできない」にする
const NOT_HERE = 'この操作は iPad ではできません（パソコンで開いてください）';
const PATHS = {
  userData: '/app/userData',
  desktop: '/app/desktop',
  documents: '/app/documents',
  downloads: '/app/downloads',
  temp: '/app/tmp',
  home: '/app'
};

export const app = {
  isPackaged: false,
  getPath: (name) => PATHS[name] ?? `/app/${name}`,
  getVersion: () => globalThis.__paletteVersion ?? '0.0.0',
  getName: () => 'パレットノート',
  getLoginItemSettings: () => ({openAtLogin: false}),
  setLoginItemSettings() {},
  relaunch() {
    location.reload();
  },
  quit() {},
  on() {},
  whenReady: () => Promise.resolve()
};
export const shell = {
  openPath: async () => NOT_HERE,
  showItemInFolder() {},
  openExternal: async (url) => {
    window.open(url, '_blank');
  },
  trashItem: async () => {
    throw new Error(NOT_HERE);
  }
};
export const dialog = {
  showOpenDialog: async () => ({canceled: true, filePaths: []}),
  showSaveDialog: async () => ({canceled: true}),
  showMessageBox: async () => ({response: 0})
};
export const BrowserWindow = {getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null};
export const ipcMain = {handle() {}, on() {}};
export const nativeTheme = {
  shouldUseDarkColors: matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  on() {}
};
export const safeStorage = {isEncryptionAvailable: () => false};
export class Notification {
  static isSupported() {
    return false;
  }
  show() {}
  on() {}
}
export default {app, shell, dialog, BrowserWindow, ipcMain, nativeTheme, safeStorage, Notification};
