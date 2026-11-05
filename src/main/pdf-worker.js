// 注釈を描き込んだ PDF を、メインとは別のスレッド（worker_threads）で作る（v0.16.30）。
// メインのプロセスは窓への入力（ペン・マウス・キー）も受け渡すので、PDF を作り直す重い処理（pdf-lib の圧縮・書き出し）で
// 止めると、その間はペンも筆箱も反応しなくなる。別のスレッドで作れば、メインは止まらない。
// - スレッドを作るのにも少し時間がかかる（メインが止まる）ので、1 つを作り置きして使い回す。編集画面を開いたときに
//   warmPdfWorker で作っておく（書き始める前）。止まったら次に使うときに作り直す
// - スレッドを作れなければ、メインで少しずつ作る（pdf-export.js）
// - このファイルを worker として開いたときは、受け取った PDF に注釈を描き込んで返す
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {exportAnnotatedPdf} from './pdf-export.js';

/** Uint8Array を写さずに Buffer にする（Buffer.from(Uint8Array) は 1 バイトずつ写すので、大きな PDF では遅い） */
export const asBuffer = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);

/** 写し（TypedArray の set はまとめて写す。new Uint8Array(Buffer) は Electron では 1 つずつ写して遅い） */
const copyOf = (u8) => {
  const out = new Uint8Array(u8.byteLength);
  out.set(u8);
  return out;
};

let worker = null;
let seq = 0;
const waiting = new Map(); // 頼んだ番号 → {resolve, reject}

function failAll(e) {
  for (const w of waiting.values()) w.reject(e);
  waiting.clear();
}
// 頼んでいる間だけスレッドを数に入れる（待っていないときに、アプリを閉じるのを待たせない）
const hold = (w) => (waiting.size ? w.ref() : w.unref());

/** 作り置きのスレッド（なければ作る。作れなければ null） */
export function warmPdfWorker() {
  if (worker) return worker;
  try {
    const w = new Worker(new URL(import.meta.url), {workerData: {pdfWorker: true}});
    w.unref();
    w.on('message', ({id, bytes, error}) => {
      const p = waiting.get(id);
      if (!p) return;
      waiting.delete(id);
      hold(w);
      if (error) p.reject(new Error(error));
      else p.resolve(asBuffer(bytes));
    });
    w.on('error', (e) => {
      if (worker === w) worker = null;
      failAll(e);
    });
    w.on('exit', (code) => {
      if (worker === w) worker = null;
      failAll(new Error(`PDF を作るスレッドが止まりました（${code}）`));
    });
    worker = w;
  } catch (e) {
    console.warn('PDF を作るスレッドを始められませんでした。メインで作ります', e);
    worker = null;
  }
  return worker;
}

/**
 * exportAnnotatedPdf と同じ（引数）。戻りは Buffer。渡した bytes は使えなくなる（スレッドへ移す）
 * @param {Uint8Array} bytes
 * @param {Array} annotations
 * @param {{images?: Map<string, Uint8Array>, markers?: 'blue'|'black', notes?: boolean}} options
 */
export async function exportAnnotatedPdfOffThread(bytes, annotations, options = {}) {
  const w = warmPdfWorker();
  if (!w) return asBuffer(await exportAnnotatedPdf(bytes, annotations, options));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, {resolve, reject});
    hold(w);
    // 大きな PDF を写して送る（structured clone）と、メインが長く止まる（Electron では 18MB で 0.1〜0.5 秒）。
    // そこで bytes の中身はスレッドへ渡す（transfer。写さない）。渡したあと、呼んだ側の bytes は空になる。
    // ほかと中身を分け合っている Buffer（小さなファイルの読み込みなど）・渡せない中身は写して渡す
    const own = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : copyOf(bytes);
    const images = [...(options.images ?? new Map())].map(([k, v]) => [k, copyOf(v)]);
    const msg = {id, bytes: own, annotations, images, markers: options.markers, notes: options.notes};
    const moved = images.map(([, v]) => v.buffer);
    try {
      w.postMessage(msg, [own.buffer, ...moved]);
    } catch {
      msg.bytes = copyOf(own);
      w.postMessage(msg, [msg.bytes.buffer, ...moved]);
    }
  });
}

if (!isMainThread && workerData?.pdfWorker) {
  // 頼まれた順に 1 つずつ作る
  let chain = Promise.resolve();
  parentPort.on('message', (m) => {
    chain = chain.then(async () => {
      try {
        const out = await exportAnnotatedPdf(m.bytes, m.annotations, {
          images: new Map(m.images),
          markers: m.markers,
          notes: m.notes
        });
        parentPort.postMessage({id: m.id, bytes: out}, [out.buffer]);
      } catch (e) {
        parentPort.postMessage({id: m.id, error: e?.message ?? String(e)});
      }
    });
  });
}
