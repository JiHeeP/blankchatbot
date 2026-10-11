// 교실 데이터: 명단, 설정, 과제 체크, 번호 뽑기, 수학 확인
// Redis 키 (접두사 cr:)
//   cr:rev                 변경 카운터 — 쓰기마다 +1, 기기들이 이 값으로 바뀐 게 있는지 확인
//   cr:roster              {students:[{id,no,name}], updatedAt}
//   cr:settings            hash: className, mathCode, mathMode, offDaysText
//   cr:asg                 hash: 과제 id → {id,title,createdAt}
//   cr:asg:{id}            hash: 학생 id → 완료 시각 (완료한 학생만 있음)
//   cr:draw                hash: 뽑기 id → {id,title,min,max,createdAt}
//   cr:draw:{id}:n         hash: 번호 → {sid,name,at}
//   cr:draw:{id}:s         hash: 학생 id → 번호
//   cr:math:cache          최근 수학 결과 (10분)
//   cr:math:last           마지막으로 성공한 수학 결과 (인터넷이 안 될 때 보여 줌)

import crypto from 'node:crypto';
import { getStore, hashToObject } from './store.js';
import { buildReport, MathError, MathPracticeClient } from './mathpractice.js';
import { parseOffDays, todayKST } from './schoolday.js';

const K = {
  rev: 'cr:rev',
  roster: 'cr:roster',
  settings: 'cr:settings',
  asg: 'cr:asg',
  asgDone: (id) => `cr:asg:${id}`,
  draw: 'cr:draw',
  drawNums: (id) => `cr:draw:${id}:n`,
  drawStudents: (id) => `cr:draw:${id}:s`,
  mathCache: 'cr:math:cache',
  mathLast: 'cr:math:last',
};

const MATH_CACHE_SEC = 600;
const MATH_REFRESH_MIN_MS = 60 * 1000;
const PENDING = 'pending';

export class AppError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const now = () => new Date().toISOString();
const newId = (prefix) => `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
const parseJSON = (s, fallback = null) => {
  try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; }
};
const cleanText = (s, max = 40) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** 쓰기 명령 묶음 + 변경 카운터 증가를 한꺼번에 실행하고 새 rev 를 돌려준다. */
async function commit(cmds) {
  const store = getStore();
  const res = await store.multi([...cmds, ['INCR', K.rev]]);
  return Number(res[res.length - 1]);
}

// ---------------------------------------------------------------------------
// 읽기
// ---------------------------------------------------------------------------

export async function getRoster() {
  const r = parseJSON(await getStore().cmd(['GET', K.roster]), null);
  return r && Array.isArray(r.students) ? r : { students: [], updatedAt: null };
}

export async function getSettings() {
  const h = hashToObject(await getStore().cmd(['HGETALL', K.settings]));
  return {
    className: h.className || '',
    mathCode: h.mathCode || '',
    mathMode: h.mathMode === 'challenge' ? 'challenge' : 'any',
    offDaysText: h.offDaysText || '',
  };
}

export async function getState(sinceRev) {
  const store = getStore();
  const rev = Number(await store.cmd(['GET', K.rev]) || 0);
  if (sinceRev != null && sinceRev !== '' && Number(sinceRev) === rev) {
    return { rev, changed: false, store: store.kind };
  }

  const [rosterRaw, settingsRaw, asgRaw, drawRaw] = await store.pipeline([
    ['GET', K.roster], ['HGETALL', K.settings], ['HGETALL', K.asg], ['HGETALL', K.draw],
  ]);
  const assignments = Object.values(hashToObject(asgRaw)).map((s) => parseJSON(s)).filter(Boolean)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const draws = Object.values(hashToObject(drawRaw)).map((s) => parseJSON(s)).filter(Boolean)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const detail = await store.pipeline([
    ...assignments.map((a) => ['HGETALL', K.asgDone(a.id)]),
    ...draws.map((d) => ['HGETALL', K.drawNums(d.id)]),
  ]);
  assignments.forEach((a, i) => { a.done = hashToObject(detail[i]); });
  draws.forEach((d, i) => {
    const picks = {};
    for (const [num, v] of Object.entries(hashToObject(detail[assignments.length + i]))) {
      const p = parseJSON(v);
      if (p) picks[num] = p;
    }
    d.picks = picks;
  });

  const roster = parseJSON(rosterRaw, null);
  const s = hashToObject(settingsRaw);
  return {
    rev,
    changed: true,
    store: store.kind,
    roster: roster && Array.isArray(roster.students) ? roster : { students: [], updatedAt: null },
    settings: {
      className: s.className || '',
      mathCode: s.mathCode || '',
      mathMode: s.mathMode === 'challenge' ? 'challenge' : 'any',
      offDaysText: s.offDaysText || '',
    },
    assignments,
    draws,
  };
}

// ---------------------------------------------------------------------------
// 명단·설정
// ---------------------------------------------------------------------------

export function normalizeRoster(input) {
  if (!Array.isArray(input)) throw new AppError('invalid', '명단 형식이 올바르지 않아요');
  const rows = input
    .map((s) => ({ id: cleanText(s?.id, 20), no: cleanText(s?.no, 6), name: cleanText(s?.name, 20) }))
    .filter((s) => s.no || s.name);
  if (rows.length > 60) throw new AppError('invalid', '학생은 60명까지 넣을 수 있어요');
  const seenNo = new Set();
  const seenId = new Set();
  for (const s of rows) {
    if (!s.name) throw new AppError('invalid', `${s.no}번 학생의 이름이 비어 있어요`);
    if (!s.no) throw new AppError('invalid', `${s.name} 학생의 번호가 비어 있어요`);
    if (seenNo.has(s.no)) throw new AppError('invalid', `${s.no}번이 두 번 있어요`);
    seenNo.add(s.no);
    if (!s.id || !/^s_[0-9a-f]{8}$/.test(s.id) || seenId.has(s.id)) s.id = newId('s');
    seenId.add(s.id);
  }
  return rows.sort((a, b) => {
    const [x, y] = [Number(a.no), Number(b.no)];
    return (Number.isNaN(x) ? 1e9 : x) - (Number.isNaN(y) ? 1e9 : y) || a.no.localeCompare(b.no);
  });
}

export async function putRoster(students) {
  const roster = { students: normalizeRoster(students), updatedAt: now() };
  const rev = await commit([['SET', K.roster, JSON.stringify(roster)]]);
  return { rev, roster };
}

export async function putSettings(patch = {}) {
  const fields = [];
  if ('className' in patch) fields.push('className', cleanText(patch.className, 30));
  if ('mathCode' in patch) {
    const code = String(patch.mathCode || '').trim().toUpperCase();
    if (code && !/^[A-Z0-9]{4,12}$/.test(code)) throw new AppError('invalid', '수학 반 코드는 영문·숫자로 적어 주세요 (보통 6글자)');
    fields.push('mathCode', code);
  }
  if ('mathMode' in patch) fields.push('mathMode', patch.mathMode === 'challenge' ? 'challenge' : 'any');
  if ('offDaysText' in patch) fields.push('offDaysText', String(patch.offDaysText || '').slice(0, 5000));
  if (!fields.length) throw new AppError('invalid', '바꿀 설정이 없어요');
  const rev = await commit([['HSET', K.settings, ...fields], ['DEL', K.mathCache]]);
  return { rev, settings: await getSettings() };
}

// ---------------------------------------------------------------------------
// 과제 체크
// ---------------------------------------------------------------------------

async function getAssignment(id) {
  const a = parseJSON(await getStore().cmd(['HGET', K.asg, id]));
  if (!a) throw new AppError('notfound', '과제를 찾을 수 없어요 (다른 기기에서 지웠을 수 있어요)', 404);
  return a;
}

export async function createAssignment(title) {
  const t = cleanText(title);
  if (!t) throw new AppError('invalid', '과제 이름을 적어 주세요');
  const a = { id: newId('a'), title: t, createdAt: now() };
  const rev = await commit([['HSET', K.asg, a.id, JSON.stringify(a)]]);
  return { rev, assignment: { ...a, done: {} } };
}

export async function renameAssignment(id, title) {
  const a = await getAssignment(id);
  const t = cleanText(title);
  if (!t) throw new AppError('invalid', '과제 이름을 적어 주세요');
  const rev = await commit([['HSET', K.asg, id, JSON.stringify({ ...a, title: t })]]);
  return { rev };
}

export async function deleteAssignment(id) {
  await getAssignment(id);
  const rev = await commit([['HDEL', K.asg, id], ['DEL', K.asgDone(id)]]);
  return { rev };
}

export async function setDone(id, studentId, done) {
  await getAssignment(id);
  const sid = cleanText(studentId, 20);
  if (!sid) throw new AppError('invalid', '학생이 지정되지 않았어요');
  const rev = await commit([done ? ['HSET', K.asgDone(id), sid, now()] : ['HDEL', K.asgDone(id), sid]]);
  return { rev };
}

export async function resetAssignment(id) {
  await getAssignment(id);
  const rev = await commit([['DEL', K.asgDone(id)]]);
  return { rev };
}

// ---------------------------------------------------------------------------
// 번호 뽑기
// ---------------------------------------------------------------------------

async function getDraw(id) {
  const d = parseJSON(await getStore().cmd(['HGET', K.draw, id]));
  if (!d) throw new AppError('notfound', '뽑기를 찾을 수 없어요 (다른 기기에서 지웠을 수 있어요)', 404);
  return d;
}

export async function createDraw({ title, min = 1, max } = {}) {
  const t = cleanText(title);
  if (!t) throw new AppError('invalid', '뽑기 이름을 적어 주세요');
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo || hi > 999) {
    throw new AppError('invalid', '번호 범위를 확인해 주세요 (1 ~ 999)');
  }
  const d = { id: newId('d'), title: t, min: lo, max: hi, createdAt: now() };
  const rev = await commit([['HSET', K.draw, d.id, JSON.stringify(d)]]);
  return { rev, draw: { ...d, picks: {} } };
}

export async function renameDraw(id, title) {
  const d = await getDraw(id);
  const t = cleanText(title);
  if (!t) throw new AppError('invalid', '뽑기 이름을 적어 주세요');
  const rev = await commit([['HSET', K.draw, id, JSON.stringify({ ...d, title: t })]]);
  return { rev };
}

export async function deleteDraw(id) {
  await getDraw(id);
  const rev = await commit([['HDEL', K.draw, id], ['DEL', K.drawNums(id)], ['DEL', K.drawStudents(id)]]);
  return { rev };
}

export async function resetDraw(id) {
  await getDraw(id);
  const rev = await commit([['DEL', K.drawNums(id)], ['DEL', K.drawStudents(id)]]);
  return { rev };
}

/** 학생 한 명이 번호를 뽑는다. 번호는 서버가 정하고, 같은 번호·같은 학생 중복은 HSETNX 로 막는다. */
export async function pick(id, studentId, randomInt = crypto.randomInt) {
  const store = getStore();
  const d = await getDraw(id);
  const roster = await getRoster();
  const student = roster.students.find((s) => s.id === studentId);
  if (!student) throw new AppError('invalid', '명단에 없는 학생이에요', 400);

  const claimed = await store.cmd(['HSETNX', K.drawStudents(id), student.id, PENDING]);
  if (!claimed) {
    const number = await store.cmd(['HGET', K.drawStudents(id), student.id]);
    throw new AppError('already', `${student.name} 학생은 이미 뽑았어요`, 409, {
      number: number && number !== PENDING ? Number(number) : null,
    });
  }

  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const taken = new Set(Object.keys(hashToObject(await store.cmd(['HGETALL', K.drawNums(id)]))).map(Number));
      const free = [];
      for (let n = d.min; n <= d.max; n++) if (!taken.has(n)) free.push(n);
      if (!free.length) throw new AppError('full', '남은 번호가 없어요', 409);
      const number = free[randomInt(free.length)];
      const record = JSON.stringify({ sid: student.id, name: student.name, no: student.no, at: now() });
      const ok = await store.cmd(['HSETNX', K.drawNums(id), number, record]);
      if (!ok) continue; // 다른 기기가 같은 번호를 막 가져감 → 다시
      const rev = await commit([['HSET', K.drawStudents(id), student.id, number]]);
      return { rev, number, name: student.name };
    }
    throw new AppError('busy', '동시에 뽑는 사람이 많아요. 다시 눌러 주세요', 409);
  } catch (e) {
    await store.cmd(['HDEL', K.drawStudents(id), student.id]);
    throw e;
  }
}

export async function cancelPick(id, number) {
  await getDraw(id);
  const store = getStore();
  const rec = parseJSON(await store.cmd(['HGET', K.drawNums(id), String(number)]));
  if (!rec) throw new AppError('notfound', `${number}번은 아직 아무도 안 뽑았어요`, 404);
  const rev = await commit([['HDEL', K.drawNums(id), String(number)], ['HDEL', K.drawStudents(id), rec.sid]]);
  return { rev };
}

// ---------------------------------------------------------------------------
// 수학 확인 (분수 연산 마스터)
// ---------------------------------------------------------------------------

function mathSignature(settings, today) {
  return [settings.mathCode, settings.mathMode, settings.offDaysText, today].join('|');
}

export async function getMath({ refresh = false, fetchImpl, at = new Date() } = {}) {
  const store = getStore();
  const [settings, roster] = await Promise.all([getSettings(), getRoster()]);
  if (!settings.mathCode) throw new AppError('nocode', '우리 반 탭에서 수학 반 코드를 먼저 적어 주세요', 400);

  const sig = mathSignature(settings, todayKST(at));
  const cached = parseJSON(await store.cmd(['GET', K.mathCache]));
  const fresh = cached && cached.sig === sig;
  if (fresh && (!refresh || Date.now() - cached.savedAt < MATH_REFRESH_MIN_MS)) {
    return { ...cached.report, cached: true };
  }

  try {
    const report = await buildReport({
      classCode: settings.mathCode,
      mode: settings.mathMode,
      offDays: parseOffDays(settings.offDaysText),
      roster: roster.students,
      now: at,
      fetchImpl,
    });
    const saved = JSON.stringify({ sig, savedAt: Date.now(), report });
    await store.multi([['SET', K.mathCache, saved, 'EX', MATH_CACHE_SEC], ['SET', K.mathLast, saved]]);
    return { ...report, cached: false };
  } catch (e) {
    if (!(e instanceof MathError)) throw e;
    const last = parseJSON(await store.cmd(['GET', K.mathLast]));
    if (last && last.report?.classCode === settings.mathCode) {
      return { ...last.report, stale: true, error: { code: e.code, message: e.message } };
    }
    throw new AppError(e.code, e.message, e.status);
  }
}

export async function mathStudents(code, fetchImpl) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(c)) throw new AppError('invalid', '반 코드를 확인해 주세요');
  const client = new MathPracticeClient(c, fetchImpl);
  try {
    const [cls, students] = await Promise.all([client.fetchClass(), client.fetchStudents()]);
    return { classCode: c, className: cls.name, students };
  } catch (e) {
    if (e instanceof MathError) throw new AppError(e.code, e.message, e.status);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 백업
// ---------------------------------------------------------------------------

export async function exportAll() {
  const s = await getState();
  return {
    app: 'classroom',
    version: 1,
    exportedAt: now(),
    roster: s.roster,
    settings: s.settings,
    assignments: s.assignments,
    draws: s.draws,
  };
}

export async function importAll(data) {
  if (!data || data.app !== 'classroom' || !data.roster) {
    throw new AppError('invalid', '이 사이트에서 내보낸 백업 파일이 아니에요');
  }
  const current = await getState();
  const cmds = [];
  for (const a of current.assignments) cmds.push(['DEL', K.asgDone(a.id)]);
  for (const d of current.draws) cmds.push(['DEL', K.drawNums(d.id)], ['DEL', K.drawStudents(d.id)]);
  cmds.push(['DEL', K.asg], ['DEL', K.draw], ['DEL', K.settings], ['DEL', K.mathCache]);

  const roster = { students: normalizeRoster(data.roster.students || []), updatedAt: now() };
  cmds.push(['SET', K.roster, JSON.stringify(roster)]);
  const st = data.settings || {};
  cmds.push(['HSET', K.settings,
    'className', cleanText(st.className, 30),
    'mathCode', String(st.mathCode || '').toUpperCase(),
    'mathMode', st.mathMode === 'challenge' ? 'challenge' : 'any',
    'offDaysText', String(st.offDaysText || '')]);

  for (const a of data.assignments || []) {
    if (!a?.id || !a.title) continue;
    cmds.push(['HSET', K.asg, a.id, JSON.stringify({ id: a.id, title: cleanText(a.title), createdAt: a.createdAt || now() })]);
    for (const [sid, at] of Object.entries(a.done || {})) cmds.push(['HSET', K.asgDone(a.id), sid, at]);
  }
  for (const d of data.draws || []) {
    if (!d?.id || !d.title) continue;
    cmds.push(['HSET', K.draw, d.id, JSON.stringify({
      id: d.id, title: cleanText(d.title), min: Number(d.min) || 1, max: Number(d.max) || 1, createdAt: d.createdAt || now(),
    })]);
    for (const [num, p] of Object.entries(d.picks || {})) {
      cmds.push(['HSET', K.drawNums(d.id), num, JSON.stringify(p)]);
      if (p?.sid) cmds.push(['HSET', K.drawStudents(d.id), p.sid, num]);
    }
  }
  const rev = await commit(cmds);
  return { rev };
}
