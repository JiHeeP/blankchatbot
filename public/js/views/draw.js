// 02 번호 뽑기: 학생이 자기 이름을 누르면 남은 번호 중 하나가 뽑히고 자동으로 기록된다
import { el, onTap, formBox, confirmBox, menuBox, toast } from '../ui.js';
import { sortByNo, AppError } from '../lib/model.js';
import { noRoster, chipBar } from './common.js';

const REVEAL_MS = 2000;
let cancelMode = false;
let overlayOpen = false;

async function newDraw(ctx, count) {
  const v = await formBox('새 번호 뽑기', [
    { name: 'title', label: '이름', placeholder: '예: 10월 자리, 발표 순서' },
    {
      name: 'range', label: '번호 범위', value: 'class',
      options: [['class', `1 ~ ${count} (우리 반 인원)`], ['100', '1 ~ 100'], ['custom', '직접 정하기']],
    },
    { name: 'min', label: '시작 번호 (직접 정하기)', type: 'number', value: '1', inputmode: 'numeric', min: 1, max: 999 },
    { name: 'max', label: '끝 번호 (직접 정하기)', type: 'number', value: String(count), inputmode: 'numeric', min: 1, max: 999 },
  ], {
    ok: '만들기',
    validate: (x) => {
      if (!x.title) return '이름을 적어 주세요';
      if (x.range === 'custom') {
        const [lo, hi] = [Number(x.min), Number(x.max)];
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo || hi > 999) return '번호 범위를 확인해 주세요 (1 ~ 999)';
      }
      return '';
    },
  });
  if (!v) return;
  let [min, max] = [1, count];
  if (v.range === '100') max = 100;
  if (v.range === 'custom') [min, max] = [Number(v.min), Number(v.max)];
  if (max - min + 1 < count) toast(`번호가 ${max - min + 1}개라 ${count}명 모두 뽑을 수는 없어요`, 'warn', 5000);
  try {
    const id = await ctx.store.createDraw({ title: v.title, min, max });
    ctx.setPref('draw', id);
    ctx.setPref('drawTab', 'pick');
    ctx.rerender();
  } catch (e) {
    ctx.fail(e);
  }
}

async function drawMenu(ctx, d) {
  const choice = await menuBox(d.title, [
    ['copy', '결과 글자로 복사'],
    ['rename', '이름 바꾸기'],
    ['reset', '전체 다시하기', true],
    ['delete', '이 뽑기 삭제', true],
  ]);
  try {
    if (choice === 'copy') {
      const lines = Object.entries(d.picks).sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([n, p]) => `${n}번 ${p.name}`);
      await navigator.clipboard.writeText(`${d.title}\n${lines.join('\n')}`);
      toast('복사했어요. 원하는 곳에 붙여넣기 하세요.');
    } else if (choice === 'rename') {
      const v = await formBox('이름 바꾸기', [{ name: 'title', label: '이름', value: d.title }],
        { validate: (x) => (!x.title ? '이름을 적어 주세요' : '') });
      if (v) await ctx.store.renameDraw(d.id, v.title);
    } else if (choice === 'reset') {
      if (await confirmBox('전체 다시할까요?', `'${d.title}'에서 뽑은 번호가 모두 지워져요.`, { ok: '다시하기', danger: true })) {
        await ctx.store.resetDraw(d.id);
      }
    } else if (choice === 'delete') {
      if (await confirmBox('이 뽑기를 삭제할까요?', `'${d.title}'와 결과가 모두 사라져요.`, { ok: '삭제', danger: true })) {
        await ctx.store.deleteDraw(d.id);
      }
    }
  } catch (e) {
    ctx.fail(e instanceof Error && e.name === 'NotAllowedError' ? new Error('복사 권한이 없어요') : e);
  }
}

/** 이름을 누르면 전체 화면에 2초 동안 숫자가 돌다가 결과를 보여 준다 */
async function runPick(ctx, d, student) {
  if (overlayOpen) return;
  overlayOpen = true;
  const spin = el('div.reveal-number.spinning', '?');
  const caption = el('p.reveal-caption', '번호를 뽑는 중…');
  const okBtn = el('button.btn.primary.btn-xl', { type: 'button', hidden: true }, '확인');
  const overlay = el('div.reveal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '번호 뽑기' },
    el('div.reveal-box',
      el('p.reveal-name', `${student.name}의 번호는…`),
      spin, caption, okBtn));
  document.getElementById('modal-root').append(overlay);

  const timer = setInterval(() => {
    spin.textContent = String(d.min + Math.floor(Math.random() * (d.max - d.min + 1)));
  }, 70);
  const wait = new Promise((r) => setTimeout(r, REVEAL_MS));

  let number = null;
  let error = null;
  try {
    [number] = await Promise.all([ctx.store.pick(d.id, student), wait]);
  } catch (e) {
    await wait;
    error = e;
  }
  clearInterval(timer);

  if (number != null) {
    spin.textContent = String(number);
    spin.classList.remove('spinning');
    spin.classList.add('done');
    caption.textContent = `${number}번! 자동으로 기록했어요.`;
  } else {
    spin.classList.remove('spinning');
    if (error?.code === 'already') {
      spin.textContent = String(error.number);
      spin.classList.add('already');
      caption.textContent = `이미 ${error.number}번을 뽑았어요`;
    } else {
      spin.textContent = '!';
      spin.classList.add('error');
      caption.textContent = error?.code === 'full' ? '남은 번호가 없어요'
        : error instanceof AppError ? error.message : '뽑지 못했어요. 인터넷 연결을 확인해 주세요.';
    }
  }
  okBtn.hidden = false;
  okBtn.focus();
  await new Promise((resolve) => {
    okBtn.addEventListener('click', resolve, { once: true });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) resolve(); });
  });
  overlay.remove();
  overlayOpen = false;
}

function pickPane(ctx, d, students) {
  const remaining = d.max - d.min + 1 - Object.keys(d.picks).length;
  const drawnCount = students.filter((s) => d.byStudent[s.id] != null).length;
  return el('div.pick-pane',
    el('p.hint', `내 이름을 눌러 번호를 뽑아요 · 뽑은 사람 ${drawnCount} / ${students.length} · 남은 번호 ${remaining}개`),
    el('div.tile-grid.pick-grid', { style: { '--cols': students.length <= 24 ? 6 : 8 } },
      students.map((s) => {
        const mine = d.byStudent[s.id];
        const tile = el(`button.tile${mine != null ? '.picked' : ''}`, { type: 'button', dataset: { sid: s.id } },
          el('span.tile-no', s.no),
          el('span.tile-name', s.name),
          mine != null ? el('span.tile-badge', `${mine}번`) : null);
        onTap(tile, () => {
          if (mine != null) {
            toast(`${s.name}: 이미 ${mine}번을 뽑았어요`);
            return;
          }
          runPick(ctx, d, s);
        }, { key: `pick:${d.id}:${s.id}`, lockMs: 1000 });
        return tile;
      })));
}

function resultPane(ctx, d) {
  const cells = [];
  for (let n = d.min; n <= d.max; n++) {
    const p = d.picks[String(n)];
    const cell = el(`button.result-cell${p ? '.taken' : ''}${cancelMode && p ? '.cancelable' : ''}`, {
      type: 'button', disabled: !(cancelMode && p),
    }, el('span.result-no', `${n}번`), el('span.result-name', p ? p.name : '미추첨'));
    if (cancelMode && p) {
      onTap(cell, async () => {
        if (await confirmBox(`${n}번 취소`, `${p.name} 학생의 ${n}번을 취소할까요? 이 학생은 다시 뽑을 수 있어요.`, { ok: '취소하기', danger: true })) {
          ctx.store.cancelPick(d.id, n).catch((e) => ctx.fail(e));
        }
      });
    }
    cells.push(cell);
  }
  const taken = Object.keys(d.picks).length;
  return el('div.result-pane',
    el('div.result-head',
      el('p.hint', `${d.min} ~ ${d.max}번 중 ${taken}개 뽑음`),
      el('label.switch',
        el('input', {
          type: 'checkbox', checked: cancelMode,
          on: { change: (e) => { cancelMode = e.target.checked; ctx.rerender(); } },
        }),
        el('span', '선생님: 눌러서 취소'))),
    el('div.result-grid', cells));
}

export function render(root, ctx) {
  const { state } = ctx;
  const students = sortByNo(state.room.roster);
  if (!students.length) {
    root.replaceChildren(noRoster(ctx));
    return;
  }
  const list = [...state.draws].reverse();
  const current = list.find((d) => d.id === ctx.prefs.draw) || list[0];
  const bar = chipBar(list, current?.id, (d) => {
    ctx.setPref('draw', d.id);
    ctx.rerender();
  }, '+ 새 뽑기', () => newDraw(ctx, students.length));

  if (!current) {
    root.replaceChildren(el('div.page', bar, el('div.empty',
      el('p.empty-big', '번호 뽑기를 만들어 보세요'),
      el('p', '예: 10월 자리, 발표 순서. 학생이 자기 이름을 누르면 번호가 뽑히고 결과가 자동으로 남아요.'),
      onTap(el('button.btn.primary.btn-xl', { type: 'button' }, '+ 새 뽑기'), () => newDraw(ctx, students.length)))));
    return;
  }

  const sub = ctx.prefs.drawTab === 'result' ? 'result' : 'pick';
  const subTabs = el('div.seg', { role: 'tablist' },
    [['pick', '뽑기'], ['result', '결과']].map(([k, label]) => onTap(el(`button.seg-btn${sub === k ? '.active' : ''}`, {
      type: 'button', role: 'tab', 'aria-selected': String(sub === k),
    }, label), () => {
      ctx.setPref('drawTab', k);
      ctx.rerender();
    })));

  const head = el('div.page-head',
    el('h1.page-title', current.title),
    subTabs,
    onTap(el('button.icon-btn.big', { type: 'button', title: '뽑기 메뉴', 'aria-label': '뽑기 메뉴' }, '⋯'),
      () => drawMenu(ctx, current)));

  root.replaceChildren(el('div.page.page-fill', bar, head,
    sub === 'pick' ? pickPane(ctx, current, students) : resultPane(ctx, current)));
}

export function leave() {
  cancelMode = false;
}
