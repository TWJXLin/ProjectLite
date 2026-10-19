/**
 * 甘特圖（用 SVG 畫）。
 * 表頭與內容分成兩張 SVG：內容可以上下左右捲動，表頭只跟著左右捲動。
 */
import type { App } from './app';
import { ROW, HEAD } from './app';
import { toDayNum, fromDayNum, weekday } from '../model/dates';
import { esc, eraYear, fmtDate, fmtMD, REL_LABEL } from './format';

const PX: Record<string, number> = { day: 30, week: 15, month: 4 };

/** 最近一次繪圖的座標資訊，供捲動定位使用 */
let geo = { lo: 0, px: 15 };

function computeRange(app: App) {
  const { project, result: r } = app.store;
  const dates = [r.projectStart, r.projectFinish, project.start, project.dataDate];
  if (project.baseline) for (const b of Object.values(project.baseline.tasks)) dates.push(b.start, b.finish);
  const nums = dates.map(toDayNum);
  let lo = Math.min(...nums) - 7;
  let hi = Math.max(...nums) + 35;
  if (app.ui.zoom === 'week') lo -= (weekday(lo) + 6) % 7;     // 對齊週一
  if (app.ui.zoom === 'month') {
    const s = fromDayNum(lo); lo = toDayNum(`${s.slice(0, 8)}01`);
    hi += 31;
  }
  return { lo, hi };
}

export function renderGantt(app: App) {
  const { store, ui } = app;
  const { project, result: r } = store;
  const cal = r.cal;
  const px = PX[ui.zoom];
  const { lo, hi } = computeRange(app);
  geo = { lo, px };
  const days = hi - lo + 1;
  const W = days * px;
  const body = app.$('chartBody');
  const H = Math.max(app.rows.length * ROW, body.clientHeight - 2);
  const xOf = (iso: string) => (toDayNum(iso) - lo) * px;
  const era = ui.era;

  // ---------- 表頭 ----------
  let head = '';
  const tier = (unit: 'year' | 'month' | 'week' | 'day', row: 0 | 1) => {
    let out = '';
    let segStart = lo;
    const isBoundary = (n: number) => {
      const d = fromDayNum(n);
      if (unit === 'year') return d.endsWith('-01-01');
      if (unit === 'month') return d.endsWith('-01');
      if (unit === 'week') return weekday(n) === 1;
      return true;
    };
    const label = (n: number, width: number) => {
      const d = fromDayNum(n);
      const [y, m, dd] = d.split('-').map(Number);
      if (unit === 'year') return `${eraYear(y, era)}年`;
      if (unit === 'month') return row === 0 ? `${eraYear(y, era)}年${m}月` : width >= 22 ? `${m}月` : '';
      if (unit === 'week') return fmtMD(d);
      return width >= 16 ? String(dd) : '';
    };
    const y0 = row * 26;
    const flush = (a: number, b: number) => {
      const x0 = (a - lo) * px, w = (b - a) * px;
      out += `<line class="${row === 0 ? 'g-grid-major' : 'g-grid'}" x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0 + 26}"/>`;
      const text = label(a, w);
      if (!text) return;
      const off = unit === 'day' && !cal.isWorkday(fromDayNum(a));
      out += unit === 'day'
        ? `<text class="g-tier2${off ? ' off' : ''}" x="${x0 + w / 2}" y="${y0 + 17}" text-anchor="middle">${text}</text>`
        : `<text class="${row === 0 ? 'g-tier1' : 'g-tier2'}" x="${x0 + 6}" y="${y0 + 17}">${text}</text>`;
    };
    for (let n = lo + 1; n <= hi + 1; n++) {
      if (n === hi + 1 || isBoundary(n)) { flush(segStart, n); segStart = n; }
    }
    return out;
  };
  const [t1, t2] = ui.zoom === 'day' ? ['month', 'day'] : ui.zoom === 'week' ? ['month', 'week'] : ['year', 'month'];
  head += tier(t1 as 'month' | 'year', 0) + tier(t2 as 'day' | 'week' | 'month', 1);
  head += `<line class="g-grid" x1="0" y1="26" x2="${W}" y2="26"/>`;
  app.$('chartHead').innerHTML = `<svg width="${W}" height="${HEAD}" viewBox="0 0 ${W} ${HEAD}" role="img" aria-label="時間刻度">${head}</svg>`;

  // ---------- 內容 ----------
  let g = '';
  // 非工作日底色（連續的合併成一塊）
  let runStart: number | null = null;
  for (let n = lo; n <= hi + 1; n++) {
    const off = n <= hi && !cal.isWorkday(fromDayNum(n));
    if (off && runStart === null) runStart = n;
    if (!off && runStart !== null) {
      g += `<rect class="g-nonwork" x="${(runStart - lo) * px}" y="0" width="${(n - runStart) * px}" height="${H}"/>`;
      runStart = null;
    }
  }
  // 垂直格線
  for (let n = lo; n <= hi; n++) {
    const d = fromDayNum(n);
    const major = ui.zoom === 'month' ? d.endsWith('-01') : weekday(n) === 1;
    if (major || ui.zoom === 'day') g += `<line class="${major && ui.zoom !== 'month' ? 'g-grid' : 'g-grid'}" x1="${(n - lo) * px}" y1="0" x2="${(n - lo) * px}" y2="${H}"/>`;
  }
  // 列線與選取列
  const rowIndex = new Map(app.rows.map((id, i) => [id, i]));
  app.rows.forEach((id, i) => {
    const y = i * ROW;
    if (ui.selected === id || ui.multi.includes(id)) g += `<rect class="g-sel" x="0" y="${y}" width="${W}" height="${ROW}"/>`;
    g += `<line class="g-row" x1="0" y1="${y + ROW}" x2="${W}" y2="${y + ROW}"/>`;
  });
  g += `<rect class="g-hover" id="ganttHover" x="0" y="-100" width="${W}" height="${ROW}"/>`;

  const showBase = ui.showBaseline && !!project.baseline;
  const geom = (id: string) => {
    const s = r.byId[id];
    const t = store.task(id)!;
    const i = rowIndex.get(id)!;
    const cy = i * ROW + ROW / 2;
    if (t.milestone) { const x = xOf(s.finish) + px; return { s, t, i, cy, x0: x, x1: x }; }
    return { s, t, i, cy, x0: xOf(s.start), x1: xOf(s.finish) + px };
  };

  // 基準線（畫在長條下方的細灰條）
  if (showBase) for (const id of app.rows) {
    const s = r.byId[id];
    if (!s.baselineStart || !s.baselineFinish) continue;
    const y = rowIndex.get(id)! * ROW + ROW - 9;
    const bx0 = xOf(s.baselineStart), bx1 = xOf(s.baselineFinish) + px;
    g += `<rect class="g-base" x="${bx0}" y="${y}" width="${Math.max(3, bx1 - bx0)}" height="4" rx="1"/>`;
  }

  // 相依線
  if (ui.showDeps) for (const id of app.rows) {
    const t = store.task(id)!;
    for (const p of t.preds) {
      if (!rowIndex.has(p.id) || store.hasChildren(p.id) || store.hasChildren(id)) continue;
      const a = geom(p.id), b = geom(id);
      const fromFinish = p.type === 'FS' || p.type === 'FF';
      const toStart = p.type === 'FS' || p.type === 'SS';
      const x0 = fromFinish ? a.x1 : a.x0;
      const x1 = toStart ? b.x0 : b.x1;
      const y0 = a.cy, y1 = b.cy;
      const dir = y1 >= y0 ? 1 : -1;
      const ymid = y1 - dir * ROW / 2;
      let d: string;
      if (p.type === 'FS') d = x1 - x0 >= 14 ? `M${x0} ${y0}H${x0 + 7}V${y1}H${x1}` : `M${x0} ${y0}H${x0 + 7}V${ymid}H${x1 - 10}V${y1}H${x1}`;
      else if (p.type === 'SS') { const xm = Math.min(x0, x1) - 8; d = `M${x0} ${y0}H${xm}V${y1}H${x1}`; }
      else if (p.type === 'FF') { const xm = Math.max(x0, x1) + 8; d = `M${x0} ${y0}H${xm}V${y1}H${x1}`; }
      else d = `M${x0} ${y0}H${x0 - 7}V${ymid}H${x1 + 10}V${y1}H${x1}`;
      const crit = ui.showCrit && a.s.critical && b.s.critical ? ' crit' : '';
      const arrow = toStart ? `M${x1 - 6} ${y1 - 4}L${x1} ${y1}L${x1 - 6} ${y1 + 4}Z` : `M${x1 + 6} ${y1 - 4}L${x1} ${y1}L${x1 + 6} ${y1 + 4}Z`;
      g += `<path class="g-dep${crit}" d="${d}"/><path class="g-arrow${crit}" d="${arrow}"/>`;
      if (p.type !== 'FS' || p.lag) {
        const lx = p.type === 'SS' ? Math.min(x0, x1) - 10 : p.type === 'FF' ? Math.max(x0, x1) + 12 : x0 + 10;
        g += `<text class="g-lag" x="${lx}" y="${(y0 + y1) / 2 + 4}" text-anchor="${p.type === 'SS' ? 'end' : 'start'}">${p.type}${p.lag > 0 ? '+' : ''}${p.lag || ''}</text>`;
      }
    }
  }

  // 長條與標籤
  for (const id of app.rows) {
    const { s, t, i, cy, x0, x1 } = geom(id);
    const y = i * ROW;
    const crit = ui.showCrit && s.critical;
    const barY = y + (showBase ? 7 : 9), barH = ROW - 18;
    if (s.isSummary) {
      const w = Math.max(x1 - x0, 6);
      g += `<path class="g-sum" data-id="${id}" d="M${x0} ${cy - 4}H${x0 + w}V${cy + 6}L${x0 + w - 5} ${cy + 1}H${x0 + 5}L${x0} ${cy + 6}Z"/>`;
      g += `<text class="g-label g-dim" x="${x0 + w + 8}" y="${cy + 4}">${s.progress}%</text>`;
    } else if (t.milestone) {
      g += `<path class="g-ms${crit ? ' crit' : ''}" data-id="${id}" d="M${x0} ${cy - 8}L${x0 + 8} ${cy}L${x0} ${cy + 8}L${x0 - 8} ${cy}Z"/>`;
      g += `<text class="g-label" x="${x0 + 14}" y="${cy + 4}">${esc(t.name)} <tspan class="dim">${fmtMD(s.finish)}</tspan></text>`;
    } else {
      const w = Math.max(x1 - x0, 4);
      if (s.status === 'active') {
        g += `<rect class="g-track" x="${x0}" y="${barY}" width="${w}" height="${barH}" rx="4"/>`;
        g += `<rect class="g-bar active" data-id="${id}" x="${x0}" y="${barY}" width="${Math.max(4, w * s.progress / 100)}" height="${barH}" rx="4"/>`;
        g += `<rect data-id="${id}" class="g-bar" x="${x0}" y="${barY}" width="${w}" height="${barH}" rx="4" fill="transparent"/>`;
      } else {
        g += `<rect class="g-bar ${s.status}" data-id="${id}" x="${x0}" y="${barY}" width="${w}" height="${barH}" rx="4"/>`;
      }
      if (crit) g += `<rect class="g-ring" x="${x0}" y="${barY}" width="${w}" height="${barH}" rx="4"/>`;
      const extra = s.status === 'active' ? ` <tspan class="dim">${s.progress}%</tspan>` : '';
      g += `<text class="g-label" x="${x0 + w + 8}" y="${cy + 4}">${esc(t.name)}${extra}</text>`;
    }
  }

  // 資料日期線與今天
  const ddx = xOf(project.dataDate);
  g += `<line class="g-datadate" x1="${ddx}" y1="0" x2="${ddx}" y2="${H}"/>`;
  g += `<rect x="${ddx + 3}" y="4" width="56" height="17" rx="8.5" fill="var(--datadate)"/><text class="g-flag" x="${ddx + 31}" y="16.5" text-anchor="middle" fill="var(--panel)">資料日期</text>`;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (todayIso !== project.dataDate) {
    const tx = xOf(todayIso) + px / 2;
    if (tx >= 0 && tx <= W) g += `<line class="g-today" x1="${tx}" y1="0" x2="${tx}" y2="${H}"><title>今天 ${fmtDate(todayIso, era)}</title></line>`;
  }

  const sl = body.scrollLeft, st = body.scrollTop;
  body.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="甘特圖">${g}</svg>`;
  body.scrollLeft = sl; body.scrollTop = st;
  app.$('chartHead').scrollLeft = body.scrollLeft;
}

export function scrollToDate(app: App, iso: string) {
  const body = app.$('chartBody');
  body.scrollLeft = Math.max(0, (toDayNum(iso) - geo.lo) * geo.px - body.clientWidth / 3);
  app.$('chartHead').scrollLeft = body.scrollLeft;
}

/** 甘特圖與表格的捲動同步、滑鼠互動；只需綁定一次 */
export function bindGantt(app: App) {
  const body = app.$('chartBody');
  const head = app.$('chartHead');
  const listBody = app.$('listBody');
  const listHead = app.$('listHead');
  const tip = app.$('tip');

  body.addEventListener('scroll', () => {
    head.scrollLeft = body.scrollLeft;
    if (listBody.scrollTop !== body.scrollTop) listBody.scrollTop = body.scrollTop;
  });
  listBody.addEventListener('scroll', () => {
    listHead.scrollLeft = listBody.scrollLeft;
    if (body.scrollTop !== listBody.scrollTop) body.scrollTop = listBody.scrollTop;
  });

  const rowAt = (e: MouseEvent) => {
    const rect = body.getBoundingClientRect();
    const y = e.clientY - rect.top + body.scrollTop;
    return app.rows[Math.floor(y / ROW)];
  };
  const setHover = (id: string | undefined) => {
    const i = id ? app.rows.indexOf(id) : -1;
    document.getElementById('ganttHover')?.setAttribute('y', String(i >= 0 ? i * ROW : -100));
    listBody.querySelectorAll('tr.hover').forEach((tr) => tr.classList.remove('hover'));
    if (id) listBody.querySelector(`tr[data-id="${id}"]`)?.classList.add('hover');
  };

  body.addEventListener('mousemove', (e) => {
    const id = rowAt(e);
    setHover(id);
    const target = (e.target as Element).closest('[data-id]');
    if (!target) { tip.hidden = true; return; }
    const tid = target.getAttribute('data-id')!;
    const s = app.store.result.byId[tid], t = app.store.task(tid)!;
    const era = app.ui.era;
    const lines = [
      `<b>${esc(s.wbs)} ${esc(t.name)}</b>`,
      t.milestone ? fmtDate(s.finish, era) : `${fmtDate(s.start, era)} → ${fmtDate(s.finish, era)}`,
      s.isSummary ? `進度 ${s.progress}%` : `工期 ${t.duration} 工作天 · 進度 ${s.progress}%`,
    ];
    if (s.float !== null && !s.isSummary) lines.push(s.critical ? '關鍵路徑（浮時 0）' : `浮時 ${s.float} 工作天`);
    if (s.finishVariance) lines.push(s.finishVariance > 0 ? `比基準線晚 ${s.finishVariance} 工作天` : `比基準線早 ${-s.finishVariance} 工作天`);
    if (t.preds.length && !s.isSummary) lines.push('前置：' + t.preds.map((p) => `${esc(app.store.task(p.id)?.name)}（${REL_LABEL[p.type].split(' ')[0]}${p.lag ? (p.lag > 0 ? '+' : '') + p.lag : ''}）`).join('、'));
    tip.innerHTML = lines.join('<br>');
    tip.hidden = false;
    const chart = body.parentElement!.getBoundingClientRect();
    let x = e.clientX - chart.left + 14, y = e.clientY - chart.top + 14;
    if (x + 290 > chart.width) x = Math.max(4, e.clientX - chart.left - 294);
    if (y + tip.offsetHeight > chart.height) y = e.clientY - chart.top - tip.offsetHeight - 10;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  });
  body.addEventListener('mouseleave', () => { setHover(undefined); tip.hidden = true; });
  body.addEventListener('click', (e) => {
    const id = rowAt(e);
    if (e.detail === 2 && id) { app.openDrawer(id); return; }
    app.select(id ?? null, e.ctrlKey || e.metaKey);
  });

  // 表格滑過時也同步高亮甘特圖
  listBody.addEventListener('mouseover', (e) => {
    const tr = (e.target as Element).closest('tr[data-id]');
    setHover(tr?.getAttribute('data-id') ?? undefined);
  });
  listBody.addEventListener('mouseleave', () => setHover(undefined));
}

