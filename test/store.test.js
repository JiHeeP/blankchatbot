// Firestore 저장소 테스트 — Firestore 에뮬레이터가 켜져 있을 때만 돈다.
//   npx firebase emulators:exec --only firestore "npm test"
// FIRESTORE_EMULATOR_HOST 가 없으면 건너뛴다.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../public/js/store.js';
import { fakeFirestoreFetch, sampleDb, SAMPLE_NAMES } from './fake-firestore.js';

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const skip = HOST ? false : 'FIRESTORE_EMULATOR_HOST 가 없어서 건너뜀';

let fs;
let app;
let db;
let n = 0;

before(async () => {
  if (skip) return;
  const { initializeApp } = await import('firebase/app');
  fs = await import('firebase/firestore');
  app = initializeApp({ projectId: 'demo-classroom', apiKey: 'demo' }, `t${Date.now()}`);
  db = fs.getFirestore(app);
  const [h, p] = HOST.split(':');
  fs.connectFirestoreEmulator(db, h, Number(p));
});

after(async () => {
  if (skip) return;
  const { deleteApp } = await import('firebase/app');
  await deleteApp(app);
});

/** 테스트마다 다른 room 을 써서 서로 섞이지 않게 */
function freshStore() {
  n += 1;
  return createStore(fs, db, `test-${process.pid}-${n}`);
}

/** subscribe 로 다음 상태(조건을 만족하는)를 기다린다 */
function waitState(store, pred, ms = 5000) {
  return new Promise((resolve, reject) => {
    let unsub = () => {};
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('상태를 기다리다 시간 초과'));
    }, ms);
    unsub = store.subscribe((state, status) => {
      if (status.ready && pred(state)) {
        clearTimeout(timer);
        queueMicrotask(() => unsub());
        resolve(structuredClone(state));
      }
    });
  });
}

async function withRoster(store) {
  return store.saveRoster(SAMPLE_NAMES.map((name, i) => ({ no: String(i + 1), name })));
}

test('명단 저장 → 구독으로 받음, 고쳐도 id 유지', { skip }, async () => {
  const store = freshStore();
  const roster = await withRoster(store);
  const s1 = await waitState(store, (s) => s.room.roster.length === 18);
  assert.equal(s1.room.roster[0].name, '김민준');
  await store.saveRoster(roster.map((s) => (s.no === '1' ? { ...s, name: '새이름' } : s)));
  const s2 = await waitState(store, (s) => s.room.roster[0].name === '새이름');
  assert.equal(s2.room.roster[0].id, roster[0].id);
});

test('과제: 만들기 → 체크 → 반복 → 해제 → 이름 바꾸기 → 모두 해제 → 삭제', { skip }, async () => {
  const store = freshStore();
  const roster = await withRoster(store);
  const id = await store.createAssignment('수학 익힘책 34쪽');
  await waitState(store, (s) => s.assignments.some((a) => a.id === id));

  await store.setDone(id, roster[0].id, true);
  await store.setDone(id, roster[0].id, true);
  await store.setDone(id, roster[1].id, true);
  let s = await waitState(store, (st) => Object.keys(st.assignments[0].done).length === 2);
  assert.ok(s.assignments[0].done[roster[0].id]);

  await store.setDone(id, roster[0].id, false);
  s = await waitState(store, (st) => Object.keys(st.assignments[0].done).length === 1);
  assert.deepEqual(Object.keys(s.assignments[0].done), [roster[1].id]);

  await store.renameAssignment(id, '받아쓰기');
  await waitState(store, (st) => st.assignments[0].title === '받아쓰기');

  await store.closeAssignment(id);
  let saved = await waitState(store, (st) => Boolean(st.assignments[0].closedAt));
  assert.equal(Object.keys(saved.assignments[0].done).length, 1); // 저장해도 체크는 그대로
  await store.setDone(id, roster[2].id, true); // 저장한 뒤에도 늦게 낸 학생 체크 가능
  await waitState(store, (st) => Object.keys(st.assignments[0].done).length === 2);
  await store.reopenAssignment(id);
  saved = await waitState(store, (st) => !st.assignments[0].closedAt);

  await store.resetAssignment(id);
  await waitState(store, (st) => Object.keys(st.assignments[0].done).length === 0);

  await store.deleteAssignment(id);
  await waitState(store, (st) => st.assignments.length === 0);
});

test('18명이 동시에 체크해도 모두 남음', { skip }, async () => {
  const store = freshStore();
  const roster = await withRoster(store);
  const id = await store.createAssignment('일기');
  await waitState(store, (s) => s.assignments.length === 1);
  await Promise.all(roster.map((st) => store.setDone(id, st.id, true)));
  const s = await waitState(store, (st) => Object.keys(st.assignments[0].done).length === 18);
  assert.equal(Object.keys(s.assignments[0].done).length, 18);
});

test('번호 뽑기: 18명 동시에 1~18 → 겹치지 않음, 같은 학생 두 번은 already, 꽉 차면 full', { skip }, async () => {
  const store = freshStore();
  const roster = await withRoster(store);
  const id = await store.createDraw({ title: '10월 자리', min: 1, max: 18 });
  await waitState(store, (s) => s.draws.length === 1);

  const numbers = await Promise.all(roster.map((st) => store.pick(id, st)));
  assert.deepEqual([...numbers].sort((a, b) => a - b), Array.from({ length: 18 }, (_, i) => i + 1));

  await assert.rejects(store.pick(id, roster[0]), (e) => e.code === 'already' && e.number === numbers[0]);
  await assert.rejects(store.pick(id, { id: 's_99999999', no: '19', name: '전학생' }), (e) => e.code === 'full');

  const s = await waitState(store, (st) => Object.keys(st.draws[0].picks).length === 18);
  assert.equal(s.draws[0].picks[String(numbers[3])].name, roster[3].name);

  await store.cancelPick(id, numbers[3]);
  await waitState(store, (st) => Object.keys(st.draws[0].picks).length === 17);
  assert.equal(await store.pick(id, roster[3]), numbers[3]);

  await store.resetDraw(id);
  await waitState(store, (st) => Object.keys(st.draws[0].picks).length === 0);
});

test('수학: 결과를 room 캐시에 남기고, 실패하면 마지막 결과를 stale 로', { skip }, async () => {
  const store = freshStore();
  await withRoster(store);
  await store.saveSettings({ mathCode: 'test01' });
  const { room } = await waitState(store, (s) => s.room.mathCode === 'TEST01');
  const at = new Date('2026-10-11T00:30:00Z');
  const base = 'http://fake/documents';

  const ok = fakeFirestoreFetch(sampleDb('2026-10-08'));
  const r1 = await store.getMath(room, { fetchImpl: ok, base, at });
  // 기본 제외(전지현·테스트)와 L27 통과(12번)는 빠짐
  assert.deepEqual(r1.missing.map((s) => s.no), ['3', '7']);
  assert.deepEqual(r1.graduated.map((s) => s.no), ['12']);
  assert.deepEqual(r1.excluded.map((s) => s.name), ['테스트']);
  assert.equal(r1.cached, false);

  await new Promise((r) => setTimeout(r, 300)); // 캐시 저장 기다림
  const r2 = await store.getMath(room, { fetchImpl: ok, base, at });
  assert.equal(r2.cached, true);
  assert.equal(ok.calls.length, 4); // 반 + 명단 + 그날 기록 + L27 기록. 두 번째는 캐시라 호출 없음

  const later = new Date(at.getTime() + 11 * 60 * 1000);
  const r3 = await store.getMath(room, { fetchImpl: fakeFirestoreFetch({}, { status: 429 }), base, at: later });
  assert.equal(r3.stale, true);
  assert.equal(r3.error.code, 'quota');

  await assert.rejects(store.getMath({ ...room, mathCode: '' }), (e) => e.code === 'nocode');
});

test('백업 내보내기 → 다른 반에 가져오기', { skip }, async () => {
  const a = freshStore();
  const roster = await withRoster(a);
  const aid = await a.createAssignment('일기');
  await waitState(a, (s) => s.assignments.length === 1);
  await a.setDone(aid, roster[1].id, true);
  const did = await a.createDraw({ title: '자리', min: 1, max: 18 });
  await waitState(a, (s) => s.draws.length === 1);
  await a.pick(did, roster[1]);
  const state = await waitState(a, (s) => Object.keys(s.draws[0]?.picks || {}).length === 1
    && Object.keys(s.assignments[0]?.done || {}).length === 1);
  const backup = JSON.parse(JSON.stringify(a.exportAll(state)));

  const b = freshStore();
  const empty = await waitState(b, () => true);
  await assert.rejects(b.importAll({ nope: 1 }, empty), (e) => e.code === 'invalid');
  await b.importAll(backup, empty);
  const s = await waitState(b, (st) => st.room.roster.length === 18 && st.draws.length === 1 && st.assignments.length === 1);
  assert.equal(s.room.roster[1].id, roster[1].id);
  assert.deepEqual(Object.keys(s.assignments[0].done), [roster[1].id]);
  await assert.rejects(b.pick(did, roster[1]), (e) => e.code === 'already');
});
