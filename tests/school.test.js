import test from 'node:test';
import assert from 'node:assert/strict';
import {isSchool, isSecondary, roundsFor, termLabelFor, termLabelsFor} from '../src/shared/school.js';

test('学校の種類ごとの学期の初期値', () => {
  assert.ok(isSchool('university') && isSchool('high') && isSchool('junior'));
  assert.ok(!isSchool('') && !isSchool('toString'));
  // 大学：春学期・秋学期、15 回、時限は選ばない
  assert.equal(termLabelFor('university', 5), '春学期');
  assert.equal(termLabelFor('university', 11), '秋学期');
  assert.equal(termLabelFor(null, 2), '秋学期');
  assert.equal(roundsFor('university', '秋学期'), 15);
  assert.ok(!isSecondary('university') && !isSecondary(null));
  assert.ok(termLabelsFor('university').includes('第1クォーター'));
  // 高校・中学：3 学期制。回数と時限は尋ねない（回数は 3 学期だけ 10 回、ほかは 15 回）
  assert.equal(termLabelFor('high', 4), '1学期');
  assert.equal(termLabelFor('high', 8), '1学期');
  assert.equal(termLabelFor('junior', 9), '2学期');
  assert.equal(termLabelFor('junior', 1), '3学期');
  assert.equal(roundsFor('high', '2学期'), 15);
  assert.equal(roundsFor('high', '3学期'), 10);
  assert.ok(isSecondary('high') && isSecondary('junior'));
  assert.deepEqual(termLabelsFor('junior').slice(0, 3), ['1学期', '2学期', '3学期']);
});
