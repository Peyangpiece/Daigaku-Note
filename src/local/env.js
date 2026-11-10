// iPad のアプリでパソコンの窓口を動かす前に、Node にある大域の名前（process・Buffer）を用意する（index.html で boot.js より先に読む）
import {Buffer} from './shims/buffer.js';

globalThis.process ??= {
  env: {},
  platform: 'ios',
  pid: 1,
  versions: {},
  on() {},
  cwd: () => '/app',
  nextTick: (f, ...a) => queueMicrotask(() => f(...a))
};
globalThis.Buffer ??= Buffer;
