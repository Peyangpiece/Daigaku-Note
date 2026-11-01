import test from 'node:test';
import assert from 'node:assert/strict';
import {sendAll} from '../src/main/frames.js';

const frame = (log, name) => ({send: (ch, p) => log.push([name, ch, p])});

test('sendAll：窓の中のすべての画面（並べた左右の iframe も）に送る。書いた画面（except）には送らない', () => {
  const log = [];
  const top = frame(log, 'top');
  const left = frame(log, 'left');
  const right = frame(log, 'right');
  const wc = {mainFrame: {framesInSubtree: [top, left, right]}, isDestroyed: () => false, send: () => log.push(['wc'])};
  sendAll(wc, 'note.pages', {pages: 2}, left);
  assert.deepEqual(
    log.map((x) => x[0]),
    ['top', 'right']
  );
  log.length = 0;
  sendAll(wc, 'state.changed', {});
  assert.equal(log.length, 3);
  // 閉じた画面で失敗しても、ほかには送る
  const broken = {
    send: () => {
      throw new Error('gone');
    }
  };
  log.length = 0;
  sendAll({mainFrame: {framesInSubtree: [broken, top]}}, 'x', 1);
  assert.deepEqual(log, [['top', 'x', 1]]);
  // 窓がない・閉じた窓には何もしない
  sendAll(null, 'x', 1);
  sendAll({isDestroyed: () => true}, 'x', 1);
});
