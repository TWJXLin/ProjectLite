/** 安全稽核與獨立審查找到的問題，每一項都留一個回歸測試 */
import { schedule } from '../src/model/schedule';
import { Store, validateProject } from '../src/model/store';
import { buildCalendarIndex, WORKWEEK_PRESETS } from '../src/model/calendar';
import { project, task, fs, ss } from './helpers';

const base = { version: 1, name: 'x', start: '2026-09-07', dataDate: '2026-09-07',
  calendar: { workWeek: [false, true, true, true, true, true, false], holidays: [], extraWorkdays: [] } };

describe('超大數字不會卡死', () => {
  it('工期與 Lag 會被限制在上限內', () => {
    const t0 = Date.now();
    const r = schedule(project([task('A', 999_999_999_999), task('B', 1, [fs('A', 1e9)])]));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.byId.A.ef).toBe(10_000);
    expect(r.byId.B.es).toBe(20_000);
  });
  it('資料倉庫也會限制', () => {
    const s = new Store(project([task('A', 1)]), false);
    s.updateTask('A', { duration: 999_999_999_999 });
    expect(s.task('A')!.duration).toBe(10_000);
    expect(s.addPred('A', 'A')).not.toBeNull();
  });
  it('日曆超出範圍會報錯而不是無窮迴圈', () => {
    const cal = buildCalendarIndex({ workWeek: WORKWEEK_PRESETS.five.week, holidays: [], extraWorkdays: [] }, '2026-09-07');
    expect(() => cal.dateOf(1e9)).toThrow();
  });
});

describe('匯入的上層關係繞圈', () => {
  it('互指或指向自己的上層會被拆開', () => {
    const p = validateProject({ ...base, tasks: [
      { id: 'A', name: 'a', parent: 'B', duration: 1 },
      { id: 'B', name: 'b', parent: 'A', duration: 1 },
      { id: 'C', name: 'c', parent: 'C', duration: 1 },
      { id: 'D', name: 'd', parent: 'E', duration: 1 }, { id: 'E', name: 'e', parent: 'F', duration: 1 }, { id: 'F', name: 'f', parent: 'D', duration: 1 },
    ] });
    expect(p.tasks.some((t) => t.parent === null)).toBe(true);
    const s = new Store(p, false);
    expect(s.result.order.length).toBe(6);
  });
  it('排程失敗時資料會退回修改前', () => {
    const s = new Store(project([task('A', 1)]), false);
    // 直接塞入繞圈資料（繞過 validateProject），commit 會失敗
    expect(() => s.replaceProject({ ...s.project, tasks: [
      { ...task('A', 1), parent: 'B' }, { ...task('B', 1), parent: 'A' },
    ] })).toThrow();
    expect(s.project.tasks.map((t) => t.id)).toEqual(['A']);
    expect(s.canUndo).toBe(false);
    s.updateTask('A', { duration: 2 }); // 之後仍可正常操作
    expect(s.task('A')!.duration).toBe(2);
  });
});

describe('匯入只保留合法欄位', () => {
  it('不合法的日期、金額、字串會被丟掉', () => {
    const p = validateProject({ ...base, tasks: [{
      id: '1', name: 'a', parent: null, duration: 1, progress: 100,
      actualStart: '" onfocus="alert(1)', actualFinish: '2026-09-10', notEarlierThan: 12345,
      budget: 'abc', actualCost: '-5', responsible: 42, notes: '<b>x</b>', extraField: 'junk',
    }] });
    const t = p.tasks[0] as unknown as Record<string, unknown>;
    expect(t.actualStart).toBeUndefined();
    expect(t.actualFinish).toBe('2026-09-10');
    expect(t.notEarlierThan).toBeUndefined();
    expect(t.budget).toBeUndefined();
    expect(t.actualCost).toBe(0);
    expect(t.responsible).toBeUndefined();
    expect(t.notes).toBe('<b>x</b>');
    expect('extraField' in t).toBe(false);
  });
  it('實際完成早於實際開始時，實際開始改為同一天', () => {
    const p = validateProject({ ...base, tasks: [{ id: '1', name: 'a', parent: null, duration: 3, actualStart: '2026-09-14', actualFinish: '2026-09-08', progress: 100 }] });
    expect(p.tasks[0].actualStart).toBe('2026-09-08');
  });
});

describe('里程碑日期一致性', () => {
  it('未達成的里程碑不會顯示在資料日期之前', () => {
    const r = schedule(project([task('M', 0, [], { milestone: true })], { dataDate: '2026-09-14' }));
    expect(r.byId.M.finish).toBe('2026-09-14');
  });
  it('SS 連到的里程碑顯示在前置開始當天，而不是前一天', () => {
    const r = schedule(project([task('A', 5, [], { notEarlierThan: '2026-09-10' }), task('M', 0, [ss('A')], { milestone: true })]));
    expect(r.byId.A.start).toBe('2026-09-10');
    expect(r.byId.M.finish).toBe('2026-09-10');
  });
  it('專案第一天的里程碑與它的後續任務方向正確', () => {
    const r = schedule(project([task('M', 0, [], { milestone: true }), task('B', 2, [fs('M')])]));
    expect(r.byId.M.finish).toBe('2026-09-07');
    expect(r.byId.B.start).toBe('2026-09-08');
  });
  it('關鍵里程碑的最晚日期等於最早日期', () => {
    const r = schedule(project([task('A', 5), task('M', 0, [fs('A')], { milestone: true })]));
    expect(r.byId.M.float).toBe(0);
    expect(r.byId.M.lateFinish).toBe(r.byId.M.finish);
    expect(r.byId.M.lateStart).toBe('2026-09-11');
  });
  it('一般任務的最晚日期', () => {
    const r = schedule(project([task('A', 2), task('B', 5, [fs('A')]), task('C', 2, [fs('A')])]));
    expect(r.byId.C.lateStart).toBe('2026-09-14');
    expect(r.byId.C.lateFinish).toBe('2026-09-15');
  });
  it('里程碑只有 0% 或 100%，不會產生假的工期', () => {
    const s = new Store(project([
      task('P', 0), task('A', 10, [], { parent: 'P' }), task('M', 0, [], { parent: 'P', milestone: true }),
    ], { dataDate: '2026-09-14' }), false);
    s.updateTask('M', { progress: 50 });
    expect(s.task('M')!.progress).toBe(100);
    expect(s.result.byId.M.ef).toBe(s.result.byId.M.es);
    expect(s.result.byId.P.progress).toBe(0);
  });
});
