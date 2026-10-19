/**
 * CPM 排程引擎（關鍵路徑法）。
 *
 * 輸入：專案資料（任務、工期、前置關係、工作日曆、資料日期）
 * 輸出：每個任務的最早/最晚開始完成、浮時、是否在關鍵路徑上
 *
 * 計算分兩趟：
 *   1. 順推（forward pass）：從頭往後，算每個任務「最早」何時能開始、完成。
 *   2. 逆推（backward pass）：從完工日往前，算每個任務「最晚」何時必須完成才不會拖到完工日。
 *   兩者的差距就是「浮時」，浮時為 0 的任務組成關鍵路徑。
 *
 * 所有計算都用「第幾個工作天」（整數），最後才換成日期。
 * es/ls = 開始於該工作天的早上；ef/lf = 結束於該工作天的早上（也就是前一天下班）。
 * 所以工期 3 天、es=0 的任務，ef=3，完成日是第 2 個工作天。
 */
import type { Project, Task, RelType } from './types';
import { MAX_DURATION, MAX_LAG } from './types';
import { buildCalendarIndex, type CalendarIndex } from './calendar';
import { isValidIso } from './dates';

export type Status = 'done' | 'active' | 'todo';

export interface Scheduled {
  id: string;
  wbs: string;
  depth: number;
  isSummary: boolean;
  status: Status;
  es: number; ef: number;
  ls: number | null; lf: number | null;
  lateStart: string | null;  // 顯示用最晚開始日
  lateFinish: string | null; // 顯示用最晚完成日
  float: number | null;      // 總浮時（工作天）；已完成的任務為 null
  critical: boolean;
  start: string;             // 顯示用開始日
  finish: string;            // 顯示用完成日
  progress: number;          // 摘要任務為子任務加權平均
  remaining: number;         // 剩餘工期（工作天）
  baselineStart?: string;
  baselineFinish?: string;
  finishVariance?: number;   // 完成日比基準線晚幾個工作天（負數=提前）
}

export interface ScheduleResult {
  byId: Record<string, Scheduled>;
  order: string[];           // 畫面順序
  projectStart: string;
  projectFinish: string;
  totalWorkdays: number;
  progress: number;
  criticalCount: number;
  warnings: string[];
  cal: CalendarIndex;
  dataDateIndex: number;
}

const isStarted = (t: Task) => t.progress > 0 || !!t.actualStart;
// 里程碑沒有「進行中」：有任何進度就視為已達成
const isDone = (t: Task) => t.progress >= 100 || !!t.actualFinish || (t.milestone && t.progress > 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function buildTree(tasks: Task[]) {
  const children = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const list = children.get(t.parent) ?? [];
    list.push(t);
    children.set(t.parent, list);
  }
  return children;
}

export function schedule(project: Project): ScheduleResult {
  const warnings: string[] = [];
  const cal = buildCalendarIndex(project.calendar, project.start);
  const dd = cal.indexOnOrAfter(project.dataDate);
  const tasks = project.tasks;
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const children = buildTree(tasks);
  const hasKids = (id: string) => (children.get(id)?.length ?? 0) > 0;

  // ---- WBS 編號與層級（依畫面順序走樹）----
  const wbs = new Map<string, string>();
  const depth = new Map<string, number>();
  const order: string[] = [];
  const walk = (parent: string | null, prefix: string, d: number) => {
    (children.get(parent) ?? []).forEach((t, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      wbs.set(t.id, code); depth.set(t.id, d); order.push(t.id);
      walk(t.id, code, d + 1);
    });
  };
  walk(null, '', 0);
  // 父任務不存在的孤兒任務也要列出，避免資料消失
  for (const t of tasks) if (!wbs.has(t.id)) {
    warnings.push(`任務「${t.name}」的上層任務不存在，已放到最外層`);
    wbs.set(t.id, '?'); depth.set(t.id, 0); order.push(t.id);
  }

  // ---- 只有「最底層任務」參與 CPM；摘要任務由子任務彙總 ----
  const leaves = tasks.filter((t) => !hasKids(t.id));
  const leafIds = new Set(leaves.map((t) => t.id));
  const validPreds = (t: Task) => t.preds.filter((p) => {
    if (p.id === t.id) return false;
    if (!byTask.has(p.id)) { warnings.push(`任務「${t.name}」的前置任務 ${p.id} 不存在，已略過`); return false; }
    if (!leafIds.has(p.id)) { warnings.push(`任務「${t.name}」連到摘要任務「${byTask.get(p.id)!.name}」，摘要任務不能當前置，已略過`); return false; }
    return true;
  });
  const predsOf = new Map(leaves.map((t) => [t.id, validPreds(t)]));

  // ---- 拓撲排序（Kahn 演算法）：保證先算前置任務；同時找出循環相依 ----
  const indeg = new Map(leaves.map((t) => [t.id, predsOf.get(t.id)!.length]));
  const succs = new Map<string, { id: string; type: RelType; lag: number }[]>(leaves.map((t) => [t.id, []]));
  for (const t of leaves) for (const p of predsOf.get(t.id)!) succs.get(p.id)!.push({ id: t.id, type: p.type, lag: clamp(Math.round(p.lag) || 0, -MAX_LAG, MAX_LAG) });
  const queue = leaves.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const topo: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    topo.push(id);
    for (const s of succs.get(id)!) {
      indeg.set(s.id, indeg.get(s.id)! - 1);
      if (indeg.get(s.id) === 0) queue.push(s.id);
    }
  }
  const brokenEdges = new Set<string>();
  if (topo.length < leaves.length) {
    const stuck = leaves.filter((t) => !topo.includes(t.id));
    warnings.push(`發現循環相依：${stuck.map((t) => `「${t.name}」`).join('、')}。請檢查前置任務，循環中的關係暫不計算。`);
    // 依畫面順序硬排，並略過指向尚未排入任務的關係
    const placed = new Set(topo);
    for (const t of stuck) {
      for (const p of predsOf.get(t.id)!) if (!placed.has(p.id)) brokenEdges.add(`${p.id}>${t.id}`);
      topo.push(t.id); placed.add(t.id);
    }
  }

  // ---- 順推：最早開始 ES / 最早完成 EF ----
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const remaining = new Map<string, number>();
  for (const id of topo) {
    const t = byTask.get(id)!;
    const dur = t.milestone ? 0 : clamp(Math.round(t.duration) || 0, 0, MAX_DURATION);
    // 里程碑是「某一天結束時」的一個瞬間：序號 s 代表第 s-1 個工作天的下班時刻。
    // 凡是從「開始」推來的時間（SS、SF、資料日期、限制日）都要 +1 才符合這個慣例；
    // 從「完成」推來的（FS、FF）本來就是下班時刻，不用調整。
    const msShift = t.milestone ? 1 : 0;
    // 前置關係推出來的最早開始
    let logic = 0;
    for (const p of predsOf.get(id)!) {
      if (brokenEdges.has(`${p.id}>${id}`)) continue;
      const lag = clamp(Math.round(p.lag) || 0, -MAX_LAG, MAX_LAG);
      let c: number;
      switch (p.type) {
        case 'FS': c = ef.get(p.id)! + lag; break;                      // 前置完成後才能開始
        case 'SS': c = es.get(p.id)! + lag + msShift; break;            // 前置開始後才能開始
        case 'FF': c = ef.get(p.id)! + lag - dur; break;                // 前置完成後才能完成
        case 'SF': c = es.get(p.id)! + lag - dur + msShift; break;      // 前置開始後才能完成
      }
      logic = Math.max(logic, c);
    }
    if (isValidIso(t.notEarlierThan)) {
      logic = Math.max(logic, cal.indexOnOrAfter(t.notEarlierThan) + msShift);
    }

    let s: number, f: number, rem: number;
    if (isDone(t)) {
      s = isValidIso(t.actualStart) ? cal.indexOnOrAfter(t.actualStart) : logic;
      f = isValidIso(t.actualFinish) ? cal.indexOnOrBefore(t.actualFinish) + 1 : s + dur;
      if (t.milestone && isValidIso(t.actualFinish)) s = f;
      f = Math.max(f, s);
      rem = 0;
    } else if (isStarted(t)) {
      s = isValidIso(t.actualStart) ? cal.indexOnOrAfter(t.actualStart) : logic;
      rem = Math.ceil(dur * (100 - t.progress) / 100);
      // 剩下的工作從資料日期開始往後排
      f = Math.max(dd, s) + rem;
      if (dur > 0) f = Math.max(f, s + 1);
    } else {
      // 還沒開始的工作不能排在資料日期之前
      s = Math.max(logic, dd + msShift);
      f = s + dur;
      rem = dur;
    }
    es.set(id, s); ef.set(id, f); remaining.set(id, rem);
  }

  // ---- 逆推：最晚完成 LF / 最晚開始 LS ----
  const projectEnd = leaves.length ? Math.max(...leaves.map((t) => ef.get(t.id)!)) : 0;
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...topo].reverse()) {
    const t = byTask.get(id)!;
    if (isDone(t)) continue;
    const started = isStarted(t);
    const span = ef.get(id)! - es.get(id)!;
    let late = projectEnd;
    for (const s of succs.get(id)!) {
      if (brokenEdges.has(`${id}>${s.id}`)) continue;
      const st = byTask.get(s.id)!;
      if (isDone(st)) continue;
      const sStarted = isStarted(st);
      const sLS = ls.get(s.id), sLF = lf.get(s.id)!;
      let b: number | null = null;
      switch (s.type) {
        case 'FS': if (!sStarted) b = sLS! - s.lag; break;
        case 'SS': if (!sStarted && !started) b = sLS! - s.lag + span; break;
        case 'FF': b = sLF - s.lag; break;
        case 'SF': if (!started) b = sLF - s.lag + span; break;
      }
      if (b !== null) late = Math.min(late, b);
    }
    lf.set(id, late);
    ls.set(id, late - span);
  }

  // ---- 組合結果 ----
  const bl = project.baseline?.tasks ?? {};
  const byId: Record<string, Scheduled> = {};
  const workIdx = (iso: string) => cal.indexOnOrBefore(iso);
  for (const t of leaves) {
    const s = es.get(t.id)!, f = ef.get(t.id)!;
    const status: Status = isDone(t) ? 'done' : isStarted(t) ? 'active' : 'todo';
    let start: string, finish: string;
    const lfi = lf.get(t.id), lsi = ls.get(t.id);
    let lateStart: string | null = null, lateFinish: string | null = null;
    if (t.milestone) {
      const d = isValidIso(t.actualFinish) && status === 'done' ? t.actualFinish : cal.dateOf(Math.max(0, s - 1));
      start = finish = d;
      if (lfi !== undefined) lateStart = lateFinish = cal.dateOf(Math.max(0, lfi - 1));
    } else {
      start = isValidIso(t.actualStart) ? t.actualStart : cal.dateOf(s);
      finish = isValidIso(t.actualFinish) && status === 'done' ? t.actualFinish : cal.dateOf(Math.max(s, f - 1));
      if (lfi !== undefined && lsi !== undefined) { lateStart = cal.dateOf(lsi); lateFinish = cal.dateOf(Math.max(lsi, lfi - 1)); }
    }
    const fl = status === 'done' ? null : lf.get(t.id)! - f;
    byId[t.id] = {
      id: t.id, wbs: wbs.get(t.id)!, depth: depth.get(t.id)!, isSummary: false, status,
      es: s, ef: f,
      ls: lsi ?? null, lf: lfi ?? null, lateStart, lateFinish,
      float: fl, critical: fl !== null && fl <= 0,
      start, finish,
      progress: status === 'done' ? 100 : Math.max(0, Math.min(100, t.progress)),
      remaining: remaining.get(t.id)!,
    };
  }

  // 摘要任務：由下往上彙總
  const rollup = (id: string): Scheduled => {
    if (byId[id]) return byId[id];
    const kids = children.get(id)!.map((k) => rollup(k.id));
    const weight = (k: Scheduled) => Math.max(0, k.ef - k.es);
    const wsum = kids.reduce((a, k) => a + weight(k), 0);
    const prog = wsum > 0
      ? kids.reduce((a, k) => a + k.progress * weight(k), 0) / wsum
      : kids.reduce((a, k) => a + k.progress, 0) / kids.length;
    const floats = kids.map((k) => k.float).filter((x): x is number => x !== null);
    const statuses = kids.map((k) => k.status);
    const status: Status = statuses.every((s) => s === 'done') ? 'done'
      : statuses.some((s) => s !== 'todo') ? 'active' : 'todo';
    const sc: Scheduled = {
      id, wbs: wbs.get(id)!, depth: depth.get(id)!, isSummary: true, status,
      es: Math.min(...kids.map((k) => k.es)), ef: Math.max(...kids.map((k) => k.ef)),
      ls: null, lf: null, lateStart: null, lateFinish: null,
      float: floats.length ? Math.min(...floats) : null,
      critical: kids.some((k) => k.critical),
      start: kids.map((k) => k.start).sort()[0],
      finish: kids.map((k) => k.finish).sort().at(-1)!,
      progress: Math.round(prog),
      remaining: Math.max(0, ...kids.map((k) => k.remaining)),
    };
    byId[id] = sc;
    return sc;
  };
  for (const t of tasks) rollup(t.id);

  // 基準線比較
  for (const id of order) {
    const b = bl[id];
    if (!b) continue;
    const sc = byId[id];
    sc.baselineStart = b.start; sc.baselineFinish = b.finish;
    sc.finishVariance = workIdx(sc.finish) - workIdx(b.finish);
  }

  const tops = (children.get(null) ?? []).map((t) => byId[t.id]);
  const projectStart = tops.length ? tops.map((s) => s.start).sort()[0] : project.start;
  const projectFinish = tops.length ? tops.map((s) => s.finish).sort().at(-1)! : project.start;
  const leafSched = leaves.map((t) => byId[t.id]);
  const wsum = leafSched.reduce((a, k) => a + Math.max(0, k.ef - k.es), 0);
  const progress = wsum > 0 ? leafSched.reduce((a, k) => a + k.progress * Math.max(0, k.ef - k.es), 0) / wsum : 0;

  return {
    byId, order, projectStart, projectFinish,
    totalWorkdays: tops.length ? workIdx(projectFinish) - cal.indexOnOrAfter(projectStart) + 1 : 0,
    progress: Math.round(progress),
    criticalCount: leafSched.filter((s) => s.critical).length,
    warnings: [...new Set(warnings)],
    cal, dataDateIndex: dd,
  };
}

/** 存基準線：把目前排程的開始/完成日拍照存起來 */
export function makeBaseline(result: ScheduleResult, savedAt: string) {
  const tasks: Record<string, { start: string; finish: string }> = {};
  for (const id of result.order) tasks[id] = { start: result.byId[id].start, finish: result.byId[id].finish };
  return { savedAt, tasks };
}
