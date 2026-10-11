import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, MathError, MathPracticeClient, parseNames, kstDayRange } from '../public/js/lib/mathpractice.js';
import { fakeFirestoreFetch, sampleDb, kstMillis } from './fake-firestore.js';

// 한국 시간 2026-10-11(일) 오전 → 이전 등교일 10/8(목)
const NOW = new Date('2026-10-11T00:30:00Z');

test('이전 등교일에 안 한 학생', async () => {
  const r = await buildReport({ classCode: 'test01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.equal(r.classCode, 'TEST01');
  assert.equal(r.dateKey, '2026-10-08');
  assert.equal(r.dateLabel, '10/8 (목)');
  // 12번은 L27 통과라 빠지고, '테스트'(99번)는 아직 제외 목록이 없어서 남음
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '7', '99']);
  assert.deepEqual(r.graduated.map((s) => s.no), ['12']);
  assert.equal(r.total, 18);
  assert.equal(r.done, 15); // 4번은 기록이 없어도 접속해서 '했다'로 셈
  assert.equal(r.accessOnly, 1);
  assert.equal(r.todayOff, '주말');
});

test('접속만 해도 했다: 4번 포함, 다른 날 접속(7번)은 안 셈', async () => {
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.ok(!r.missing.some((s) => s.no === '4'));
  assert.ok(r.missing.some((s) => s.no === '7'));
});

test('접속 기록의 하루 범위는 한국 시간 0시~24시', async () => {
  const [start, end] = kstDayRange('2026-10-08');
  assert.equal(start, kstMillis('2026-10-08', 0, 0));
  assert.equal(end, kstMillis('2026-10-09', 0, 0));
  const db = sampleDb('2026-10-08');
  db.TEST01.logs = [
    { studentNo: '3', ts: start },            // 0시 정각 → 포함
    { studentNo: '7', ts: end },              // 다음 날 0시 → 제외
    { studentNo: '4', ts: start - 1 },        // 전날 23:59:59.999 → 제외
  ];
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(db) });
  assert.ok(!r.missing.some((s) => s.no === '3'), '0시 정각 접속은 셈');
  assert.ok(r.missing.some((s) => s.no === '7'), '다음 날 접속은 안 셈');
  assert.ok(r.missing.some((s) => s.no === '4'), '전날 접속은 안 셈 (이날 기록도 없음)');
});

test('항상 제외할 이름은 세지 않음', async () => {
  const r = await buildReport({
    classCode: 'TEST01', now: NOW, excludeNames: ['테스트', '송예준'],
    fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')),
  });
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '7']);
  assert.deepEqual(r.excluded.map((s) => s.name), ['송예준', '테스트']);
  assert.equal(r.total, 16); // 19명 - L27 통과 1 - 제외 2
  assert.equal(r.done, 14);
});

test('L27 통과 점수(216) 미달이나 자유 연습은 통과로 안 봄', async () => {
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.ok(r.missing.some((s) => s.no === '3'));
  assert.ok(r.missing.some((s) => s.no === '7'));
});

test('이름 목록 읽기', () => {
  assert.deepEqual(parseNames('전지현\n테스트, 김민준 # 메모\n\n전지현'), ['전지현', '테스트', '김민준']);
});

test('우리 반 명단 이름이 우선', async () => {
  const r = await buildReport({
    classCode: 'TEST01', now: NOW, roster: [{ no: '3', name: '박도윤(우리반)' }],
    fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')),
  });
  assert.equal(r.missing[0].name, '박도윤(우리반)');
});

test('반 설정의 등교 안 하는 날 반영', async () => {
  const db = sampleDb('2026-10-07');
  db.TEST01.offDays = ['2026-10-08'];
  const r = await buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch(db) });
  assert.equal(r.dateKey, '2026-10-07');
});

test('명단 여러 페이지', async () => {
  const fetch = fakeFirestoreFetch(sampleDb('2026-10-08'), { pageSize: 5 });
  const students = await new MathPracticeClient('TEST01', { fetchImpl: fetch }).fetchStudents();
  assert.equal(students.length, 19);
  assert.equal(students[18].no, '99');
});

test('오류 구분: 없는 반 / 사용량 초과 / 연결 실패', async () => {
  await assert.rejects(buildReport({ classCode: 'NOPE00', now: NOW, fetchImpl: fakeFirestoreFetch({}) }),
    (e) => e instanceof MathError && e.code === 'notfound');
  await assert.rejects(buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: fakeFirestoreFetch({}, { status: 429 }) }),
    (e) => e.code === 'quota' && /오후 4시/.test(e.message));
  await assert.rejects(buildReport({ classCode: 'TEST01', now: NOW, fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    (e) => e.code === 'network');
  await assert.rejects(buildReport({ classCode: '', now: NOW }), (e) => e.code === 'nocode');
});
