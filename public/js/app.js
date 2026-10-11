// 교실 관리 사이트 — 화면 전체를 묶는 부분
import { connect } from './firebase.js';
import { createStore } from './store.js';
import { el, toast, storageGet, storageSet } from './ui.js';
import { AppError } from './lib/model.js';
import * as checkView from './views/check.js';
import * as drawView from './views/draw.js';
import * as mathView from './views/math.js';
import * as classView from './views/class.js';
import { renderSetup } from './views/setup.js';

const VIEWS = { check: checkView, draw: drawView, math: mathView, class: classView };
const DEFAULT_TAB = 'check';
// ?popup=1 : 학교 PC 바탕화면 팝업용. 메뉴 없이 수학 확인 화면만 작게 보여 준다.
const POPUP = new URLSearchParams(location.search).has('popup');
if (POPUP) document.body.classList.add('popup');

const viewRoot = document.getElementById('view');
const banner = document.getElementById('banner');
const syncEl = document.getElementById('sync');
const classNameEl = document.getElementById('class-name');

const ctx = {
  store: null,
  state: null,
  status: null,
  room: 'main',
  prefs: storageGet('cr:prefs', {}),
  tab: DEFAULT_TAB,
  setPref(key, value) {
    ctx.prefs[key] = value;
    storageSet('cr:prefs', ctx.prefs);
  },
  go(tab) {
    location.hash = `#${tab}`;
  },
  rerender() {
    render({ force: true });
  },
  /** 저장 실패 알림. AppError 는 그 메시지를, 그 밖은 Firebase 오류를 쉬운 말로. */
  fail(e) {
    console.error(e);
    toast(friendlyError(e), 'error', 5000);
  },
};

function friendlyError(e) {
  if (e instanceof AppError) return e.message;
  if (e?.code === 'permission-denied') return 'Firebase 규칙 때문에 저장하지 못했어요 (README 의 규칙 설정 확인)';
  if (e?.code === 'unavailable') return '인터넷 연결이 필요해요';
  if (e?.code === 'not-found') return '다른 기기에서 지운 항목이에요';
  return '저장하지 못했어요. 잠시 뒤 다시 해 주세요.';
}

function currentTab() {
  if (POPUP) return 'math';
  const t = location.hash.replace('#', '');
  return VIEWS[t] ? t : DEFAULT_TAB;
}

function render({ force = false } = {}) {
  const tab = currentTab();
  const changedTab = tab !== ctx.tab;
  if (changedTab) VIEWS[ctx.tab]?.leave?.(ctx);
  ctx.tab = tab;
  document.querySelectorAll('.tab').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.body.dataset.tab = tab;
  if (!ctx.state) return;
  const view = VIEWS[tab];
  if (!changedTab && !force && view.shouldSkipRender?.(ctx)) return;
  view.render(viewRoot, ctx, { changedTab });
}

function updateBanner() {
  const s = ctx.status || {};
  const msgs = [];
  if (!navigator.onLine) {
    msgs.push(['error', '인터넷 연결이 끊겼어요. 체크한 것은 이 기기에 저장해 두었다가 연결되면 자동으로 올라가요. (번호 뽑기는 연결된 뒤에 해 주세요)']);
  } else if (s.error) {
    msgs.push(['error', `기록을 불러오지 못했어요: ${friendlyError(s.error)}`]);
  }
  banner.replaceChildren(...msgs.map(([kind, text]) => el(`div.banner-item.banner-${kind}`, text)));
  banner.hidden = msgs.length === 0;

  let sync = '';
  if (!navigator.onLine) sync = '오프라인';
  else if (s.pending) sync = '저장 중…';
  else if (s.ready && !s.fromCache) sync = '저장됨';
  syncEl.textContent = sync;
  syncEl.dataset.state = !navigator.onLine ? 'offline' : s.pending ? 'pending' : 'ok';
}

function setupFullscreen() {
  const btn = document.getElementById('fullscreen');
  if (!document.documentElement.requestFullscreen) {
    btn.hidden = true;
    return;
  }
  btn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
}

async function main() {
  setupFullscreen();
  window.addEventListener('online', updateBanner);
  window.addEventListener('offline', updateBanner);
  window.addEventListener('hashchange', () => render());

  let conn;
  try {
    conn = await connect();
  } catch (e) {
    console.error(e);
    viewRoot.replaceChildren(el('div.empty',
      el('h2', 'Firebase 를 불러오지 못했어요'),
      el('p', '인터넷 연결을 확인하고 새로고침해 주세요.'),
      el('button.btn.primary', { type: 'button', on: { click: () => location.reload() } }, '새로고침')));
    return;
  }
  if (!conn.configured) {
    renderSetup(viewRoot);
    return;
  }

  ctx.room = conn.room;
  ctx.store = createStore(conn.fs, conn.db, conn.room);
  ctx.store.onError((e) => ctx.fail(e));
  ctx.store.subscribe((state, status) => {
    ctx.state = state;
    ctx.status = status;
    const name = state.room.className || '우리 반';
    classNameEl.textContent = name;
    document.title = name;
    updateBanner();
    render();
  });
}

main();
