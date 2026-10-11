import test from 'node:test';
import assert from 'node:assert/strict';
import { SchoolCalendar, publicHolidays, parseDate, parseOffDays, label, todayKST } from '../lib/schoolday.js';

test('개천절(토) → 10/5(월) 대체공휴일', () => {
  assert.ok(publicHolidays(2026).has('2026-10-05'));
});

test('신정이 주말이어도 대체공휴일 없음', () => {
  // 2028-01-01 은 토요일
  assert.ok(!publicHolidays(2028).has('2028-01-03'));
});

test('이전 등교일: 10/11(일) → 10/8(목) (10/9 한글날)', () => {
  assert.equal(new SchoolCalendar().prevSchoolDay('2026-10-11'), '2026-10-08');
});

test('이전 등교일: 10/6(화) → 10/2(금) (10/5 대체공휴일)', () => {
  assert.equal(new SchoolCalendar().prevSchoolDay('2026-10-06'), '2026-10-02');
});

test('등교 안 하는 날은 건너뜀', () => {
  const cal = new SchoolCalendar(['2026-10-08']);
  assert.equal(cal.prevSchoolDay('2026-10-11'), '2026-10-07');
  assert.equal(cal.whyOff('2026-10-08'), '등교 안 하는 날');
  assert.equal(cal.whyOff('2026-10-09'), '공휴일');
  assert.equal(cal.whyOff('2026-10-10'), '주말');
  assert.equal(cal.whyOff('2026-10-07'), '');
});

test('날짜 읽기', () => {
  assert.equal(parseDate('2026.9.1'), '2026-09-01');
  assert.equal(parseDate('2026년 9월 24일'), '2026-09-24');
  assert.equal(parseDate('2026-02-30'), null);
  assert.deepEqual(parseOffDays('2026-09-25  # 추석\n# 메모\n2026-09-24\n\n잘못된 줄'), ['2026-09-24', '2026-09-25']);
});

test('표시용 라벨과 한국 시간 오늘', () => {
  assert.equal(label('2026-10-08'), '10/8 (목)');
  // UTC 10/10 16:00 = 한국 10/11 01:00
  assert.equal(todayKST(new Date('2026-10-10T16:00:00Z')), '2026-10-11');
});
