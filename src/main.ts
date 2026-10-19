/** 程式進入點：建立資料倉庫與畫面，並綁定所有按鈕與快捷鍵 */
import './style.css';
import { Store } from './model/store';
import { sampleProject, blankProject } from './model/sample';
import { todayIso } from './model/dates';
import { App } from './ui/app';
import { loadUi, type UiState, type Zoom } from './ui/state';
import { startInlineEdit } from './ui/table';
import { bindGantt, scrollToDate } from './ui/gantt';
import { bindDrawer } from './ui/drawer';
import { openSettings, openColumns, openHelp, exportJson, exportCsv, bindImport } from './ui/dialogs';

const store = new Store();
const app = new App(store, loadUi());

function addTask(asChild: boolean) {
  const sel = app.ui.selected;
  if (app.ui.critOnly) { app.ui.critOnly = false; app.toast('已關閉「只看關鍵路徑」，新任務才看得到'); }
  if (asChild && sel) app.ui.collapsed = app.ui.collapsed.filter((x) => x !== sel);
  const id = store.addTask(sel, asChild);
  app.ui.selected = id;
  app.ui.multi = [];
  app.render();
  startInlineEdit(app, id, 'name');
}

async function deleteSelected() {
  const ids = app.ui.multi.length ? app.ui.multi : app.ui.selected ? [app.ui.selected] : [];
  if (!ids.length) return;
  const names = ids.map((id) => store.task(id)?.name).filter(Boolean);
  const hasKids = ids.some((id) => store.hasChildren(id));
  if (hasKids) {
    const ok = await app.confirm('刪除摘要任務', `「${names.join('、')}」底下的子任務也會一起刪除。刪除後可按復原救回。`, '刪除');
    if (!ok) return;
  }
  // 刪除後選到下一列，方便連續操作
  const idx = app.rows.indexOf(ids[0]);
  store.deleteTasks(ids);
  const rows = app.computeRows();
  app.ui.multi = [];
  app.ui.selected = rows[Math.min(idx, rows.length - 1)] ?? null;
  app.render();
  app.toast(`已刪除 ${names.length > 1 ? `${names.length} 個任務` : `「${names[0]}」`}，按 Ctrl+Z 可復原`);
}

async function replaceWith(kind: 'sample' | 'new') {
  const ok = await app.confirm(kind === 'sample' ? '載入範例專案' : '開新專案',
    '目前的專案會被取代。建議先用「匯出備份檔」存一份；取代後也可以按復原救回。', kind === 'sample' ? '載入範例' : '開新專案');
  if (!ok) return;
  app.ui.selected = null; app.ui.collapsed = []; app.ui.drawerOpen = false;
  store.replaceProject(kind === 'sample' ? sampleProject() : blankProject(todayIso()));
  if (kind === 'new') openSettings(app);
}

const actions: Record<string, () => void> = {
  add: () => addTask(false),
  addChild: () => addTask(true),
  indent: () => app.ui.selected && store.indent(app.ui.selected),
  outdent: () => app.ui.selected && store.outdent(app.ui.selected),
  up: () => app.ui.selected && store.move(app.ui.selected, -1),
  down: () => app.ui.selected && store.move(app.ui.selected, 1),
  delete: () => { void deleteSelected(); },
  edit: () => app.openDrawer(),
  link: () => {
    const err = store.linkChain(app.ui.multi);
    if (err) app.toast(`無法串連：${err}`);
    else { app.toast(`已串連 ${app.ui.multi.length} 個任務`); app.ui.multi = []; app.render(); }
  },
  clearMulti: () => { app.ui.multi = []; app.render(); },
  undo: () => store.undo(),
  redo: () => store.redo(),
  today: () => scrollToDate(app, store.project.dataDate),
  settings: () => openSettings(app),
  columns: () => openColumns(app),
  help: () => openHelp(app),
  exportJson: () => exportJson(app),
  importJson: () => (app.$('fileInput') as HTMLInputElement).click(),
  exportCsv: () => exportCsv(app),
  print: () => window.print(),
  baseline: () => {
    store.saveBaseline();
    app.ui.showBaseline = true;
    app.render();
    app.toast('已把目前排程存為基準線，之後的變動會和它比較');
  },
  clearBaseline: () => { store.clearBaseline(); app.toast('已清除基準線'); },
  sample: () => { void replaceWith('sample'); },
  new: () => { void replaceWith('new'); },
  expandAll: () => { app.ui.collapsed = []; app.render(); },
  collapseAll: () => { app.ui.collapsed = store.project.tasks.filter((t) => store.hasChildren(t.id)).map((t) => t.id); app.render(); },
};

// ---------- 工具列與選單 ----------
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLButtonElement>('[data-act]');
  if (btn && !btn.disabled) {
    actions[btn.dataset.act!]?.();
    btn.closest('details')?.removeAttribute('open');
  }
  const z = target.closest<HTMLButtonElement>('[data-zoom]');
  if (z) {
    // 切換縮放時保持畫面中央的日期不變
    app.ui.zoom = z.dataset.zoom as Zoom;
    app.render();
    scrollToDate(app, store.project.dataDate);
  }
  // 點選單外面就關閉選單
  document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(target)) d.removeAttribute('open'); });
});

document.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.dataset.view) {
    (app.ui as unknown as Record<string, boolean>)[target.dataset.view as keyof UiState] = target.checked;
    app.render();
  }
  if (target.dataset.era) { app.ui.era = target.dataset.era as 'roc' | 'ad'; app.render(); }
});

// ---------- 任務表 ----------
const listBody = app.$('listBody');
listBody.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const tog = target.closest<HTMLElement>('[data-tog]');
  if (tog) {
    const id = tog.dataset.tog!;
    app.ui.collapsed = app.ui.collapsed.includes(id) ? app.ui.collapsed.filter((x) => x !== id) : [...app.ui.collapsed, id];
    app.render();
    return;
  }
  if (target.closest('input')) return;
  const tr = target.closest<HTMLElement>('tr[data-id]');
  // 第一下點擊會重畫表格，所以用 e.detail===2 判斷雙擊，而不是 dblclick 事件
  if (e.detail === 2 && tr) {
    const col = target.closest<HTMLElement>('td')?.dataset.col;
    if (col === 'name' || col === 'duration') startInlineEdit(app, tr.dataset.id!, col);
    else app.openDrawer(tr.dataset.id);
    return;
  }
  app.select(tr?.dataset.id ?? null, e.ctrlKey || e.metaKey);
});

// ---------- 專案名稱 ----------
const h1 = app.$('projName');
const editTitle = () => {
  if (h1.querySelector('input')) return;
  const input = document.createElement('input');
  input.value = store.project.name;
  input.setAttribute('aria-label', '專案名稱');
  h1.textContent = '';
  h1.appendChild(input);
  input.focus(); input.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return; done = true;
    const v = input.value.trim();
    h1.textContent = store.project.name;
    if (save && v && v !== store.project.name) store.updateProject({ name: v });
  };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
};
h1.addEventListener('click', editTitle);
h1.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editTitle(); } });

// ---------- 分隔線拖曳 ----------
const splitter = app.$('splitter');
splitter.addEventListener('pointerdown', (e) => {
  const startX = e.clientX;
  const startW = app.$('list').getBoundingClientRect().width;
  splitter.classList.add('drag');
  splitter.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const max = app.$('board').getBoundingClientRect().width - 160;
    app.ui.listWidth = Math.round(Math.max(160, Math.min(max, startW + ev.clientX - startX)));
    app.$('list').style.width = `${app.ui.listWidth}px`;
  };
  const up = () => {
    splitter.classList.remove('drag');
    splitter.removeEventListener('pointermove', move);
    app.render();
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up, { once: true });
});
splitter.addEventListener('dblclick', () => { app.ui.listWidth = null; app.render(); });

// ---------- 鍵盤快捷鍵 ----------
document.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  // 焦點在按鈕或選單上時，Tab / Enter / 空白鍵交給瀏覽器，鍵盤使用者才能操作工具列
  if (['button', 'summary', 'a'].includes(tag) && ['Tab', 'Enter', ' '].includes(key)) return;
  const sel = app.ui.selected;
  const go = (delta: number) => {
    const i = sel ? app.rows.indexOf(sel) : -1;
    const next = app.rows[Math.max(0, Math.min(app.rows.length - 1, i + delta))];
    if (next) {
      app.select(next);
      listBody.querySelector(`tr[data-id="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  };
  let handled = true;
  if (mod && key.toLowerCase() === 'z' && !e.shiftKey) store.undo();
  else if (mod && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && e.shiftKey))) store.redo();
  else if (key === 'Insert' || (mod && key === 'Enter')) addTask(false);
  else if (key === 'Tab' && sel) { if (e.shiftKey) store.outdent(sel); else store.indent(sel); }
  else if (e.altKey && key === 'ArrowUp' && sel) store.move(sel, -1);
  else if (e.altKey && key === 'ArrowDown' && sel) store.move(sel, 1);
  else if (key === 'ArrowUp') go(-1);
  else if (key === 'ArrowDown') go(1);
  else if (key === 'F2' && sel) startInlineEdit(app, sel, 'name');
  else if (key === 'Enter' && sel) app.openDrawer();
  else if ((key === 'Delete' || key === 'Backspace') && (sel || app.ui.multi.length)) void deleteSelected();
  else if (key === 'Escape') { if (app.ui.drawerOpen) app.closeDrawer(); else if (app.ui.multi.length) actions.clearMulti(); }
  else handled = false;
  if (handled) e.preventDefault();
});

window.addEventListener('resize', () => app.render());

// 任何沒被接住的錯誤都用提示條顯示，而不是默默失敗
window.addEventListener('error', (e) => {
  const msg = e.error instanceof Error ? e.error.message : String(e.message);
  app.toast(/[\u4e00-\u9fff]/.test(msg) ? msg : '發生錯誤，這次修改沒有套用。若持續發生請匯出備份檔並回報。');
});

bindGantt(app);
bindDrawer(app);
bindImport(app);
app.render();
