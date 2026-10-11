import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, MathError, MathPracticeClient } from '../lib/mathpractice.js';
import { fakeFirestoreFetch, sampleDb } from './fake-firestore.js';

// 한국 시간 2026-10-11(일) 오전 → 이전 등교일 10/8(목)
const NOW = new Date('2026-10-11T00:30:00Z');

test('이전 등교일에 안 한 학생', async () => {
  const r = await buildReport({ classCode: 'test01', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.equal(r.classCode, 'TEST01');
  assert.equal(r.dateKey, '2026-10-08');
  assert.equal(r.dateLabel, '10/8 (목)');
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '7', '12']);
  assert.equal(r.total, 18);
  assert.equal(r.done, 15);
  assert.equal(r.todayOff, '주말');
});

test('도전 기록만 세기', async () => {
  const r = await buildReport({ classCode: 'TEST01', mode: 'challenge', now: NOW, fetchImpl: fakeFirestoreFetch(sampleDb('2026-10-08')) });
  assert.deepEqual(r.missing.map((s) => s.no), ['3', '5', '7', '12']);
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
  const students = await new MathPracticeClient('TEST01', fetch).fetchStudents();
  assert.equal(students.length, 18);
  assert.equal(students[17].no, '18');
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
