// 01 과제 체크: 과제마다 학생 이름 칸, 터치하면 완료 / 다시 터치하면 해제
import { el, onTap, formBox, confirmBox, menuBox } from '../ui.js';
import { sortByNo, assignmentSummary } from '../lib/model.js';
import { noRoster, chipBar } from './common.js';

function gridColumns(n) {
  if (n <= 8) return 4;
  if (n <= 15) return 5;
  if (n <= 24) return 6;
  if (n <= 32) return 8;
  return 10;
}

async function newAssignment(ctx) {
  const v = await formBox('새 과제', [
    { name: 'title', label: '과제 이름', placeholder: '예: 수학 익힘책 34쪽' },
  ], { ok: '만들기', validate: (x) => (!x.title ? '과제 이름을 적어 주세요' : '') });
  if (!v) return;
  try {
    const id = await ctx.store.createAssignment(v.title);
    ctx.setPref('assignment', id);
    ctx.rerender();
  } catch (e) {
    ctx.fail(e);
  }
}

async function assignmentMenu(ctx, a) {
  const choice = await menuBox(a.title, [
    ['rename', '이름 바꾸기'],
    ['reset', '체크 모두 지우기'],
    ['delete', '과제 삭제', true],
  ]);
  try {
    if (choice === 'rename') {
      const v = await formBox('과제 이름 바꾸기', [{ name: 'title', label: '과제 이름', value: a.title }],
        { validate: (x) => (!x.title ? '과제 이름을 적어 주세요' : '') });
      if (v) await ctx.store.renameAssignment(a.id, v.title);
    } else if (choice === 'reset') {
      if (await confirmBox('체크를 모두 지울까요?', `'${a.title}'의 완료 표시가 모두 사라져요.`, { ok: '모두 지우기', danger: true })) {
        await ctx.store.resetAssignment(a.id);
      }
    } else if (choice === 'delete') {
      if (await confirmBox('과제를 삭제할까요?', `'${a.title}'와 체크 기록이 모두 사라져요. 되돌릴 수 없어요.`, { ok: '삭제', danger: true })) {
        await ctx.store.deleteAssignment(a.id);
      }
    }
  } catch (e) {
    ctx.fail(e);
  }
}

export function render(root, ctx) {
  const { state } = ctx;
  const students = sortByNo(state.room.roster);
  if (!students.length) {
    root.replaceChildren(noRoster(ctx));
    return;
  }

  const list = [...state.assignments].reverse(); // 최근 과제가 앞에
  const current = list.find((a) => a.id === ctx.prefs.assignment) || list[0];

  const bar = chipBar(list, current?.id, (a) => {
    ctx.setPref('assignment', a.id);
    ctx.rerender();
  }, '+ 새 과제', () => newAssignment(ctx));

  if (!current) {
    root.replaceChildren(el('div.page', bar, el('div.empty',
      el('p.empty-big', '아직 과제가 없어요'),
      onTap(el('button.btn.primary.btn-xl', { type: 'button' }, '+ 과제 만들기'), () => newAssignment(ctx)))));
    return;
  }

  const sum = assignmentSummary(current, students);
  const head = el('div.page-head',
    el('h1.page-title', current.title),
    el('div.count', { class: sum.doneCount === sum.total ? 'all' : '' },
      el('strong', String(sum.doneCount)), ` / ${sum.total} 완료`),
    onTap(el('button.icon-btn.big', { type: 'button', title: '과제 메뉴', 'aria-label': '과제 메뉴' }, '⋯'),
      () => assignmentMenu(ctx, current)));

  const grid = el('div.tile-grid', { style: { '--cols': gridColumns(students.length) } },
    students.map((s) => {
      const done = Boolean(current.done[s.id]);
      const tile = el(`button.tile${done ? '.done' : ''}`, {
        type: 'button',
        'aria-pressed': String(done),
        dataset: { sid: s.id },
      },
      el('span.tile-no', `${s.no}`),
      el('span.tile-name', s.name),
      el('span.tile-mark', { 'aria-hidden': 'true' }, done ? '✓' : ''));
      onTap(tile, () => {
        ctx.store.setDone(current.id, s.id, !done).catch((e) => ctx.fail(e));
      }, { key: `check:${current.id}:${s.id}` });
      return tile;
    }));

  const missingLine = sum.missing.length
    ? el('p.missing', el('span.missing-label', '아직: '), sum.missing.map((s) => `${s.no}번 ${s.name}`).join(' · '))
    : el('p.missing.all', '모두 했어요! 🎉');

  root.replaceChildren(el('div.page.page-fill', bar, head, grid, missingLine));
}
