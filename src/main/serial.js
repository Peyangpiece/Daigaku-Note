// 鍵ごとに 1 つずつ順に動かす（同じノートのページの足し引きを重ねない。ipc/notes.js）。
// 前のものが失敗しても次は動く。終わった鍵は覚えておかない
export function createSerial() {
  const tails = new Map();
  return (key, fn) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(
      () => fn(),
      () => fn()
    );
    const tail = run.catch(() => {});
    tails.set(key, tail);
    tail.then(() => tails.get(key) === tail && tails.delete(key));
    return run;
  };
}
