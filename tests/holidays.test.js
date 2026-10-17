import test from 'node:test';
import assert from 'node:assert/strict';
import {holidaysBetween, nationalHolidays} from '../src/shared/holidays.js';

test('2026 年の祝日', () => {
  const h = nationalHolidays(2026);
  const expected = {
    '2026-01-01': '元日',
    '2026-01-12': '成人の日',
    '2026-02-11': '建国記念の日',
    '2026-02-23': '天皇誕生日',
    '2026-03-20': '春分の日',
    '2026-04-29': '昭和の日',
    '2026-05-03': '憲法記念日',
    '2026-05-04': 'みどりの日',
    '2026-05-05': 'こどもの日',
    '2026-05-06': '振替休日', // 5/3 が日曜
    '2026-07-20': '海の日',
    '2026-08-11': '山の日',
    '2026-09-21': '敬老の日',
    '2026-09-22': '国民の休日', // 敬老の日と秋分の日の間
    '2026-09-23': '秋分の日',
    '2026-10-12': 'スポーツの日',
    '2026-11-03': '文化の日',
    '2026-11-23': '勤労感謝の日'
  };
  for (const [d, name] of Object.entries(expected)) assert.equal(h.get(d), name, d);
  assert.equal(h.size, Object.keys(expected).length, [...h.keys()].join(','));
});

test('2025 年：振替休日と秋分', () => {
  const h = nationalHolidays(2025);
  assert.equal(h.get('2025-02-24'), '振替休日'); // 2/23 が日曜
  assert.equal(h.get('2025-05-06'), '振替休日'); // 5/4 が日曜
  assert.equal(h.get('2025-09-23'), '秋分の日');
  assert.equal(h.get('2025-11-24'), '振替休日'); // 11/23 が日曜
});

test('期間内の祝日', () => {
  const s = holidaysBetween('2026-10-01', '2027-03-31');
  assert.ok(s.has('2026-10-12') && s.has('2027-01-01') && s.has('2027-02-11'));
  assert.ok(!s.has('2026-09-23'));
});
