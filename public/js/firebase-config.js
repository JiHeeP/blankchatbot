// ============================================================
//  Firebase 설정값 (README 의 '2. Firebase 만들기' 참고)
//  Firebase 콘솔 → 프로젝트 설정(톱니바퀴) → 내 앱 → 웹 앱 → 'SDK 설정 및 구성'
//  → 'const firebaseConfig = { ... }' 안의 값을 그대로 옮겨 적으세요.
//  이 값들은 사이트에 공개되는 값이라 비밀이 아닙니다.
// ============================================================

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

// 한 Firebase 프로젝트로 반을 여러 개 운영하고 싶으면 반마다 다른 이름을 쓰세요.
// 주소 뒤에 ?room=이름 을 붙여도 됩니다. (예: https://사이트주소/?room=5-4)
export const ROOM = 'main';
