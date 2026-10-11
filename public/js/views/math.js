// 03 수학 확인: 분수 연산 마스터에서 이전 등교일에 안 한 학생
import { el, onTap } from '../ui.js';
import { todayKST } from '../lib/schoolday.js';

const AUTO_REFRESH_MS = 10 * 60 * 1000;

const m = {
  sig: '',        // 반 코드·기준·쉬는 날이 바뀌면 다시 받아온다
  report: null,
  error: null,
  loading: false,
  loadedAt: 0,
  timer: null,
};

function signature(room) {
  return [room.mathCode, room.mathMode, room.offDaysText, room.roster.map((s) => `${s.no}:${s.name}`).join(',')].join('|');
}

async function load(ctx, refresh = false) {
  if (m.loading) return;
  m.loading = true;
  if (ctx.tab === 'math') ctx.rerender();
  try {
    m.report = await ctx.store.getMath(ctx.state.room, { refresh });
    m.error = null;
  } catch (e) {
    m.error = e;
    if (e.code === 'nocode') m.report = null;
  } finally {
    m.loading = false;
    m.loadedAt = Date.now();
    if (ctx.tab === 'math') ctx.rerender();
  }
}

function schedule(ctx) {
  clearTimeout(m.timer);
  m.timer = setTimeout(() => {
    if (ctx.tab === 'math' && document.visibilityState === 'visible') load(ctx);
    schedule(ctx);
  }, AUTO_REFRESH_MS);
}

export function render(root, ctx, { changedTab } = {}) {
  const { room } = ctx.state;
  if (!room.mathCode) {
    root.replaceChildren(el('div.empty',
      el('p.empty-big', '수학 반 코드가 아직 없어요'),
      el('p', '분수 연산 마스터 교사 화면 위쪽에 있는 반 코드(6글자)를 우리 반 탭에 적어 주세요.'),
      onTap(el('button.btn.primary.btn-xl', { type: 'button' }, '우리 반 탭으로'), () => ctx.go('class'))));
    return;
  }

  const sig = signature(room);
  const stale = Date.now() - m.loadedAt > AUTO_REFRESH_MS;
  if (sig !== m.sig || (changedTab && stale) || (!m.report && !m.error && !m.loading)) {
    if (sig !== m.sig) {
      m.report = null;
      m.error = null;
    }
    m.sig = sig;
    queueMicrotask(() => load(ctx));
    schedule(ctx);
  }

  const r = m.report;
  const refreshBtn = onTap(el('button.btn', { type: 'button', disabled: m.loading }, m.loading ? '확인 중…' : '새로고침'),
    () => load(ctx, true));

  if (!r) {
    const body = m.error
      ? el('div.math-error', el('p.empty-big', '수학 기록을 받아오지 못했어요'), el('p', m.error.message || ''), refreshBtn)
      : el('p.empty-big', '분수 연산 마스터에서 확인하는 중…');
    root.replaceChildren(el('div.empty', body));
    return;
  }

  const title = el('h1.page-title', `${r.dateLabel} 수학 안 한 사람`);
  const names = r.missing.length
    ? el('div.name-chips', r.missing.map((s) => el('span.name-chip', el('small', `${s.no}번`), s.name)))
    : el('p.all-done', '모두 했어요! 🎉');

  const notes = [
    `${r.total}명 중 ${r.done}명 함`,
    r.mode === 'challenge' ? '도전 기록만 셈' : '연습·도전 아무 기록',
    `${r.fetchedDate && r.fetchedDate !== todayKST() ? `${r.fetchedDate.slice(5).replace('-', '/')} ` : ''}${r.fetchedAt} 확인`,
  ];
  const warn = r.stale
    ? el('p.warn', `최신 기록을 못 받아서 ${r.fetchedDate?.slice(5).replace('-', '/')} ${r.fetchedAt}에 받은 내용을 보여 주고 있어요. (${r.error?.message || ''})`)
    : null;
  const offNote = r.todayOff ? el('p.muted', `오늘은 ${r.todayOff}이라 지난 등교일 ${r.dateLabel} 기준이에요.`) : null;

  root.replaceChildren(el('div.page',
    el('div.page-head', title, refreshBtn),
    el('div.card.math-card', names),
    el('p.muted.math-notes', notes.join(' · ')),
    warn, offNote,
    el('p.muted.small', '설날·추석·재량휴업일처럼 해마다 바뀌는 쉬는 날은 우리 반 탭의 "등교 안 하는 날"에 적어 주세요.')));
}

export function leave() {
  clearTimeout(m.timer);
}
