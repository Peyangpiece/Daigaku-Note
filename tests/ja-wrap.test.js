import test from 'node:test';
import assert from 'node:assert/strict';
import {jaWrap} from '../src/renderer/ja-wrap.js';

test('授業名は語のまとまりの境目でだけ折り返す', () => {
  assert.equal(jaWrap('国際ビジネス戦略'), '国際<wbr>ビジネス<wbr>戦略');
  assert.equal(jaWrap('人材マネジメントⅡ'), '人材<wbr>マネジメントⅡ', 'Ⅱ の前では折り返さない');
  assert.equal(jaWrap('サービス・マーケティング'), 'サービス・<wbr>マーケティング');
  assert.equal(
    jaWrap('英語コミュニケーションⅢ（プレゼンテーション）'),
    '英語<wbr>コミュニケーションⅢ<wbr>（プレゼンテーション）'
  );
  assert.equal(jaWrap('Web デザイン論'), 'Web <wbr>デザイン論', '1 文字の漢字の前では折り返さない');
  assert.equal(jaWrap('読み物と演習'), '読み物と<wbr>演習', 'ひらがなの前では折り返さない');
});

test('HTML として安全に出す', () => {
  const out = jaWrap('<b onclick="x">A&B</b>');
  assert.equal(out.replaceAll('<wbr>', ''), '&lt;b onclick=&quot;x&quot;&gt;A&amp;B&lt;/b&gt;');
  assert.doesNotMatch(out.replaceAll('<wbr>', ''), /[<>"]/);
  assert.equal(jaWrap(''), '');
  assert.equal(jaWrap(null), '');
});
