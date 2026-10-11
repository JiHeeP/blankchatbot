// 여러 화면이 같이 쓰는 조각
import { el, onTap } from '../ui.js';

export function noRoster(ctx) {
  return el('div.empty',
    el('p.empty-big', '학생 명단이 아직 없어요'),
    el('p', '우리 반 탭에서 명단을 넣으면 여기에 이름 칸이 생겨요.'),
    onTap(el('button.btn.primary.btn-xl', { type: 'button' }, '명단 넣으러 가기'), () => ctx.go('class')));
}

/** 가로로 넘기는 선택 칩 + 추가 버튼 */
export function chipBar(items, currentId, onPick, addLabel, onAdd) {
  return el('div.chip-bar',
    el('div.chips', { role: 'tablist' },
      items.map((it) => onTap(el(`button.chip${it.id === currentId ? '.active' : ''}`, {
        type: 'button', role: 'tab', 'aria-selected': String(it.id === currentId),
      }, it.title), () => onPick(it)))),
    onTap(el('button.btn.add-btn', { type: 'button' }, addLabel), onAdd));
}
