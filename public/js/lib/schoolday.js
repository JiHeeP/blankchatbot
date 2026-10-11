// 등교일 계산 (예전 math_alert.py 의 SchoolCalendar 를 옮긴 것)
// - 등교일 = 월~금 - 공휴일(대체공휴일 포함) - 등교 안 하는 날
// - 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다. 계산할 때만 UTC 정오 Date 로 바꿔서
//   서버 시간대(UTC)나 서머타임 때문에 하루가 밀리는 일이 없게 한다.

export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

// 날짜가 고정된 공휴일 — [월-일, 토·일과 겹칠 때 대체공휴일 적용 여부]
const FIXED_HOLIDAYS = [
  ['01-01', false], // 신정
  ['03-01', true],  // 3·1절
  ['05-05', true],  // 어린이날
  ['06-06', false], // 현충일
  ['08-15', true],  // 광복절
  ['10-03', true],  // 개천절
  ['10-09', true],  // 한글날
  ['12-25', true],  // 성탄절
];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function toDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function toKey(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(key, n) {
  return toKey(new Date(toDate(key).getTime() + n * ONE_DAY_MS));
}

export function weekday(key) {
  return toDate(key).getUTCDay(); // 0 = 일요일
}

const holidayCache = new Map();

export function publicHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const days = new Set(FIXED_HOLIDAYS.map(([md]) => `${year}-${md}`));
  for (const [md, substitute] of FIXED_HOLIDAYS) {
    if (!substitute) continue;
    const key = `${year}-${md}`;
    const wd = weekday(key);
    if (wd !== 0 && wd !== 6) continue;
    let s = addDays(key, 1);
    while (weekday(s) === 0 || weekday(s) === 6 || days.has(s)) s = addDays(s, 1);
    days.add(s);
  }
  holidayCache.set(year, days);
  return days;
}

/** '2026-09-01', '2026.9.1', '2026/9/1', '2026년 9월 1일' → 'YYYY-MM-DD'. 못 읽으면 null. */
export function parseDate(text) {
  const m = String(text ?? '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return toKey(date);
}

/** 줄 목록(또는 여러 줄 문자열)에서 날짜만 골라 정렬된 목록으로. '#' 뒤는 메모. */
export function parseOffDays(lines) {
  const list = typeof lines === 'string' ? lines.split(/\r?\n/) : (lines || []);
  const out = new Set();
  for (const raw of list) {
    const line = String(raw).split('#')[0].trim();
    const d = line && parseDate(line);
    if (d) out.add(d);
  }
  return [...out].sort();
}

export class SchoolCalendar {
  constructor(offDays = []) {
    this.offDays = new Set(offDays);
  }

  isSchoolDay(key) {
    const wd = weekday(key);
    return wd !== 0 && wd !== 6
      && !publicHolidays(Number(key.slice(0, 4))).has(key)
      && !this.offDays.has(key);
  }

  /** key 보다 앞선 가장 가까운 등교일 (당일 제외). 없으면 null. */
  prevSchoolDay(key) {
    let d = key;
    for (let i = 0; i < 120; i++) {
      d = addDays(d, -1);
      if (this.isSchoolDay(d)) return d;
    }
    return null;
  }

  /** 등교하지 않는 이유. 등교일이면 ''. */
  whyOff(key) {
    const wd = weekday(key);
    if (wd === 0 || wd === 6) return '주말';
    if (publicHolidays(Number(key.slice(0, 4))).has(key)) return '공휴일';
    if (this.offDays.has(key)) return '등교 안 하는 날';
    return '';
  }
}

/** 'M/D (요일)' */
export function label(key) {
  const d = toDate(key);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAY_KO[d.getUTCDay()]})`;
}

/** 한국 시간 기준 오늘 'YYYY-MM-DD' */
export function todayKST(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** 한국 시간 기준 'HH:MM' */
export function timeKST(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
}
