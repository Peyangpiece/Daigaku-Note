// ログ（DESIGN-M0 §1）。日ごとのファイル、7 日分。秘密・本文・Cookie は書かない（呼ぶ側の責任）。
import {appendFileSync, mkdirSync, readdirSync, unlinkSync} from 'node:fs';
import path from 'node:path';

export function createLogger(dir, {keepDays = 7, now = () => new Date()} = {}) {
  mkdirSync(dir, {recursive: true});
  const fileFor = (d) => path.join(dir, `app-${d.toISOString().slice(0, 10)}.log`);
  const write = (level, msg) => {
    const d = now();
    const line = `${d.toISOString()} ${level.padEnd(5)} ${String(msg).replace(/\n/g, '\\n')}\n`;
    try {
      appendFileSync(fileFor(d), line);
    } catch {
      /* ログに書けなくても止めない */
    }
    if (process.env.DAIGAKU_LOG_STDOUT) process.stdout.write(line);
  };
  const rotate = () => {
    try {
      const files = readdirSync(dir)
        .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
        .sort();
      for (const f of files.slice(0, Math.max(0, files.length - keepDays))) unlinkSync(path.join(dir, f));
    } catch {
      /* 無視 */
    }
  };
  rotate();
  return {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    rotate,
    dir
  };
}
