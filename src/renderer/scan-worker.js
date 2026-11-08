// アナログノートの読み取りを、画面とは別に動かす（Web Worker）。1 枚の読み取り（ゆがみ直し・線の取り出し）は数秒かかるので、
// その間もカメラの映像と枠の表示を止めない。受け取り {id, image: {width, height, data}}、返し {id, r}（readScan の戻り）
import {readScan} from '../shared/scan-read.js';

self.onmessage = (e) => {
  const {id, image} = e.data;
  let r;
  try {
    r = readScan(image);
  } catch {
    r = {error: '読み取れませんでした。もう一度カメラに向けてください'};
  }
  const ink = r.ink;
  const transfer = ink ? [ink.idx, ink.rgb, ink.a, ink.d, ink.hw, ink.tone].map((a) => a.buffer) : [];
  self.postMessage({id, r}, transfer);
};
