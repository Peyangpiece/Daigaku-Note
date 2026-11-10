// node:os・node:url・node:module・node:child_process・node:zlib・node:worker_threads・node:http(s) の代わり（iPad のアプリ）。
// 窓口を読み込めるようにするだけ（iPad で使う場面では呼ばない。呼ばれたら「iPad ではできない」）
const NOT_HERE = () => {
  throw new Error('この操作は iPad ではできません（パソコンで開いてください）');
};
export const os = {
  homedir: () => '/app',
  tmpdir: () => '/app/tmp',
  hostname: () => 'iPad',
  platform: () => 'ios',
  networkInterfaces: () => ({}),
  EOL: '\n'
};
export const url = {
  fileURLToPath: (u) => decodeURIComponent(new URL(String(u)).pathname),
  pathToFileURL: (p) => new URL(`file://${encodeURI(p)}`)
};
export const module_ = {
  createRequire: () => {
    const r = NOT_HERE;
    r.resolve = (name) => `/app/node_modules/${name}`;
    return r;
  }
};
export const child_process = {execFile: NOT_HERE, spawn: NOT_HERE, exec: NOT_HERE};
export const zlib = {inflateRawSync: NOT_HERE, inflateSync: NOT_HERE, deflateSync: NOT_HERE};
export const worker_threads = {
  Worker: class {
    constructor() {
      NOT_HERE();
    }
  },
  isMainThread: true,
  parentPort: null,
  workerData: null
};
export const http = {createServer: NOT_HERE, request: NOT_HERE, get: NOT_HERE};
