// 분수 연산 마스터(mathpractice) 읽기 — 예전 math_alert.py 를 옮긴 것
// mathpractice 의 Firestore 는 반 코드만 알면 명단·기록을 읽을 수 있다 (REST, 키는 공개용 웹 키).
// 브라우저와 Node(테스트) 양쪽에서 동작한다.

import { SchoolCalendar, parseOffDays, todayKST, timeKST, label } from './schoolday.js';

export const DEFAULT_PROJECT_ID = 'mathpractice-1d8f9';
export const DEFAULT_API_KEY = 'AIzaSyD-0OnV9CfNbglUojNh1Sz-WpVzZImereY';
const TIMEOUT_MS = 15000;

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
 * roster 가 있으면 번호가 같은 학생의 이름은 우리 반 명단 이름을 쓴다.
 */
export async function buildReport({ classCode, mode = 'any', offDays = [], roster = [], now = new Date(), fetchImpl, base } = {}) {
  if (!classCode) throw new MathError('nocode', '우리 반 탭에서 수학 반 코드를 먼저 적어 주세요', 400);
  const client = new MathPracticeClient(classCode, { fetchImpl, base });
  const cls = await client.fetchClass();
  const today = todayKST(now);
  const cal = new SchoolCalendar([...offDays, ...cls.offDays]);
  const prev = cal.prevSchoolDay(today);
  if (!prev) throw new MathError('http', '이전 등교일을 찾을 수 없어요');

  const [students, done] = await Promise.all([
    client.fetchStudents(),
    client.fetchDone(prev, mode === 'challenge'),
  ]);
  const nameByNo = new Map(roster.map((s) => [String(s.no), s.name]));
  const missing = students
    .filter((s) => !done.has(s.no))
    .map((s) => ({ no: s.no, name: nameByNo.get(s.no) || s.name }));

  return {
    classCode: client.code,
    className: cls.name,
    dateKey: prev,
    dateLabel: label(prev),
    missing,
    done: students.length - missing.length,
    total: students.length,
    fetchedAt: timeKST(now),
    fetchedDate: today,
    todayOff: cal.whyOff(today),
    mode,
  };
}
