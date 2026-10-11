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

    // 같음(EQUAL) 조건만, 하나 또는 AND 로 묶인 여러 개
    const q = JSON.parse(init.body).structuredQuery.where;
    const filters = (q.compositeFilter ? q.compositeFilter.filters : [q]).map((f) => f.fieldFilter);
    const full = (r) => ({ level: 'L1', mode: 'practice', score: null, ...r });
    const rows = cls.results.map(full)
      .filter((r) => filters.every((f) => String(r[f.field.fieldPath]) === f.value.stringValue))
      .map((r, i) => ({
        document: doc(`classes/${code}/results/r${i}`, {
          dateKey: r.dateKey, studentNo: String(r.studentNo), mode: r.mode, level: r.level, score: r.score,
        }),
      }));
    return reply(rows.length ? rows : [{ readTime: new Date().toISOString() }]);
  };
  fn.calls = calls;
  return fn;
}

/**
 * 로컬 개발용 샘플 반: 반 코드 TEST01 (18명 + '테스트' 99번)
 * - 이전 등교일 기록에서 3번·7번·12번·99번이 빠짐
 * - 12번은 예전에 마지막 단계(L27) 통과(218점) → 미실시에서 빠져야 함
 * - 3번은 L27 을 했지만 통과 점수(216) 미달(200점) → 미실시에 남아야 함
 */
export function sampleDb(prevDateKey) {
  const students = [...SAMPLE_NAMES.map((name, i) => ({ no: String(i + 1), name })), { no: '99', name: '테스트' }];
  const results = students
    .filter((s) => !['3', '7', '12', '99'].includes(s.no))
    .map((s) => ({ dateKey: prevDateKey, studentNo: s.no, mode: s.no === '5' ? 'free' : 'challenge', level: 'L3', score: 100 }));
  results.push(
    { dateKey: '2026-09-01', studentNo: '12', mode: 'challenge', level: 'L27', score: 218 },
    { dateKey: '2026-09-01', studentNo: '3', mode: 'challenge', level: 'L27', score: 200 },
    { dateKey: '2026-09-01', studentNo: '7', mode: 'free', level: 'L27', score: null },
  );
  return { TEST01: { name: '5학년 4반', offDays: [], students, results } };
}
