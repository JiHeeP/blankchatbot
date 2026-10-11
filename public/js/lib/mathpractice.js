// 분수 연산 마스터(mathpractice) 읽기 — 예전 math_alert.py 를 옮긴 것
// mathpractice 의 Firestore 는 반 코드만 알면 명단·기록을 읽을 수 있다 (REST, 키는 공개용 웹 키).
// 브라우저와 Node(테스트) 양쪽에서 동작한다.

import { SchoolCalendar, parseOffDays, todayKST, timeKST, label } from './schoolday.js';

export const DEFAULT_PROJECT_ID = 'mathpractice-1d8f9';
export const DEFAULT_API_KEY = 'AIzaSyD-0OnV9CfNbglUojNh1Sz-WpVzZImereY';
const TIMEOUT_MS = 15000;

// 분수 연산 마스터의 마지막 단계와 통과 점수 (mathpractice js/levels.js 기준)
//   L27 만점 220, 허용 오답 2개 × 2점 → 216점 이상이면 '통과'(다음 단계가 열리는 점수와 같은 규칙)
export const FINAL_LEVEL = 'L27';
export const FINAL_PASS_SCORE = 216;

// 수학 확인에서 항상 빼는 이름 (우리 반 탭에서 바꿀 수 있음)
export const DEFAULT_EXCLUDE_TEXT = '전지현\n테스트';

/** 줄·쉼표로 나뉜 이름 목록. '#' 뒤는 메모 */
export function parseNames(text) {
  const out = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    for (const part of line.split('#')[0].split(',')) {
      const name = part.trim();
      if (name) out.add(name);
    }
  }
  return [...out];
}

export class MathError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;     // nocode | notfound | quota | denied | network | http
    this.status = status;
  }
}

export const DEFAULT_BASE = `https://firestore.googleapis.com/v1/projects/${DEFAULT_PROJECT_ID}/databases/(default)/documents`;

/** 오래된 브라우저(전자칠판)에는 AbortSignal.timeout 이 없을 수 있다. */
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  if (typeof AbortController === 'undefined') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** Firestore 값 객체 → JS 값 */
export function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) out[k] = decodeValue(x);
    return out;
  }
  return null;
}

function fields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc?.fields || {})) out[k] = decodeValue(v);
  return out;
}

function numKey(no) {
  const n = Number(no);
  return Number.isInteger(n) ? [0, n] : [1, 0];
}

export function sortByNo(list) {
  return [...list].sort((a, b) => {
    const [ka, kb] = [numKey(a.no), numKey(b.no)];
    return ka[0] - kb[0] || ka[1] - kb[1] || String(a.no).localeCompare(String(b.no));
  });
}

export class MathPracticeClient {
  constructor(classCode, { fetchImpl, base = DEFAULT_BASE, apiKey = DEFAULT_API_KEY } = {}) {
    this.code = String(classCode || '').trim().toUpperCase();
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.base = base;
    this.apiKey = apiKey;
  }

  url(path, params = {}) {
    const q = new URLSearchParams(params);
    if (this.apiKey) q.set('key', this.apiKey);
    const qs = q.toString();
    return `${this.base}/${path}${qs ? `?${qs}` : ''}`;
  }

  async call(path, { body, params } = {}) {
    let res;
    try {
      res = await this.fetch(this.url(path, params), {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: timeoutSignal(TIMEOUT_MS),
      });
    } catch {
      throw new MathError('network', '분수 연산 마스터에 연결하지 못했어요 (인터넷 연결 확인)');
    }
    if (res.status === 404) throw new MathError('notfound', `반 코드 '${this.code}'를 찾을 수 없어요`, 404);
    if (res.status === 429) {
      throw new MathError('quota', '분수 연산 마스터의 오늘 무료 사용량이 끝났어요. 오후 4시 이후 다시 됩니다.', 429);
    }
    if (res.status === 401 || res.status === 403) throw new MathError('denied', '분수 연산 마스터가 접근을 거부했어요', 403);
    if (!res.ok) throw new MathError('http', `분수 연산 마스터 오류 (HTTP ${res.status})`);
    return res.json();
  }

  async fetchClass() {
    const f = fields(await this.call(`classes/${encodeURIComponent(this.code)}`));
    return {
      name: f.name || '',
      archived: Boolean(f.archived),
      offDays: parseOffDays(f.offDays || []),
    };
  }

  async fetchStudents() {
    const out = [];
    let pageToken;
    do {
      const params = { pageSize: '300' };
      if (pageToken) params.pageToken = pageToken;
      const res = await this.call(`classes/${encodeURIComponent(this.code)}/students`, { params });
      for (const doc of res.documents || []) {
        const f = fields(doc);
        const no = String(f.number ?? doc.name.split('/').pop());
        out.push({ no, name: String(f.name || '') });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
    return sortByNo(out);
  }

  /** 마지막 단계(L27) 도전에서 통과 점수를 넘은 학생 번호 Set */
  async fetchFinalPassed() {
    const eq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } });
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'results' }],
        where: { compositeFilter: { op: 'AND', filters: [eq('level', FINAL_LEVEL), eq('mode', 'challenge')] } },
        limit: 5000,
      },
    };
    const rows = await this.call(`classes/${encodeURIComponent(this.code)}:runQuery`, { body });
    const passed = new Set();
    for (const row of rows || []) {
      if (!row.document) continue;
      const f = fields(row.document);
      if (f.studentNo != null && Number(f.score) >= FINAL_PASS_SCORE) passed.add(String(f.studentNo));
    }
    return passed;
  }

  /** dateKey 날짜에 기록이 있는 학생 번호 Set */
  async fetchDone(dateKey, challengeOnly = false) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'results' }],
        where: { fieldFilter: { field: { fieldPath: 'dateKey' }, op: 'EQUAL', value: { stringValue: dateKey } } },
        limit: 5000,
      },
    };
    const rows = await this.call(`classes/${encodeURIComponent(this.code)}:runQuery`, { body });
    const done = new Set();
    for (const row of rows || []) {
      if (!row.document) continue;
      const f = fields(row.document);
      if (challengeOnly && f.mode !== 'challenge') continue;
      if (f.studentNo != null) done.add(String(f.studentNo));
    }
    return done;
  }
}

/**
 * 이전 등교일에 수학을 하지 않은 학생 목록.
 * - roster 가 있으면 번호가 같은 학생의 이름은 우리 반 명단 이름을 쓴다.
 * - 마지막 단계(L27)를 통과한 학생과 excludeNames 에 있는 이름은 세지 않는다.
 */
export async function buildReport({
  classCode, mode = 'any', offDays = [], roster = [], excludeNames = [], now = new Date(), fetchImpl, base,
} = {}) {
  if (!classCode) throw new MathError('nocode', '우리 반 탭에서 수학 반 코드를 먼저 적어 주세요', 400);
  const client = new MathPracticeClient(classCode, { fetchImpl, base });
  const cls = await client.fetchClass();
  const today = todayKST(now);
  const cal = new SchoolCalendar([...offDays, ...cls.offDays]);
  const prev = cal.prevSchoolDay(today);
  if (!prev) throw new MathError('http', '이전 등교일을 찾을 수 없어요');

  const [students, done, finalPassed] = await Promise.all([
    client.fetchStudents(),
    client.fetchDone(prev, mode === 'challenge'),
    client.fetchFinalPassed(),
  ]);
  const nameByNo = new Map(roster.map((s) => [String(s.no), s.name]));
  const excludeSet = new Set(excludeNames.map((n) => String(n).trim()).filter(Boolean));
  const counted = [];
  const graduated = [];
  const excluded = [];
  for (const s of students) {
    const name = nameByNo.get(s.no) || s.name;
    const entry = { no: s.no, name };
    if (excludeSet.has(name) || excludeSet.has(s.name)) excluded.push(entry);
    else if (finalPassed.has(s.no)) graduated.push(entry);
    else counted.push(entry);
  }
  const missing = counted.filter((s) => !done.has(s.no));

  return {
    classCode: client.code,
    className: cls.name,
    dateKey: prev,
    dateLabel: label(prev),
    missing,
    done: counted.length - missing.length,
    total: counted.length,
    graduated,
    excluded,
    finalLevel: FINAL_LEVEL,
    fetchedAt: timeKST(now),
    fetchedDate: today,
    todayOff: cal.whyOff(today),
    mode,
  };
}
