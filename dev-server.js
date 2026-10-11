// 로컬 개발 서버: public/ 정적 파일 + /api/* (Vercel 과 같은 lib/router.js 사용)
//   npm run dev                       → http://localhost:3000 (메모리 저장소)
//   STORE_FILE=.data/store.json ...   → 끄고 켜도 기록 유지
//   FAKE_MATH=1 ...                   → 가짜 분수 연산 마스터 (반 코드 TEST01)
// Upstash 환경변수를 주면 실제 Redis 에 저장한다.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

if (process.env.FAKE_MATH === '1') {
  const { fakeFirestoreFetch, sampleDb } = await import('./test/fake-firestore.js');
  const { SchoolCalendar, todayKST } = await import('./lib/schoolday.js');
  const prev = new SchoolCalendar().prevSchoolDay(todayKST());
  const fake = fakeFirestoreFetch(sampleDb(prev));
  const realFetch = globalThis.fetch;
  process.env.MATH_FIRESTORE_BASE = 'http://fake-firestore.local/v1/projects/x/databases/(default)/documents';
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    return url.startsWith('http://fake-firestore.local/') ? fake(url, init) : realFetch(input, init);
  };
  console.log(`가짜 분수 연산 마스터 사용: 반 코드 TEST01 (기준일 ${prev})`);
}

const { route } = await import('./lib/router.js');
const { getStore } = await import('./lib/store.js');

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('없는 파일');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(buf);
  });
}

async function serveApi(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
  const response = await route(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/api') {
    serveApi(req, res).catch((e) => {
      console.error(e);
      res.writeHead(500).end();
    });
  } else {
    serveStatic(req, res);
  }
}).listen(PORT, () => {
  console.log(`교실 관리 사이트: http://localhost:${PORT}  (저장소: ${getStore().kind})`);
});
