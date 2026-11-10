// node:fs/promises の代わり（iPad のアプリ）
import {promises} from './node-fs.js';

export const {
  readFile,
  writeFile,
  appendFile,
  stat,
  lstat,
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  rmdir,
  unlink,
  rename,
  copyFile,
  open
} = promises;
export default promises;
