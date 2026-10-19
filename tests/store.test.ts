import { Store, validateProject } from '../src/model/store';
import { project, task, fs } from './helpers';

const mk = () => new Store(project([task('1', 3), task('2', 2, [fs('1')]), task('3', 4, [fs('2')])]), false);

describe('資料倉庫操作', () => {
  it('新增任務後可以復原與重做', () => {
    const s = mk();
    const id = s.addTask('1');
    expect(s.project.tasks.map((t) => t.id)).toEqual(['1', id, '2', '3']);
    s.undo();
    expect(s.project.tasks.length).toBe(3);
    s.redo();
    expect(s.project.tasks.length).toBe(4);
  });
  it('降階與升階', () => {
    const s = mk();
    s.indent('2');
    expect(s.task('2')!.parent).toBe('1');
    expect(s.result.byId['1'].isSummary).toBe(true);
    // 任務 1 變成摘要，原本連到它的關係要拿掉
    expect(s.task('2')!.preds).toEqual([]);
    s.outdent('2');
    expect(s.task('2')!.parent).toBeNull();
    expect(s.project.tasks.map((t) => t.id)).toEqual(['1', '2', '3']);
  });
  it('刪除任務會一併移除指向它的關係', () => {
    const s = mk();
    s.deleteTasks(['2']);
    expect(s.task('3')!.preds).toEqual([]);
  });
  it('防止循環相依', () => {
    const s = mk();
    expect(s.addPred('1', '3')).toMatch('循環');
    expect(s.addPred('3', '1')).toBeNull();
  });
  it('上下移動', () => {
    const s = mk();
    s.move('3', -1);
    expect(s.project.tasks.map((t) => t.id)).toEqual(['1', '3', '2']);
  });
  it('新增子任務時，前置關係移交給子任務', () => {
    const s = mk();
    const child = s.addTask('2', true);
    expect(s.task(child)!.preds.map((p) => p.id)).toEqual(['1']);
    expect(s.task('3')!.preds.map((p) => p.id)).toEqual([child]);
  });
  it('串連任務', () => {
    const s = new Store(project([task('1', 1), task('2', 1), task('3', 1)]), false);
    expect(s.linkChain(['3', '1', '2'])).toBeNull();
    expect(s.task('1')!.preds[0].id).toBe('3');
    expect(s.task('2')!.preds[0].id).toBe('1');
  });
});

describe('匯入檢查', () => {
  const base = { version: 1, name: 'x', start: '2026-09-07', dataDate: '2026-09-07',
    calendar: { workWeek: [false, true, true, true, true, true, false], holidays: [], extraWorkdays: [] } };
  it('不安全或重複的編號會換成新編號，關係跟著修正', () => {
    const p = validateProject({ ...base, tasks: [
      { id: '1', name: 'a', parent: null, duration: 1, preds: [] },
      { id: '2" onclick="x', name: 'b', parent: '1', duration: 1, preds: [{ id: '1', type: 'FS', lag: 0 }] },
      { id: '1', name: 'dup', parent: '2" onclick="x', duration: 1, preds: [{ id: '2" onclick="x', type: 'SS', lag: 2 }] },
    ] });
    expect(p.tasks.map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(p.tasks[1].parent).toBe('1');
    expect(p.tasks[2].parent).toBe('2');
    expect(p.tasks[2].preds).toEqual([{ id: '2', type: 'SS', lag: 2 }]);
  });
  it('上層不存在的任務放到最外層，且畫面會顯示它', () => {
    const p = validateProject({ ...base, tasks: [
      { id: '1', name: 'a', parent: 'nope', duration: 1, preds: [{ id: 'ghost', type: 'FS', lag: 0 }] },
    ] });
    expect(p.tasks[0].parent).toBeNull();
    expect(p.tasks[0].preds).toEqual([]);
    const s = new Store(p, false);
    expect(s.result.order).toEqual(['1']);
  });
});
