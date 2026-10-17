// ダウンロードしたファイルに OS の「インターネットから来た」印を付ける（SPEC §6.7）。失敗しても同期は止めない。
import {execFile} from 'node:child_process';
import {promises as fsp} from 'node:fs';
import {randomUUID} from 'node:crypto';

const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, (e) => (e ? reject(e) : resolve())));

export function createQuarantine({platform = process.platform, appName = '大学ノート'} = {}) {
  return async function quarantine(file, sourceUrl = '') {
    if (platform === 'darwin') {
      // 0083：ダウンロード済み・未確認。Gatekeeper が開くときに確かめる
      const stamp = Math.floor(Date.now() / 1000).toString(16);
      await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', `0083;${stamp};${appName};${randomUUID()}`, file]);
    } else if (platform === 'win32') {
      // NTFS の代替データストリーム Zone.Identifier（ZoneId=3 ＝ インターネット）
      const host = (() => {
        try {
          return new URL(sourceUrl).origin;
        } catch {
          return '';
        }
      })();
      await fsp.writeFile(`${file}:Zone.Identifier`, `[ZoneTransfer]\r\nZoneId=3\r\n${host ? `HostUrl=${host}\r\n` : ''}`);
    }
  };
}
