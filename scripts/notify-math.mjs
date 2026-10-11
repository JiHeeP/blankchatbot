// 수학 미실시 학생을 카카오톡 나와의 채팅으로 보낸다.
//
//   node scripts/notify-math.mjs --dry-run      카카오톡은 안 보내고 내용만 확인 (연습)
//   node scripts/notify-math.mjs --force        주말·공휴일이어도 보냄 (시험용)
//   node scripts/notify-math.mjs --room 5-3     다른 반(room)
//
// 필요한 값(환경 변수 — GitHub Secrets 에 넣음): KAKAO_REST_API_KEY, KAKAO_CLIENT_SECRET,
// KAKAO_REFRESH_TOKEN, (선택) SITE_URL
// GitHub Actions 에서는 로그가 공개라서 학생 이름은 출력하지 않는다.

import { firebaseConfig } from '../public/js/firebase-config.js';
import { runNotify } from './notify-lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const inCI = Boolean(process.env.GITHUB_ACTIONS);
const log = (m) => console.log(m);

try {
  const result = await runNotify({
    config: firebaseConfig,
    room: option('--room', 'main'),
    env: process.env,
    dryRun: flag('--dry-run'),
    force: flag('--force'),
    log,
  });
  if (result.status === 'skipped') {
    log(`보내지 않았어요: ${result.reason}`);
  } else if (result.status === 'dry-run') {
    log(inCI ? '(공개 로그라서 내용은 출력하지 않아요)' : `\n--- 보낼 내용 ---\n${result.text}\n-----------------`);
  } else {
    log(`카카오톡을 보냈어요 (안 한 학생 ${result.count}명)`);
  }
} catch (e) {
  console.error(`실패: ${e.message}`);
  process.exit(1);
}
