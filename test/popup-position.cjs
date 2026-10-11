// 팝업 창이 고른 모서리로 자리를 잡는지, 진짜 Chromium '--app' 창으로 확인한다 (Edge 와 같은 엔진).
//   xvfb-run -a -s "-screen 0 1920x1080x24" node test/popup-position.cjs
// 사이트(npm run dev)와 Firestore 에뮬레이터가 켜져 있어야 한다. 창 모양이 있는 환경(xvfb 등)이 필요해서
// npm test 에는 넣지 않았다.

const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SITE = process.env.SITE || 'http://localhost:3000';
const EMU = process.env.EMU || '127.0.0.1:8080';
const W = 560;
const H = 520;
const M = 16;

async function main() {
  const proxyArgs = process.env.HTTPS_PROXY
    ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : [];
  const cases = {
    tr: (sw) => [sw - W - M, M],
    br: (sw, sh) => [sw - W - M, sh - H - M],
    tl: () => [M, M],
    bl: (sw, sh) => [M, sh - H - M],
    c: (sw, sh) => [(sw - W) / 2, (sh - H) / 2],
  };
  let failed = 0;
  for (const [pos, expected] of Object.entries(cases)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-popup-'));
    // 일부러 엉뚱한 크기·자리에서 시작해서, 화면이 스스로 옮기는지 본다
    const url = `${SITE}/?emulator=${EMU}&room=pos${pos}${Date.now()}&popup=1&pos=${pos}`;
    const ctx = await chromium.launchPersistentContext(dir, {
      headless: false, viewport: null,
      args: [`--app=${url}`, '--window-size=900,700', '--window-position=300,200', ...proxyArgs],
    });
    const page = ctx.pages()[0] || await ctx.waitForEvent('page');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => ({
      x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight, sw: screen.availWidth, sh: screen.availHeight,
    }));
    await ctx.close();
    const [ex, ey] = expected(m.sw, m.sh).map(Math.round);
    const ok = m.x === ex && m.y === ey && m.w === W && m.h === H;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${pos}: 창 (${m.x}, ${m.y}) ${m.w}x${m.h}  기대 (${ex}, ${ey}) ${W}x${H}`);
  }
  if (failed) throw new Error(`${failed}개 위치가 맞지 않아요`);
  console.log('모두 통과');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
