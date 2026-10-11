// /api/* 요청 처리. Vercel 함수(api/index.js)와 로컬 개발 서버(dev-server.js)가 같이 쓴다.
// Request → Response (웹 표준)

import * as data from './data.js';
import { getStore } from './store.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// [메서드, 경로 패턴, 처리 함수(params, req, url)]
const routes = [
  ['GET', 'health', async () => ({ ok: true, store: getStore().kind })],
  ['GET', 'state', async (_p, _r, url) => data.getState(url.searchParams.get('rev'))],

  ['PUT', 'roster', async (_p, req) => data.putRoster((await body(req)).students)],
  ['PUT', 'settings', async (_p, req) => data.putSettings(await body(req))],

  ['POST', 'assignments', async (_p, req) => data.createAssignment((await body(req)).title)],
  ['PATCH', 'assignments/:id', async (p, req) => data.renameAssignment(p.id, (await body(req)).title)],
  ['DELETE', 'assignments/:id', async (p) => data.deleteAssignment(p.id)],
  ['PUT', 'assignments/:id/done', async (p, req) => {
    const b = await body(req);
    return data.setDone(p.id, b.studentId, Boolean(b.done));
  }],
  ['POST', 'assignments/:id/reset', async (p) => data.resetAssignment(p.id)],

  ['POST', 'draws', async (_p, req) => data.createDraw(await body(req))],
  ['PATCH', 'draws/:id', async (p, req) => data.renameDraw(p.id, (await body(req)).title)],
  ['DELETE', 'draws/:id', async (p) => data.deleteDraw(p.id)],
  ['POST', 'draws/:id/pick', async (p, req) => data.pick(p.id, (await body(req)).studentId)],
  ['DELETE', 'draws/:id/picks/:number', async (p) => data.cancelPick(p.id, p.number)],
  ['POST', 'draws/:id/reset', async (p) => data.resetDraw(p.id)],

  ['GET', 'math', async (_p, _r, url) => data.getMath({ refresh: url.searchParams.get('refresh') === '1' })],
  ['GET', 'math/students', async (_p, _r, url) => data.mathStudents(url.searchParams.get('code'))],

  ['GET', 'export', async () => data.exportAll()],
  ['POST', 'import', async (_p, req) => data.importAll(await body(req))],
];

function match(pattern, path) {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** 요청 경로에서 '/api/' 뒤 부분. Vercel rewrite 는 원래 경로를 __path 로도 넘겨 준다. */
export function apiPath(url) {
  const fromRewrite = url.searchParams.get('__path');
  const raw = fromRewrite ?? url.pathname.replace(/^\/api\/?/, '');
  return raw.replace(/^\/+|\/+$/g, '');
}

export async function route(req) {
  const url = new URL(req.url, 'http://localhost');
  const path = apiPath(url);
  let pathMatched = false;
  for (const [method, pattern, handler] of routes) {
    const params = match(pattern, path);
    if (!params) continue;
    pathMatched = true;
    if (method !== req.method) continue;
    try {
      return json(await handler(params, req, url));
    } catch (e) {
      if (e instanceof data.AppError) {
        return json({ error: e.code, message: e.message, ...e.extra }, e.status);
      }
      console.error('API 오류', req.method, path, e);
      return json({ error: 'server', message: '서버에서 오류가 났어요. 잠시 뒤 다시 해 주세요.' }, 500);
    }
  }
  return pathMatched
    ? json({ error: 'method', message: '허용되지 않은 요청이에요' }, 405)
    : json({ error: 'notfound', message: '없는 주소예요' }, 404);
}
