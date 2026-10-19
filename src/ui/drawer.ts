/**
 * 任務編輯側欄。
 * 每個欄位改完（離開欄位或按 Enter）就立刻存檔並重算排程。
 */
import type { App } from './app';
import type { RelType, Task } from '../model/types';
import { esc, fmtDate, REL_LABEL } from './format';

let lastError = '';

export function renderDrawer(app: App) {
  const el = app.$('drawer');
  const id = app.ui.selected;
  const t = id ? app.store.task(id) : undefined;
  if (!app.ui.drawerOpen || !t || !id) { el.hidden = true; el.innerHTML = ''; return; }

  // 重畫前記住游標所在欄位，重畫後放回去，打字才不會被打斷
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active && el.contains(active) ? active.dataset.f : undefined;

  const { store, ui } = app;
  const s = store.result.byId[id];
  const era = ui.era;
  const cal = store.result.cal;
  const isSum = s.isSummary;

  const dl = (pairs: [string, string, string?][]) =>
    `<dl class="calc">${pairs.map(([k, v, c]) => `<dt>${k}</dt><dd class="${c ?? ''}">${v}</dd>`).join('')}</dl>`;

  const calc = dl([
    ['最早開始', fmtDate(s.start, era)],
    ['最早完成', fmtDate(s.finish, era)],
    ['最晚開始', s.ls !== null ? fmtDate(cal.dateOf(s.ls), era) : '—'],
    ['最晚完成', s.lf !== null ? fmtDate(cal.dateOf(Math.max(s.ls ?? s.lf, s.lf - 1)), era) : '—'],
    ['總浮時', s.float === null ? '—' : `${s.float} 天`, s.critical ? 'crit' : ''],
    ['剩餘工期', `${s.remaining} 天`],
    ...(s.baselineFinish ? [
      ['基準完成', fmtDate(s.baselineFinish, era)],
      ['完成差異', s.finishVariance ? (s.finishVariance > 0 ? `晚 ${s.finishVariance} 天` : `早 ${-s.finishVariance} 天`) : '如期', (s.finishVariance ?? 0) > 0 ? 'crit' : ''],
    ] as [string, string, string][] : []),
  ]);

  let main = '';
  if (isSum) {
    main = `<section><p class="note">這是摘要任務，日期與進度由底下的子任務自動計算。要修改工期或前置關係，請編輯子任務。</p></section>
      <section><h3>排程結果</h3>${calc}</section>
      <section><h3>備註</h3><div class="field full"><textarea data-f="notes" aria-label="備註">${esc(t.notes ?? '')}</textarea></div></section>`;
  } else {
    const owners = [...new Set(store.project.tasks.map((x) => x.responsible).filter(Boolean))] as string[];
    const preds = t.preds.map((p) => {
      const pt = store.task(p.id);
      const ps = store.result.byId[p.id];
      return `<div class="pred-row" data-pred="${esc(p.id)}">
        <span class="nm" title="${esc(pt?.name)}"><span class="w">${esc(ps?.wbs ?? '?')}</span>${esc(pt?.name ?? '（已刪除）')}</span>
        <select data-f="ptype-${esc(p.id)}" data-ptype aria-label="關係類型">${(['FS', 'SS', 'FF', 'SF'] as RelType[]).map((k) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${REL_LABEL[k]}</option>`).join('')}</select>
        <input type="number" class="num" data-f="plag-${esc(p.id)}" data-plag value="${p.lag}" title="延後（正）或提前（負）幾個工作天" aria-label="Lag">
        <button type="button" data-premove title="移除這個關係" aria-label="移除">✕</button>
      </div>`;
    }).join('');
    const candidates = store.project.tasks.filter((x) => !store.predProblem(id, x.id));
    const options = candidates.map((x) => `<option value="${esc(x.id)}">${esc(store.result.byId[x.id].wbs)} ${esc(x.name)}</option>`).join('');
    const succs = store.successors(id).map(({ task: st }) => `<button type="button" class="chip" data-goto="${esc(st.id)}">${esc(store.result.byId[st.id].wbs)} ${esc(st.name)}</button>`).join('');

    main = `
      <section class="fgrid">
        <label class="field"><span>工期（工作天）</span><input type="number" min="0" class="num" data-f="duration" value="${t.duration}" ${t.milestone ? 'disabled' : ''}></label>
        <div class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" data-f="milestone" ${t.milestone ? 'checked' : ''}> 設為里程碑</label></div>
        <div class="field full"><span>完成進度</span>
          <div class="prog-row"><input type="range" min="0" max="100" step="5" data-f="progressRange" value="${t.progress}" aria-label="完成進度"><input type="number" min="0" max="100" class="num" data-f="progress" value="${t.progress}" aria-label="完成進度百分比"></div>
        </div>
        <label class="field"><span>實際開始</span><input type="date" data-f="actualStart" value="${t.actualStart ?? ''}"></label>
        <label class="field"><span>實際完成</span><input type="date" data-f="actualFinish" value="${t.actualFinish ?? ''}"></label>
        <label class="field full"><span>不得早於此日開始（選填）</span><input type="date" data-f="notEarlierThan" value="${t.notEarlierThan ?? ''}"><span class="hint">例如要等建照核發、材料進場才能開始。</span></label>
      </section>
      <section><h3>排程結果</h3>${calc}</section>
      <section>
        <h3>前置任務（要等誰）</h3>
        <div class="preds">${preds || '<p class="note">沒有前置任務，會從專案開始日或資料日期開始。</p>'}
          <div class="pred-add"><select data-f="newPred" aria-label="選擇前置任務"><option value="">＋ 加入前置任務…</option>${options}</select></div>
          <div class="err-text">${esc(lastError)}</div>
        </div>
      </section>
      <section><h3>後續任務（誰在等它）</h3><div class="succ-list">${succs || '<p class="note">沒有。</p>'}</div></section>
      <section class="fgrid">
        <label class="field full"><span>負責人</span><input data-f="responsible" list="ownerList" value="${esc(t.responsible ?? '')}"><datalist id="ownerList">${owners.map((o) => `<option value="${esc(o)}">`).join('')}</datalist></label>
        <label class="field"><span>預算（元）</span><input type="number" min="0" class="num" data-f="budget" value="${t.budget ?? ''}"></label>
        <label class="field"><span>實際成本（元）</span><input type="number" min="0" class="num" data-f="actualCost" value="${t.actualCost ?? ''}"></label>
        <label class="field full"><span>備註</span><textarea data-f="notes">${esc(t.notes ?? '')}</textarea></label>
      </section>`;
  }

  el.innerHTML = `<header><span class="wbs">${esc(s.wbs)}</span><input data-f="name" value="${esc(t.name)}" aria-label="任務名稱"><button type="button" class="x" data-close title="關閉（Esc）" aria-label="關閉">✕</button></header>
    <div class="body">${main}
      <section><button type="button" class="btn danger" data-delete>刪除這個任務${isSum ? '（含所有子任務）' : ''}</button></section>
    </div>`;
  el.hidden = false;
  lastError = '';

  if (focusKey) el.querySelector<HTMLElement>(`[data-f="${focusKey}"]`)?.focus();
}

/** 側欄的事件只綁一次，用事件委派處理每次重畫後的新元素 */
export function bindDrawer(app: App) {
  const el = app.$('drawer');
  const current = () => app.ui.selected!;
  const update = (patch: Partial<Task>) => app.store.updateTask(current(), patch);

  el.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const f = target.dataset.f ?? '';
    const v = target.value;
    const t = app.store.task(current());
    if (!t) return;
    if (f === 'name') { if (v.trim()) update({ name: v.trim() }); }
    else if (f === 'duration') update({ duration: Number(v) });
    else if (f === 'milestone') update({ milestone: (target as HTMLInputElement).checked, duration: (target as HTMLInputElement).checked ? 0 : (t.duration || 1) });
    else if (f === 'progress' || f === 'progressRange') {
      const p = Number(v);
      const patch: Partial<Task> = { progress: p };
      // 進度從 0 變成大於 0 時，若沒填實際開始，就用排程的開始日；到 100% 時補上實際完成
      const s = app.store.result.byId[t.id];
      if (p > 0 && !t.actualStart) patch.actualStart = s.start <= app.store.project.dataDate ? s.start : app.store.project.dataDate;
      if (p >= 100 && !t.actualFinish) patch.actualFinish = s.finish <= app.store.project.dataDate ? s.finish : app.store.project.dataDate;
      if (p < 100) patch.actualFinish = undefined;
      if (p === 0) patch.actualStart = undefined;
      update(patch);
    }
    else if (f === 'actualStart' || f === 'actualFinish' || f === 'notEarlierThan') {
      const patch: Partial<Task> = { [f]: v || undefined };
      if (f === 'actualFinish' && v) patch.progress = 100;
      if (f === 'actualStart' && v && t.progress === 0) patch.progress = 1;
      update(patch);
    }
    else if (f === 'responsible') update({ responsible: v.trim() || undefined });
    else if (f === 'budget' || f === 'actualCost') update({ [f]: v === '' ? undefined : Math.max(0, Number(v)) });
    else if (f === 'notes') update({ notes: v || undefined });
    else if (f === 'newPred' && v) {
      lastError = app.store.addPred(current(), v) ?? '';
      if (lastError) app.render();
    }
    else if ('ptype' in target.dataset) {
      const pid = target.closest<HTMLElement>('[data-pred]')!.dataset.pred!;
      app.store.updatePred(current(), pid, { type: v as RelType });
    }
    else if ('plag' in target.dataset) {
      const pid = target.closest<HTMLElement>('[data-pred]')!.dataset.pred!;
      app.store.updatePred(current(), pid, { lag: Number(v) });
    }
  });

  // 拉進度條時即時顯示數字
  el.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.dataset.f === 'progressRange') {
      const n = el.querySelector<HTMLInputElement>('[data-f="progress"]');
      if (n) n.value = target.value;
    }
  });

  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') app.closeDrawer();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') (e.target as HTMLInputElement).blur();
  });

  el.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-close]')) app.closeDrawer();
    const go = target.closest<HTMLElement>('[data-goto]');
    if (go) app.openDrawer(go.dataset.goto);
    if (target.closest('[data-premove]')) {
      const pid = target.closest<HTMLElement>('[data-pred]')!.dataset.pred!;
      app.store.removePred(current(), pid);
    }
    if (target.closest('[data-delete]')) {
      const t = app.store.task(current());
      if (!t) return;
      app.store.deleteTasks([t.id]);
      app.ui.drawerOpen = false;
      app.toast(`已刪除「${t.name}」，按 Ctrl+Z 可復原`);
    }
  });
}
