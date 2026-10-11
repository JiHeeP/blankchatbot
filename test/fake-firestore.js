// 테스트·로컬 개발용 가짜 분수 연산 마스터(Firestore REST).
// fakeFirestoreFetch(db) 는 fetch 처럼 동작한다.

const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const doc = (name, f) => ({ name, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, enc(v)])) });

export const SAMPLE_NAMES = [
  '김민준', '이서연', '박도윤', '최하은', '정시우', '강지유', '조하준', '윤서아', '장은우',
  '임지아', '한유준', '오수아', '서이준', '신하린', '권도현', '황지안', '안시윤', '송예준',
];

/**
 * db = { CODE: { name, offDays: [], students: [{no, name}], results: [{dateKey, studentNo, mode}] } }
 * opts.status 를 주면 그 HTTP 상태로 실패한다 (예: 429). opts.pageSize 로 페이지 나눔 확인.
 */
export function fakeFirestoreFetch(db, opts = {}) {
  const calls = [];
  const fn = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: url.toString(), method });
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    if (opts.status) return reply({ error: { code: opts.status } }, opts.status);

    const m = url.pathname.match(/\/documents\/classes\/([^/:]+)(\/students|:runQuery)?$/);
    if (!m) return reply({ error: 'bad path' }, 400);
    const code = decodeURIComponent(m[1]);
    const cls = db[code];
    if (!cls) return reply({ error: { code: 404 } }, 404);

    if (!m[2]) return reply(doc(`classes/${code}`, { name: cls.name, offDays: cls.offDays || [], archived: false }));

    if (m[2] === '/students') {
      const size = opts.pageSize || Number(url.searchParams.get('pageSize')) || 300;
      const start = Number(url.searchParams.get('pageToken') || 0);
      const page = cls.students.slice(start, start + size);
      const body = { documents: page.map((s) => doc(`classes/${code}/students/${s.no}`, { number: Number(s.no), name: s.name })) };
      if (start + size < cls.students.length) body.nextPageToken = String(start + size);
      return reply(body);
    }

    const q = JSON.parse(init.body);
    const key = q.structuredQuery.where.fieldFilter.value.stringValue;
    const rows = cls.results.filter((r) => r.dateKey === key)
      .map((r, i) => ({ document: doc(`classes/${code}/results/r${i}`, { dateKey: r.dateKey, studentNo: Number(r.studentNo), mode: r.mode || 'practice' }) }));
    return reply(rows.length ? rows : [{ readTime: new Date().toISOString() }]);
  };
  fn.calls = calls;
  return fn;
}

/** 로컬 개발용 샘플 반: 반 코드 TEST01, 이전 등교일 기록에서 3번·7번·12번이 빠짐 */
export function sampleDb(prevDateKey) {
  const students = SAMPLE_NAMES.map((name, i) => ({ no: String(i + 1), name }));
  const results = students
    .filter((s) => !['3', '7', '12'].includes(s.no))
    .map((s) => ({ dateKey: prevDateKey, studentNo: s.no, mode: s.no === '5' ? 'practice' : 'challenge' }));
  return { TEST01: { name: '5학년 4반', offDays: [], students, results } };
}
