/**
 * 左側任務表。
 * 單擊選取、Ctrl+單擊多選、雙擊名稱或工期直接修改、雙擊其他欄位開編輯側欄。
 */
import type { App } from './app';
import { COLUMNS, type ColumnKey } from './state';
import { esc, fmtDate, fmtMoney } from './format';
import { MAX_DURATION } from '../model/types';

const RIGHT: ColumnKey[] = ['duration', 'start', 'finish', 'float', 'lateStart', 'lateFinish', 'baselineFinish', 'variance', 'budget', 'actualCost'];

export function listWidth(app: App) {
  const natural = app.ui.columns.reduce((a, k) => a + COLUMNS[k].width, 0);
  return { natural, actual: app.ui.listWidth ?? natural };
}

function colgroup(cols: ColumnKey[]) {
  return `<colgroup>${cols.map((k) => `<col style="width:${COLUMNS[k].width}px">`).join('')}</colgroup>`;
}

function cell(app: App, key: ColumnKey, id: string): string {
  const { store, ui } = app;
  const t = store.task(id)!;
  const s = store.result.byId[id];
  const cal = store.result.cal;
  const era = ui.era;
  switch (key) {
    case 'wbs': return `<td class="wbs">${s.wbs}</td>`;
    case 'name': {
      const collapsed = ui.collapsed.includes(id);
      const tog = s.isSummary
        ? `<button type="button" class="tog" data-tog="${id}" aria-label="${collapsed ? '展開' : '摺疊'}">${collapsed ? '▶' : '▼'}</button>`
        : `<span class="tog-spacer"></span>`;
      const crit = ui.showCrit && s.critical && !s.isSummary ? '<span class="crit-dot" title="關鍵路徑"></span>' : '';
      const ms = t.milestone ? ' <span class="ms" title="里程碑">◆</span>' : '';
      const order = ui.multi.indexOf(id);
      const badge = order >= 0 && ui.multi.length > 1 ? ` <span class="badge">${order + 1}</span>` : '';
      return `<td class="name" data-col="name"><div class="name-wrap" style="padding-left:${s.depth * 16}px">${tog}${crit}<span class="name-text" title="${esc(t.name)}">${esc(t.name)}</span>${ms}${badge}</div></td>`;
    }
    case 'duration': {
      const days = s.isSummary ? cal.indexOnOrBefore(s.finish) - cal.indexOnOrAfter(s.start) + 1 : t.duration;
      return `<td class="num r" data-col="duration">${t.milestone ? '—' : `${days} 天`}</td>`;
    }
    case 'start': return `<td class="num r">${fmtDate(s.start, era)}</td>`;
    case 'finish': return `<td class="num r">${fmtDate(s.finish, era)}</td>`;
    case 'progress': return `<td><div class="pbar"><i><b class="${s.progress >= 100 ? 'done' : ''}" style="width:${s.progress}%"></b></i><span>${s.progress}%</span></div></td>`;
    case 'float': return `<td class="num r${s.float !== null && s.float <= 0 ? ' bad' : ''}">${s.float ?? '—'}</td>`;
    case 'responsible': return `<td>${esc(t.responsible ?? '')}</td>`;
    case 'lateStart': return `<td class="num r">${s.lateStart ? fmtDate(s.lateStart, era) : '—'}</td>`;
    case 'lateFinish': return `<td class="num r">${s.lateFinish ? fmtDate(s.lateFinish, era) : '—'}</td>`;
    case 'baselineFinish': return `<td class="num r">${fmtDate(s.baselineFinish, era) || '—'}</td>`;
    case 'variance': {
      const v = s.finishVariance;
      return `<td class="num r${v && v > 0 ? ' bad' : ''}">${v === undefined ? '—' : v > 0 ? `+${v}` : v}</td>`;
    }
    case 'budget': return `<td class="num r">${fmtMoney(s.isSummary ? sumOf(app, id, 'budget') : t.budget)}</td>`;
    case 'actualCost': return `<td class="num r">${fmtMoney(s.isSummary ? sumOf(app, id, 'actualCost') : t.actualCost)}</td>`;
  }
}

function sumOf(app: App, id: string, key: 'budget' | 'actualCost'): number {
  return app.store.children(id).reduce((a, k) => a + (app.store.hasChildren(k.id) ? sumOf(app, k.id, key) : k[key] ?? 0), 0);
}

export function renderList(app: App) {
  const { ui, store } = app;
  const cols = ui.columns;
  const { natural, actual } = listWidth(app);
  const list = app.$('list');
  list.style.width = `${actual}px`;
  const tableW = `width:${natural}px`;

  app.$('listHead').innerHTML = `<table style="${tableW}">${colgroup(cols)}<thead><tr>${cols.map((k) =>
    `<th class="${RIGHT.includes(k) ? 'r' : ''}">${COLUMNS[k].label}</th>`).join('')}</tr></thead></table>`;

  const body = app.$('listBody');
  // 正在表格裡直接打字時不要重畫，否則輸入框會被換掉、字會不見（例如手機跳出鍵盤觸發視窗縮放）
  if (body.querySelector('input.inline-edit')) return;
  const scrollTop = body.scrollTop, scrollLeft = body.scrollLeft;
  if (!app.rows.length) {
    body.innerHTML = `<div class="empty">${ui.critOnly ? '目前沒有關鍵路徑任務。' : '還沒有任務。按「＋ 新增任務」開始。'}</div>`;
    return;
  }
  const multi = new Set(ui.multi);
  body.innerHTML = `<table style="${tableW}">${colgroup(cols)}<tbody>${app.rows.map((id) => {
    const s = store.result.byId[id];
    const cls = [s.isSummary ? 'sum' : '', ui.selected === id ? 'sel' : '', multi.has(id) ? 'multi' : ''].join(' ');
    return `<tr data-id="${id}" class="${cls}">${cols.map((k) => cell(app, k, id)).join('')}</tr>`;
  }).join('')}</tbody></table>`;
  body.scrollTop = scrollTop; body.scrollLeft = scrollLeft;
}

/** 在表格中直接編輯名稱或工期 */
export function startInlineEdit(app: App, id: string, col: 'name' | 'duration') {
  const td = app.$('listBody').querySelector<HTMLTableCellElement>(`tr[data-id="${id}"] td[data-col="${col}"]`);
  const t = app.store.task(id);
  if (!td || !t) return;
  if (col === 'duration' && (app.store.hasChildren(id) || t.milestone)) { app.openDrawer(id); return; }
  const input = document.createElement('input');
  input.className = 'inline-edit';
  input.value = col === 'name' ? t.name : String(t.duration);
  if (col === 'duration') { input.type = 'number'; input.min = '0'; input.max = String(MAX_DURATION); input.classList.add('num'); }
  input.setAttribute('aria-label', col === 'name' ? '任務名稱' : '工期（工作天）');
  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    input.classList.remove('inline-edit'); // 編輯結束，允許表格重畫
    const v = input.value.trim();
    if (save && col === 'name' && v && v !== t.name) app.store.updateTask(id, { name: v });
    else if (save && col === 'duration' && v !== '' && Number(v) !== t.duration) app.store.updateTask(id, { duration: Math.max(0, Math.round(Number(v))) });
    else app.render();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}
