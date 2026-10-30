import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {nextBookmarkName, normalizeBookmark} from '../src/shared/bookmark.js';
import {normalizeAnnotation} from '../src/shared/annotation.js';

test('しおりの既定の名前は「しおり1」「しおり2」…（名前を変えたものは数えない）', () => {
  assert.equal(nextBookmarkName([]), 'しおり1');
  assert.equal(nextBookmarkName(['しおり1', 'しおり2']), 'しおり3');
  assert.equal(nextBookmarkName(['しおり1', '第3章', 'しおり 5']), 'しおり6');
});

test('しおりの検査：ページ・位置・名前', () => {
  assert.deepEqual(normalizeBookmark({page: 2, y: 0.25, name: '  第 3 章  '}), {page: 2, y: 0.25, name: '第 3 章'});
  assert.equal(normalizeBookmark({page: 1, y: 1.7, name: 'a'}).y, 1);
  assert.throws(() => normalizeBookmark({page: 0, y: 0, name: 'a'}), /ページ/);
  assert.throws(() => normalizeBookmark({page: 1, y: 0, name: '   '}), /名前/);
  assert.equal(normalizeBookmark({page: 1, y: 0, name: 'あ'.repeat(60)}).name.length, 40);
});

test('しおりの保存：ファイル（SHA-256）ごと。名前の変更・削除は同じファイルのものだけ', async () => {
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const a = repo.saveBookmark('sha-a', null, {page: 1, y: 0.1, name: 'しおり1'});
  repo.saveBookmark('sha-a', null, {page: 3, y: 0.5, name: 'しおり2'});
  repo.saveBookmark('sha-b', null, {page: 1, y: 0, name: 'しおり1'});
  assert.deepEqual(
    repo.listBookmarks('sha-a').map((b) => b.name),
    ['しおり1', 'しおり2']
  );
  repo.saveBookmark('sha-a', a.id, {page: 1, y: 0.1, name: '第1章'});
  assert.equal(repo.get('bookmark', a.id).name, '第1章');
  assert.throws(() => repo.saveBookmark('sha-b', a.id, {page: 1, y: 0, name: 'x'}), /しおりがありません/);
  repo.removeBookmark('sha-b', a.id);
  assert.equal(repo.listBookmarks('sha-a').length, 2, '別のファイルからは消せない');
  repo.removeBookmark('sha-a', a.id);
  assert.deepEqual(
    repo.listBookmarks('sha-a').map((b) => b.name),
    ['しおり2']
  );
});

test('授業画面の目印の数：付箋（貼りものの index）と、まだ付箋に移していないしおりを足す', async () => {
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  repo.saveBookmark('sha-a', null, {page: 1, y: 0.1, name: 'しおり1'});
  const tab = {
    page: 1,
    kind: 'stamp',
    rect: {x: 580, y: 700, w: 44, h: 16},
    body: '第3章',
    style: {type: 'index', color: '#f28b82'}
  };
  repo.saveAnnotation('sha-a', null, normalizeAnnotation(tab));
  repo.saveAnnotation('sha-b', null, normalizeAnnotation(tab));
  repo.saveAnnotation(
    'sha-b',
    null,
    normalizeAnnotation({...tab, body: '', style: {type: 'memo'}, rect: {x: 10, y: 10, w: 80, h: 80}})
  );
  assert.deepEqual(repo.bookmarkCounts(), {'sha-a': 2, 'sha-b': 1});
});
