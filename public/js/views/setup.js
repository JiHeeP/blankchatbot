// Firebase 설정값이 비어 있을 때 보여 주는 안내
import { el } from '../ui.js';

export function renderSetup(root) {
  root.replaceChildren(el('div.card.setup',
    el('h2', '처음 설정이 필요해요'),
    el('p', '기록을 저장할 Firebase 프로젝트가 아직 연결되지 않았어요. 한 번만 하면 됩니다.'),
    el('ol.steps',
      el('li', 'console.firebase.google.com 에서 새 프로젝트를 만듭니다.'),
      el('li', 'Firestore Database 를 만들고, 규칙 탭에 저장소의 firestore.rules 내용을 붙여넣어 게시합니다.'),
      el('li', '프로젝트 설정 → 내 앱 → 웹 앱(</>)을 추가하고 나오는 firebaseConfig 값을 복사합니다.'),
      el('li', 'GitHub 저장소의 public/js/firebase-config.js 에 그 값을 붙여넣고 저장(커밋)합니다.'),
      el('li', '1~2분 뒤 이 페이지를 새로고침합니다.')),
    el('p.muted', '자세한 순서는 저장소 README 에 있어요.')));
}
