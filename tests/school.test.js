import test from 'node:test';
import assert from 'node:assert/strict';
import {isSchool, presetFor, roundsFor, termLabelFor, termLabelsFor} from '../src/shared/school.js';
import {PERIOD_PRESETS} from '../src/shared/schedule.js';

test('学校の種類ごとの学期の初期値', () => {
  assert.ok(isSchool('university') && isSchool('high') && isSchool('junior'));
  assert.ok(!isSchool('') && !isSchool('toString'));
  // 大学：春学期・秋学期、15 回、時限は選ばない
  assert.equal(termLabelFor('university', 5), '春学期');
  assert.equal(termLabelFor('university', 11), '秋学期');
  assert.equal(termLabelFor(null, 2), '秋学期');
  assert.equal(roundsFor('university', '秋学期'), 15);
  assert.equal(presetFor('university'), '');
  assert.ok(termLabelsFor('university').includes('第1クォーター'));
  // 高校・中学：3 学期制。3 学期は 10 回。時限は 50 分の目安
  assert.equal(termLabelFor('high', 4), '1学期');
  assert.equal(termLabelFor('high', 8), '1学期');
  assert.equal(termLabelFor('junior', 9), '2学期');
  assert.equal(termLabelFor('junior', 1), '3学期');
  assert.equal(roundsFor('high', '2学期'), 15);
  assert.equal(roundsFor('high', '3学期'), 10);
  assert.ok(PERIOD_PRESETS[presetFor('high')]);
  assert.deepEqual(termLabelsFor('junior').slice(0, 3), ['1学期', '2学期', '3学期']);
});
