import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, setStore } from '../lib/store.js';
import { route } from '../lib/router.js';
import * as data from '../lib/data.js';
import { fakeFirestoreFetch, sampleDb, SAMPLE_NAMES } from './fake-firestore.js';

async function call(method, path, body) {
  const res = await route(new Request(`http://localhost/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

async function setupRoster() {
  const r = await call('PUT', 'roster', { students: SAMPLE_NAMES.map((name, i) => ({ no: String(i + 1), name })) });
  assert.equal(r.status, 200);
  return r.body.roster.students;
}

beforeEach(() => setStore(new MemoryStore()));

test('처음 상태', async () => {
  const r = await call('GET', 'state');
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 0);
  assert.equal(r.body.store, 'memory');
  assert.deepEqual(r.body.roster.students, []);
});

test('rev 가 같으면 changed:false', async () => {
  await setupRoster();
  const full = await call('GET', 'state');
  const again = await call('GET', `state?rev=${full.body.rev}`);
  assert.deepEqual(again.body, { rev: full.body.rev, changed: false, store: 'memory' });
});

test('Vercel rewrite 의 __path 로도 찾아감', async () => {
  const res = await route(new Request('http://localhost/api/index?__path=health'));
  assert.equal(res.status, 200);
});

test('명단 검사: 번호 중복·빈 이름', async () => {
  assert.equal((await call('PUT', 'roster', { students: [{ no: '1', name: 'a' }, { no: '1', name: 'b' }] })).status, 400);
  assert.equal((await call('PUT', 'roster', { students: [{ no: '1', name: '' }] })).status, 400);
});

test('명단을 고쳐도 id 유지', async () => {
  const students = await setupRoster();
  const edited = students.map((s) => (s.no === '1' ? { ...s, name: '새이름' } : s));
  const r = await call('PUT', 'roster', { students: edited });
  assert.equal(r.body.roster.students[0].id, students[0].id);
  assert.equal(r.body.roster.students[0].name, '새이름');
});

test('과제: 만들기 → 체크 → 같은 요청 반복 → 해제 → 이름 바꾸기 → 삭제', async () => {
  const students = await setupRoster();
  const a = (await call('POST', 'assignments', { title: '수학 익힘책 34쪽' })).body.assignment;
  const sid = students[0].id;

  await call('PUT', `assignments/${a.id}/done`, { studentId: sid, done: true });
  await call('PUT', `assignments/${a.id}/done`, { studentId: sid, done: true });
  let st = (await call('GET', 'state')).body;
  assert.deepEqual(Object.keys(st.assignments[0].done), [sid]);

  await call('PUT', `assignments/${a.id}/done`, { studentId: sid, done: false });
  st = (await call('GET', 'state')).body;
  assert.deepEqual(st.assignments[0].done, {});

  await call('PATCH', `assignments/${a.id}`, { title: '받아쓰기' });
  st = (await call('GET', 'state')).body;
  assert.equal(st.assignments[0].title, '받아쓰기');

  assert.equal((await call('DELETE', `assignments/${a.id}`)).status, 200);
  assert.equal((await call('GET', 'state')).body.assignments.length, 0);
  assert.equal((await call('PUT', `assignments/${a.id}/done`, { studentId: sid, done: true })).status, 404);
});

test('두 기기에서 동시에 다른 학생 체크 → 둘 다 남음', async () => {
  const students = await setupRoster();
  const a = (await call('POST', 'assignments', { title: '일기' })).body.assignment;
  await Promise.all(students.map((s) => call('PUT', `assignments/${a.id}/done`, { studentId: s.id, done: true })));
  const st = (await call('GET', 'state')).body;
  assert.equal(Object.keys(st.assignments[0].done).length, 18);
});

test('모두 해제', async () => {
  const students = await setupRoster();
  const a = (await call('POST', 'assignments', { title: '일기' })).body.assignment;
  await call('PUT', `assignments/${a.id}/done`, { studentId: students[2].id, done: true });
  await call('POST', `assignments/${a.id}/reset`);
  assert.deepEqual((await call('GET', 'state')).body.assignments[0].done, {});
});

test('번호 뽑기: 18명 동시에 1~18 → 겹치지 않음, 19번째는 full, 같은 학생 두 번은 already', async () => {
  const students = await setupRoster();
  const d = (await call('POST', 'draws', { title: '10월 자리', min: 1, max: 18 })).body.draw;
  const results = await Promise.all(students.map((s) => call('POST', `draws/${d.id}/pick`, { studentId: s.id })));
  assert.ok(results.every((r) => r.status === 200));
  const numbers = results.map((r) => r.body.number).sort((x, y) => x - y);
  assert.deepEqual(numbers, Array.from({ length: 18 }, (_, i) => i + 1));

  const again = await call('POST', `draws/${d.id}/pick`, { studentId: students[0].id });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already');
  assert.equal(again.body.number, results[0].body.number);

  // 한 명 더 넣으면 남은 번호가 없음
  const more = [...students, { no: '19', name: '전학생' }];
  const added = (await call('PUT', 'roster', { students: more })).body.roster.students.find((s) => s.no === '19');
  const full = await call('POST', `draws/${d.id}/pick`, { studentId: added.id });
  assert.equal(full.status, 409);
  assert.equal(full.body.error, 'full');
  // full 이후에도 그 학생은 나중에 뽑을 수 있어야 함 (임시 표시가 남지 않음)
  await call('DELETE', `draws/${d.id}/picks/1`);
  const retry = await call('POST', `draws/${d.id}/pick`, { studentId: added.id });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.number, 1);
});

test('뽑기 결과 기록: 상태에 이름·번호가 남고, 취소·초기화 가능', async () => {
  const students = await setupRoster();
  const d = (await call('POST', 'draws', { title: '발표 순서', min: 1, max: 100 })).body.draw;
  const p = (await call('POST', `draws/${d.id}/pick`, { studentId: students[4].id })).body;
  let st = (await call('GET', 'state')).body;
  assert.equal(st.draws[0].picks[p.number].name, students[4].name);

  await call('DELETE', `draws/${d.id}/picks/${p.number}`);
  st = (await call('GET', 'state')).body;
  assert.deepEqual(st.draws[0].picks, {});
  assert.equal((await call('POST', `draws/${d.id}/pick`, { studentId: students[4].id })).status, 200);

  await call('POST', `draws/${d.id}/reset`);
  st = (await call('GET', 'state')).body;
  assert.deepEqual(st.draws[0].picks, {});
});

test('뽑기 범위 검사', async () => {
  assert.equal((await call('POST', 'draws', { title: 'x', min: 5, max: 2 })).status, 400);
  assert.equal((await call('POST', 'draws', { title: '', min: 1, max: 2 })).status, 400);
});

test('수학: 반 코드 없으면 nocode, 있으면 결과·캐시, 실패하면 마지막 결과(stale)', async () => {
  await setupRoster();
  assert.equal((await call('GET', 'math')).body.error, 'nocode');
  await call('PUT', 'settings', { mathCode: 'test01' });

  const at = new Date('2026-10-11T00:30:00Z');
  const ok = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r1 = await data.getMath({ fetchImpl: ok, at });
  assert.deepEqual(r1.missing.map((s) => s.no), ['3', '7', '12']);
  assert.equal(r1.cached, false);

  const r2 = await data.getMath({ fetchImpl: ok, at });
  assert.equal(r2.cached, true);
  assert.equal(ok.calls.length, 3); // 반 + 명단 + 기록. 두 번째는 캐시라 호출 없음

  // 설정을 바꾸면 캐시가 지워지고, 이번엔 사용량 초과 → 마지막 결과를 stale 로
  await call('PUT', 'settings', { offDaysText: '2026-10-01' });
  const r3 = await data.getMath({ fetchImpl: fakeFirestoreFetch({}, { status: 429 }), at });
  assert.equal(r3.stale, true);
  assert.equal(r3.error.code, 'quota');
  assert.deepEqual(r3.missing.map((s) => s.no), ['3', '7', '12']);
});

test('설정: 수학 반 코드 형식 검사', async () => {
  assert.equal((await call('PUT', 'settings', { mathCode: '한글' })).status, 400);
  const r = await call('PUT', 'settings', { className: '5학년 4반', mathCode: 'abc123', mathMode: 'challenge' });
  assert.equal(r.body.settings.mathCode, 'ABC123');
  assert.equal(r.body.settings.mathMode, 'challenge');
});

test('백업 내보내기 → 지우기 → 가져오기', async () => {
  const students = await setupRoster();
  const a = (await call('POST', 'assignments', { title: '일기' })).body.assignment;
  await call('PUT', `assignments/${a.id}/done`, { studentId: students[1].id, done: true });
  const d = (await call('POST', 'draws', { title: '자리', min: 1, max: 18 })).body.draw;
  await call('POST', `draws/${d.id}/pick`, { studentId: students[1].id });
  const backup = (await call('GET', 'export')).body;

  setStore(new MemoryStore());
  assert.equal((await call('POST', 'import', { nope: 1 })).status, 400);
  assert.equal((await call('POST', 'import', backup)).status, 200);
  const st = (await call('GET', 'state')).body;
  assert.equal(st.roster.students.length, 18);
  assert.equal(st.roster.students[1].id, students[1].id);
  assert.deepEqual(Object.keys(st.assignments[0].done), [students[1].id]);
  assert.equal(Object.keys(st.draws[0].picks).length, 1);
  // 가져온 뒤에도 같은 학생은 다시 못 뽑음
  assert.equal((await call('POST', `draws/${d.id}/pick`, { studentId: students[1].id })).body.error, 'already');
});
