import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/main/db/db.js';
import {Repo} from '../src/main/db/repo.js';
import {annotationToClient, clampSize, normalizeAnnotation} from '../src/shared/annotation.js';

const text = (over = {}) => ({
  kind: 'text',
  page: 1,
  rect: {x: 72, y: 700, w: 120, h: 18},
  body: '原価企画',
  style: {size: 14, bold: true, color: '#D93025'},
  ...over
});

test('文字入れ：サイズ・太字・色だけを残し、色は小文字にそろえる', () => {
  const r = normalizeAnnotation({...text(), style: {size: 14, bold: true, color: '#D93025', font: 'Times'}});
  assert.equal(r.kind, 'text');
  assert.deepEqual(JSON.parse(r.style_json), {size: 14, bold: true, color: '#d93025'});
  assert.deepEqual(JSON.parse(r.rect_json), {x: 72, y: 700, w: 120, h: 18});
});

test('文字入れ：サイズは 6〜72pt に収め、0.5pt 刻みにする。色が不正なら既定', () => {
  assert.equal(clampSize(3), 6);
  assert.equal(clampSize(200), 72);
  assert.equal(clampSize(10.3), 10.5);
  assert.equal(clampSize('x'), 12);
  const r = normalizeAnnotation(text({style: {size: 999, bold: 'yes', color: 'red'}}));
  assert.deepEqual(JSON.parse(r.style_json), {size: 72, bold: false, color: '#2b2b2b'});
});

test('付箋：大きさは 20pt 角に固定、色は既定あり', () => {
  const r = normalizeAnnotation({
    kind: 'note',
    page: 2,
    rect: {x: 10, y: 20, w: 999, h: 999},
    body: 'あとで確認',
    style: {}
  });
  assert.deepEqual(JSON.parse(r.rect_json), {x: 10, y: 20, w: 20, h: 20});
  assert.deepEqual(JSON.parse(r.style_json), {color: '#f6c445'});
});

test('不正な注釈は通さない', () => {
  assert.throws(() => normalizeAnnotation(null), /注釈/);
  assert.throws(() => normalizeAnnotation(text({kind: 'ink'})), /種類/);
  assert.throws(() => normalizeAnnotation(text({page: 0})), /ページ/);
  assert.throws(() => normalizeAnnotation(text({page: 3}), {pageCount: 2}), /ページ/);
  assert.throws(() => normalizeAnnotation(text({rect: {x: NaN, y: 0, w: 1, h: 1}})), /位置/);
  assert.throws(() => normalizeAnnotation(text({rect: {x: 0, y: 0, w: -1, h: 1}})), /位置/);
  assert.throws(() => normalizeAnnotation(text({rect: {x: '1', y: 0, w: 1, h: 1}})), /位置/);
  assert.throws(() => normalizeAnnotation(text({body: 'あ'.repeat(2001)})), /長すぎ/);
  assert.doesNotThrow(() =>
    normalizeAnnotation({kind: 'note', page: 1, rect: {x: 0, y: 0, w: 0, h: 0}, body: 'あ'.repeat(5000)})
  );
});

test('repo：注釈はファイルの SHA-256 に結び付き、別のファイルの注釈は書き換えられない', async () => {
  const {db} = await openDatabase(':memory:');
  const repo = new Repo(db);
  const a = repo.saveAnnotation('aaa', null, normalizeAnnotation(text()));
  const b = repo.saveAnnotation(
    'aaa',
    null,
    normalizeAnnotation({kind: 'note', page: 1, rect: {x: 1, y: 2, w: 0, h: 0}, body: 'メモ'})
  );
  repo.saveAnnotation('bbb', null, normalizeAnnotation(text()));
  assert.equal(b.z, a.z + 1);
  assert.equal(repo.listAnnotations('aaa').length, 2);

  repo.saveAnnotation(
    'aaa',
    a.id,
    normalizeAnnotation(text({body: '書き換え', style: {size: 20, bold: false, color: '#1a73e8'}}))
  );
  const back = annotationToClient(repo.get('annotation', a.id));
  assert.equal(back.body, '書き換え');
  assert.deepEqual(back.style, {size: 20, bold: false, color: '#1a73e8'});
  assert.equal(back.page, 1);

  assert.throws(() => repo.saveAnnotation('bbb', a.id, normalizeAnnotation(text())), /注釈がありません/);
  repo.removeAnnotation('bbb', a.id); // 別のファイルからは消せない
  assert.equal(repo.listAnnotations('aaa').length, 2);
  repo.removeAnnotation('aaa', a.id);
  assert.deepEqual(
    repo.listAnnotations('aaa').map((r) => r.id),
    [b.id]
  );
});

test('文字隠し：色は持たず、下の文字を body に入れる。大きさ 0 は通さない', () => {
  const r = normalizeAnnotation({
    kind: 'mask',
    page: 1,
    rect: {x: 10, y: 20, w: 80, h: 14},
    body: '原価企画',
    style: {color: '#000000'}
  });
  assert.deepEqual(JSON.parse(r.style_json), {});
  assert.equal(r.body, '原価企画');
  assert.deepEqual(JSON.parse(r.rect_json), {x: 10, y: 20, w: 80, h: 14});
  assert.throws(() => normalizeAnnotation({kind: 'mask', page: 1, rect: {x: 0, y: 0, w: 0, h: 10}}), /大きさ/);
});
