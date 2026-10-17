import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {checkDownloadDir, defaultRoot, importDir, inside} from '../src/shared/paths.js';

const home = '/Users/u';
const posix = path.posix;

test('保存先はホームフォルダ内の通常のフォルダだけ', () => {
  assert.equal(checkDownloadDir('', home, posix), '');
  assert.equal(checkDownloadDir('~/Documents/授業資料', home, posix), '/Users/u/Documents/授業資料');
  assert.equal(checkDownloadDir('/Users/u/Desktop/大学ノート/', home, posix), '/Users/u/Desktop/大学ノート');
  assert.equal(checkDownloadDir('~', home, posix), '/Users/u');
  for (const bad of ['/etc', '~/../other', '/Users/u/.ssh', '~/Library/LaunchAgents', 'Documents', '~/Desktop/../../x', '/Users/u2'])
    assert.throws(() => checkDownloadDir(bad, home, posix), undefined, bad);
});

test('Windows の形も扱える', () => {
  const win = path.win32;
  const h = 'C:\\Users\\u';
  assert.equal(checkDownloadDir('C:\\Users\\u\\Desktop\\大学ノート', h, win), 'C:\\Users\\u\\Desktop\\大学ノート');
  assert.equal(checkDownloadDir('~\\Documents', h, win), 'C:\\Users\\u\\Documents');
  assert.throws(() => checkDownloadDir('D:\\other', h, win));
  assert.throws(() => checkDownloadDir('C:\\Users\\u\\.hidden', h, win));
});

test('inside・既定のフォルダ', () => {
  assert.equal(inside('/a/b/c', '/a/b', posix), true);
  assert.equal(inside('/a/b', '/a/b', posix), false);
  assert.equal(inside('/a/bc', '/a/b', posix), false);
  assert.equal(inside('/x', '/a/b', posix), false);
  assert.equal(defaultRoot('/Users/u/Desktop', posix), '/Users/u/Desktop/大学ノート');
  assert.equal(importDir('/Users/u/Desktop/大学ノート', posix), '/Users/u/Desktop/大学ノート/取り込み');
});
