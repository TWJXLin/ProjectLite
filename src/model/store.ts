/**
 * 資料倉庫（store）：整個程式唯一存放專案資料的地方。
 *
 * 畫面不直接改資料，而是呼叫這裡的動作（新增、刪除、縮排…）。
 * 每個動作執行前先拍一張快照放進「復原堆疊」，所以任何操作都能 Ctrl+Z。
 * 資料一變動就通知畫面重畫，並自動存到瀏覽器。
 */
import type { Project, Task, Pred, RelType } from './types';
import { schedule, makeBaseline, type ScheduleResult } from './schedule';
import { sampleProject } from './sample';
import { isValidIso, todayIso } from './dates';

const STORAGE_KEY = 'projectlite.project.v1';
const UNDO_LIMIT = 100;

type Listener = () => void;

export class Store {
  project: Project;
  result: ScheduleResult;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners: Listener[] = [];
  lastSaved: Date | null = null;
  saveError = false;

  constructor(initial?: Project, private persist = true) {
    this.project = initial ?? this.loadFromStorage() ?? sampleProject();
    normalizeOrder(this.project);
    this.result = schedule(this.project);
  }

  subscribe(fn: Listener) { this.listeners.push(fn); }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** 所有修改都經過這裡：拍快照 → 修改 → 重算排程 → 存檔 → 通知畫面 */
  private change(mutator: (p: Project) => void) {
    const before = JSON.stringify(this.project);
    mutator(this.project);
    if (JSON.stringify(this.project) === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.commit();
  }

  private commit() {
    normalizeOrder(this.project);
    this.result = schedule(this.project);
    this.save();
    this.listeners.forEach((fn) => fn());
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev);
    this.commit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(next);
    this.commit();
  }

  // ---------- 存檔 ----------
  private save() {
    if (!this.persist) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
      this.lastSaved = new Date(); this.saveError = false;
    } catch { this.saveError = true; }
  }

  private loadFromStorage(): Project | null {
    if (!this.persist) return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? validateProject(JSON.parse(raw)) : null;
    } catch { return null; }
  }

  // ---------- 查詢 ----------
  task(id: string) { return this.project.tasks.find((t) => t.id === id); }
  children(id: string | null) { return this.project.tasks.filter((t) => t.parent === id); }
  hasChildren(id: string) { return this.project.tasks.some((t) => t.parent === id); }
  successors(id: string) {
    return this.project.tasks.flatMap((t) => t.preds.filter((p) => p.id === id).map((p) => ({ task: t, pred: p })));
  }
  /** fromId 是否（直接或間接）依賴 targetId；用來防止循環相依 */
  dependsOn(fromId: string, targetId: string): boolean {
    const seen = new Set<string>();
    const stack = [fromId];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === targetId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      this.task(id)?.preds.forEach((p) => stack.push(p.id));
    }
    return false;
  }

  // ---------- 專案層級 ----------
  replaceProject(p: Project) { this.change((cur) => Object.assign(cur, p, { baseline: p.baseline })); }
  updateProject(patch: Partial<Omit<Project, 'tasks' | 'version'>>) { this.change((p) => Object.assign(p, patch)); }
  saveBaseline() { this.change((p) => { p.baseline = makeBaseline(this.result, todayIso()); }); }
  clearBaseline() { this.change((p) => { delete p.baseline; }); }

  // ---------- 任務 ----------
  private nextId() {
    const nums = this.project.tasks.map((t) => Number(t.id)).filter(Number.isFinite);
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  }

  /** 在 afterId 之後新增同層任務；asChild=true 時新增為 afterId 的子任務 */
  addTask(afterId: string | null, asChild = false, name = '新任務'): string {
    const id = this.nextId();
    this.change((p) => {
      const ref = afterId ? p.tasks.find((t) => t.id === afterId) : undefined;
      const t: Task = { id, name, parent: asChild && ref ? ref.id : ref?.parent ?? null, duration: 5, milestone: false, preds: [], progress: 0 };
      if (asChild && ref) {
        // 原本的最底層任務變成摘要任務：它的前置關係搬給新子任務，避免關係失效
        if (!p.tasks.some((x) => x.parent === ref.id)) {
          t.preds = ref.preds; ref.preds = [];
          t.duration = ref.duration || 5;
          for (const x of p.tasks) x.preds = x.preds.map((pr) => (pr.id === ref.id ? { ...pr, id } : pr));
        }
        p.tasks.splice(subtreeEnd(p.tasks, ref.id), 0, t);
      } else if (ref) {
        p.tasks.splice(subtreeEnd(p.tasks, ref.id), 0, t);
      } else {
        p.tasks.push(t);
      }
    });
    return id;
  }

  updateTask(id: string, patch: Partial<Task>) {
    this.change((p) => {
      const t = p.tasks.find((x) => x.id === id);
      if (!t) return;
      Object.assign(t, patch);
      t.duration = Math.max(0, Math.round(Number(t.duration) || 0));
      t.progress = Math.max(0, Math.min(100, Math.round(Number(t.progress) || 0)));
      if (t.milestone) t.duration = 0;
      for (const k of ['actualStart', 'actualFinish', 'notEarlierThan'] as const) if (t[k] !== undefined && !isValidIso(t[k])) delete t[k];
    });
  }

  deleteTasks(ids: string[]) {
    this.change((p) => {
      const doomed = new Set<string>();
      const mark = (id: string) => { doomed.add(id); p.tasks.filter((t) => t.parent === id).forEach((t) => mark(t.id)); };
      ids.forEach(mark);
      p.tasks = p.tasks.filter((t) => !doomed.has(t.id));
      for (const t of p.tasks) t.preds = t.preds.filter((pr) => !doomed.has(pr.id));
    });
  }

  /** 降階：變成上一個同層任務的子任務 */
  indent(id: string) {
    this.change((p) => {
      const t = p.tasks.find((x) => x.id === id)!;
      const sibs = p.tasks.filter((x) => x.parent === t.parent);
      const i = sibs.indexOf(t);
      if (i <= 0) return;
      const newParent = sibs[i - 1];
      // 新的上層若原本是最底層任務，會變成摘要任務，連到它的關係無法再用
      if (!p.tasks.some((x) => x.parent === newParent.id)) {
        newParent.preds = [];
        for (const x of p.tasks) x.preds = x.preds.filter((pr) => pr.id !== newParent.id);
      }
      t.parent = newParent.id;
    });
  }

  /** 升階：移到上層任務之後，成為上層的同層任務 */
  outdent(id: string) {
    this.change((p) => {
      const t = p.tasks.find((x) => x.id === id)!;
      if (t.parent === null) return;
      const oldParent = p.tasks.find((x) => x.id === t.parent)!;
      const block = takeSubtree(p.tasks, id);
      t.parent = oldParent.parent;
      p.tasks.splice(subtreeEnd(p.tasks, oldParent.id), 0, ...block);
    });
  }

  /** 在同層中上移(-1)或下移(+1)，連同子任務一起移動 */
  move(id: string, dir: -1 | 1) {
    this.change((p) => {
      const t = p.tasks.find((x) => x.id === id)!;
      const sibs = p.tasks.filter((x) => x.parent === t.parent);
      const i = sibs.indexOf(t), j = i + dir;
      if (j < 0 || j >= sibs.length) return;
      const other = sibs[j];
      const block = takeSubtree(p.tasks, id);
      if (dir < 0) p.tasks.splice(p.tasks.indexOf(other), 0, ...block);
      else p.tasks.splice(subtreeEnd(p.tasks, other.id), 0, ...block);
    });
  }

  /** 回傳無法加入的原因；可以加入時回傳 null */
  predProblem(taskId: string, predId: string): string | null {
    if (taskId === predId) return '任務不能是自己的前置';
    if (this.hasChildren(taskId) || this.hasChildren(predId)) return '摘要任務不能設定前置關係，請連到底下的子任務';
    if (this.task(taskId)?.preds.some((p) => p.id === predId)) return '這個關係已經存在';
    if (this.dependsOn(predId, taskId)) return '會造成循環相依（兩個任務互相等待）';
    return null;
  }

  addPred(taskId: string, predId: string, type: RelType = 'FS', lag = 0): string | null {
    const problem = this.predProblem(taskId, predId);
    if (problem) return problem;
    this.change((p) => { p.tasks.find((t) => t.id === taskId)!.preds.push({ id: predId, type, lag }); });
    return null;
  }

  updatePred(taskId: string, predId: string, patch: Partial<Pred>) {
    this.change((p) => {
      const pr = p.tasks.find((t) => t.id === taskId)?.preds.find((x) => x.id === predId);
      if (pr) Object.assign(pr, patch, { lag: Math.round(Number(patch.lag ?? pr.lag) || 0) });
    });
  }

  removePred(taskId: string, predId: string) {
    this.change((p) => {
      const t = p.tasks.find((x) => x.id === taskId);
      if (t) t.preds = t.preds.filter((x) => x.id !== predId);
    });
  }

  /** 依點選順序把多個任務串成 FS 鏈 */
  linkChain(ids: string[]): string | null {
    for (let i = 1; i < ids.length; i++) {
      const problem = this.predProblem(ids[i], ids[i - 1]);
      if (problem && problem !== '這個關係已經存在') return `${this.task(ids[i])?.name}：${problem}`;
    }
    this.change((p) => {
      for (let i = 1; i < ids.length; i++) {
        const t = p.tasks.find((x) => x.id === ids[i])!;
        if (!t.preds.some((x) => x.id === ids[i - 1])) t.preds.push({ id: ids[i - 1], type: 'FS', lag: 0 });
      }
    });
    return null;
  }
}

// ---------- 陣列順序工具：維持「父任務在前、子任務緊接在後」 ----------
function descendants(tasks: Task[], id: string): Set<string> {
  const out = new Set<string>();
  const visit = (pid: string) => tasks.filter((t) => t.parent === pid).forEach((t) => { out.add(t.id); visit(t.id); });
  visit(id);
  return out;
}

/** id 這個任務連同子孫在陣列中最後一筆的下一個位置 */
function subtreeEnd(tasks: Task[], id: string): number {
  const ids = descendants(tasks, id); ids.add(id);
  let end = -1;
  tasks.forEach((t, i) => { if (ids.has(t.id)) end = i; });
  return end + 1;
}

function takeSubtree(tasks: Task[], id: string): Task[] {
  const ids = descendants(tasks, id); ids.add(id);
  const block = tasks.filter((t) => ids.has(t.id));
  for (let i = tasks.length - 1; i >= 0; i--) if (ids.has(tasks[i].id)) tasks.splice(i, 1);
  return block;
}

export function normalizeOrder(p: Project) {
  const out: Task[] = [];
  const ids = new Set(p.tasks.map((t) => t.id));
  const visit = (parent: string | null) => p.tasks.filter((t) => t.parent === parent).forEach((t) => { out.push(t); visit(t.id); });
  visit(null);
  // 上層不存在的孤兒放到最後
  for (const t of p.tasks) if (!out.includes(t)) { if (t.parent && !ids.has(t.parent)) t.parent = null; out.push(t); }
  p.tasks = out;
}

/** 檢查匯入的檔案格式；不合格丟出中文錯誤訊息 */
export function validateProject(raw: unknown): Project {
  const p = raw as Project;
  if (!p || typeof p !== 'object' || !Array.isArray(p.tasks)) throw new Error('檔案裡找不到任務清單');
  if (!isValidIso(p.start)) throw new Error('專案開始日格式不正確');
  if (!p.calendar || !Array.isArray(p.calendar.workWeek) || p.calendar.workWeek.length !== 7) throw new Error('工作日曆格式不正確');
  // 任務編號只允許英數、底線、點、連字號；不合格或重複的編號一律換成新的數字編號，
  // 並同步修正所有指到它的上層與前置關係。這樣編號放進畫面時就不需要額外跳脫。
  const SAFE_ID = /^[A-Za-z0-9_.-]{1,40}$/;
  const remap = new Map<string, string>();
  const used = new Set<string>();
  let counter = 0;
  for (const t of p.tasks) {
    const n = Number(t?.id);
    if (Number.isFinite(n) && String(n) === String(t?.id)) counter = Math.max(counter, n);
  }
  const rawIds = p.tasks.map((t, i) => {
    if (!t || t.id == null || t.id === '') throw new Error(`第 ${i + 1} 個任務缺少編號`);
    return String(t.id);
  });
  const finalIds = rawIds.map((raw) => {
    let id = raw;
    if (!SAFE_ID.test(id) || used.has(id)) {
      do { id = String(++counter); } while (used.has(id));
    }
    used.add(id);
    if (!remap.has(raw)) remap.set(raw, id);
    return id;
  });
  const ref = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    const key = String(v);
    return remap.get(key) ?? (SAFE_ID.test(key) ? key : null);
  };
  const tasks: Task[] = p.tasks.map((t, i) => {
    const parent = ref(t.parent);
    return {
      ...t,
      id: finalIds[i],
      name: String(t.name ?? ''),
      parent: parent !== null && used.has(parent) ? parent : null,
      duration: Math.max(0, Number(t.duration) || 0),
      milestone: !!t.milestone,
      progress: Math.max(0, Math.min(100, Number(t.progress) || 0)),
      preds: Array.isArray(t.preds)
        ? t.preds.flatMap((x) => {
            const id = ref(x?.id);
            if (id === null || !used.has(id)) return [];
            return [{ id, type: (['FS', 'SS', 'FF', 'SF'].includes(x.type) ? x.type : 'FS') as RelType, lag: Number(x.lag) || 0 }];
          })
        : [],
    };
  });
  // 基準線也要跟著換編號
  let baseline = p.baseline;
  if (baseline && baseline.tasks && typeof baseline.tasks === 'object') {
    const mapped: Record<string, { start: string; finish: string }> = {};
    for (const [k, v] of Object.entries(baseline.tasks)) {
      const id = ref(k);
      if (id && v && isValidIso(v.start) && isValidIso(v.finish)) mapped[id] = { start: v.start, finish: v.finish };
    }
    baseline = { savedAt: String(baseline.savedAt ?? ''), tasks: mapped };
  } else baseline = undefined;
  return {
    version: 1,
    name: String(p.name ?? '未命名專案'),
    start: p.start,
    dataDate: isValidIso(p.dataDate) ? p.dataDate : p.start,
    calendar: {
      workWeek: p.calendar.workWeek.map(Boolean),
      holidays: (p.calendar.holidays ?? []).filter(isValidIso),
      extraWorkdays: (p.calendar.extraWorkdays ?? []).filter(isValidIso),
    },
    tasks,
    baseline,
  };
}
