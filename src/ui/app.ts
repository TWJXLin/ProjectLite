/**
 * 畫面總指揮：持有資料倉庫（store）和畫面狀態（ui），
 * 每次資料或選取改變時，依序重畫各區塊。
 */
import type { Store } from '../model/store';
import { type UiState, saveUi } from './state';
import { esc, fmtDate } from './format';
import { renderList } from './table';
import { renderGantt, scrollToDate } from './gantt';
import { renderDrawer } from './drawer';

export const ROW = 36;
export const HEAD = 52;

export class App {
  rows: string[] = [];
  private toastTimer = 0;
  private firstRender = true;

  constructor(public store: Store, public ui: UiState) {
    store.subscribe(() => this.render());
  }

  $(id: string) { return document.getElementById(id)!; }

  /** 目前畫面上看得到的任務（考慮摺疊與只看關鍵路徑） */
  computeRows(): string[] {
    const r = this.store.result;
    const collapsed = new Set(this.ui.collapsed);
    const out: string[] = [];
    const walk = (parent: string | null) => {
      for (const t of this.store.children(parent)) {
        const s = r.byId[t.id];
        if (this.ui.critOnly && !s.critical) continue;
        out.push(t.id);
        if (!collapsed.has(t.id)) walk(t.id);
      }
    };
    walk(null);
    return out;
  }

  render() {
    // 被刪除的任務不能還是選取狀態
    if (this.ui.selected && !this.store.task(this.ui.selected)) { this.ui.selected = null; this.ui.drawerOpen = false; }
    this.ui.multi = this.ui.multi.filter((id) => this.store.task(id));
    this.rows = this.computeRows();
    this.renderHeader();
    this.renderToolbar();
    this.renderNotices();
    renderList(this);
    renderGantt(this);
    renderDrawer(this);
    saveUi(this.ui);
    if (this.firstRender) {
      this.firstRender = false;
      requestAnimationFrame(() => scrollToDate(this, this.store.project.dataDate));
    }
  }

  private renderHeader() {
    const { project, result: r } = this.store;
    const era = this.ui.era;
    const h1 = this.$('projName');
    if (!h1.querySelector('input')) h1.textContent = project.name;
    document.title = `${project.name} · ProjectLite`;

    const ss = this.$('saveStatus');
    ss.className = 'save-status' + (this.store.saveError ? ' err' : '');
    ss.textContent = this.store.saveError ? '無法自動儲存（瀏覽器可能是無痕模式），請記得匯出備份'
      : this.store.lastSaved ? `已自動儲存 ${this.store.lastSaved.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}` : '';

    const leaves = project.tasks.filter((t) => !this.store.hasChildren(t.id));
    const budget = leaves.reduce((a, t) => a + (t.budget ?? 0), 0);
    const cost = leaves.reduce((a, t) => a + (t.actualCost ?? 0), 0);
    const tops = this.store.children(null).map((t) => r.byId[t.id]);
    const variance = tops.length && project.baseline ? Math.max(...tops.map((s) => s.finishVariance ?? 0)) : null;

    const stat = (k: string, v: string, cls = '') => `<div class="stat"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
    let html = stat('開工', fmtDate(r.projectStart, era))
      + stat('預計完工', fmtDate(r.projectFinish, era))
      + stat('總工期', `${r.totalWorkdays}<small>工作天</small>`)
      + `<div class="stat"><span class="k">整體進度</span><span class="v">${r.progress}%</span><span class="meter"><i style="width:${r.progress}%"></i></span></div>`
      + stat('關鍵任務', `${r.criticalCount}<small>項</small>`, r.criticalCount ? 'bad' : '')
      + stat('資料日期', fmtDate(project.dataDate, era));
    if (variance !== null) html += stat('對比基準線', variance > 0 ? `落後 ${variance}<small>工作天</small>` : variance < 0 ? `超前 ${-variance}<small>工作天</small>` : '如期', variance > 0 ? 'bad' : 'good');
    if (budget > 0) html += stat('預算 / 實際', `${(budget / 1e4).toLocaleString('zh-TW', { maximumFractionDigits: 1 })}<small>萬</small> / ${(cost / 1e4).toLocaleString('zh-TW', { maximumFractionDigits: 1 })}<small>萬</small>`);
    this.$('stats').innerHTML = html;
  }

  private renderToolbar() {
    const sel = this.ui.selected;
    const t = sel ? this.store.task(sel) : undefined;
    const sibs = t ? this.store.children(t.parent) : [];
    const i = t ? sibs.indexOf(t) : -1;
    const set = (act: string, enabled: boolean) => {
      const b = document.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
      if (b) b.disabled = !enabled;
    };
    set('addChild', !!t);
    set('indent', !!t && i > 0);
    set('outdent', !!t && t.parent !== null);
    set('up', !!t && i > 0);
    set('down', !!t && i >= 0 && i < sibs.length - 1);
    set('delete', !!t || this.ui.multi.length > 0);
    set('edit', !!t);
    set('link', this.ui.multi.length >= 2);
    set('undo', this.store.canUndo);
    set('redo', this.store.canRedo);
    set('clearBaseline', !!this.store.project.baseline);
    document.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((b) => b.classList.toggle('on', b.dataset.zoom === this.ui.zoom));

    const v = this.ui;
    const chk = (key: keyof UiState, label: string) => `<label><input type="checkbox" data-view="${key}" ${v[key] ? 'checked' : ''}> ${label}</label>`;
    this.$('viewMenu').innerHTML =
      chk('showDeps', '顯示相依線') + chk('showCrit', '標示關鍵路徑') + chk('critOnly', '只看關鍵路徑')
      + chk('showBaseline', '顯示基準線')
      + `<hr><div class="sub">日期格式</div>`
      + `<label><input type="radio" name="era" data-era="roc" ${v.era === 'roc' ? 'checked' : ''}> 民國年</label>`
      + `<label><input type="radio" name="era" data-era="ad" ${v.era === 'ad' ? 'checked' : ''}> 西元年</label>`
      + `<hr><button type="button" data-act="expandAll">全部展開</button><button type="button" data-act="collapseAll">全部摺疊</button>`
      + `<hr><button type="button" data-act="columns">選擇表格欄位…</button>`;
  }

  private renderNotices() {
    const w = this.$('warnings');
    const list = this.store.result.warnings;
    w.hidden = list.length === 0;
    w.innerHTML = list.length ? `<ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

    const cb = this.$('chainBar');
    cb.hidden = this.ui.multi.length < 2;
    if (this.ui.multi.length >= 2) {
      const names = this.ui.multi.map((id) => esc(this.store.task(id)?.name)).join(' → ');
      cb.innerHTML = `<span>已依序選取：${names}</span><button type="button" class="btn primary" data-act="link">串連成「完成→開始」</button><button type="button" class="btn" data-act="clearMulti">取消選取</button>`;
    }
  }

  select(id: string | null, additive = false) {
    if (additive && id) {
      const m = this.ui.multi.length ? [...this.ui.multi] : this.ui.selected ? [this.ui.selected] : [];
      const i = m.indexOf(id);
      if (i >= 0) m.splice(i, 1); else m.push(id);
      this.ui.multi = m;
    } else {
      this.ui.multi = [];
    }
    this.ui.selected = id;
    this.render();
  }

  openDrawer(id?: string) {
    if (id) this.ui.selected = id;
    if (!this.ui.selected) return;
    this.ui.drawerOpen = true;
    this.render();
  }

  closeDrawer() { this.ui.drawerOpen = false; this.render(); }

  toast(msg: string) {
    const t = this.$('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
  }

  /** 網頁內的確認框（不用瀏覽器的 confirm） */
  confirm(title: string, message: string, okLabel = '確定'): Promise<boolean> {
    const dlg = this.$('confirmDlg') as HTMLDialogElement;
    dlg.innerHTML = `<form method="dialog" class="dlg"><h2>${esc(title)}</h2><div class="dlg-body"><p class="note">${esc(message)}</p></div>
      <div class="dlg-foot"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">${esc(okLabel)}</button></div></form>`;
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }
}
