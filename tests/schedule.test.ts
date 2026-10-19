import { schedule, makeBaseline } from '../src/model/schedule';
import { project, task, fs, ss, ff, sf } from './helpers';

describe('CPM 順推：四種關係', () => {
  it('FS 完成→開始', () => {
    const r = schedule(project([task('A', 3), task('B', 2, [fs('A')])]));
    expect(r.byId.A.start).toBe('2026-09-07');
    expect(r.byId.A.finish).toBe('2026-09-09');
    expect(r.byId.B.start).toBe('2026-09-10');
    expect(r.byId.B.finish).toBe('2026-09-11');
  });
  it('FS 跨週末', () => {
    const r = schedule(project([task('A', 5), task('B', 1, [fs('A')])]));
    expect(r.byId.B.start).toBe('2026-09-14');
  });
  it('FS 加 Lag 與 Lead', () => {
    const r = schedule(project([task('A', 3), task('B', 1, [fs('A', 2)]), task('C', 1, [fs('A', -1)])]));
    expect(r.byId.B.es).toBe(5);
    expect(r.byId.C.es).toBe(2);
  });
  it('SS 開始→開始加 Lag', () => {
    const r = schedule(project([task('A', 10), task('B', 3, [ss('A', 2)])]));
    expect(r.byId.B.es).toBe(2);
  });
  it('FF 完成→完成', () => {
    const r = schedule(project([task('A', 10), task('B', 3, [ff('A')])]));
    expect(r.byId.B.ef).toBe(10);
    expect(r.byId.B.es).toBe(7);
  });
  it('SF 開始→完成', () => {
    const r = schedule(project([task('A', 5, [], { notEarlierThan: '2026-09-21' }), task('B', 3, [sf('A')])]));
    // A 從第 10 個工作天開始，B 必須在那之前完成
    expect(r.byId.A.es).toBe(10);
    expect(r.byId.B.ef).toBe(10);
  });
  it('多個前置取最晚的那個', () => {
    const r = schedule(project([task('A', 3), task('B', 6), task('C', 1, [fs('A'), fs('B')])]));
    expect(r.byId.C.es).toBe(6);
  });
});

describe('CPM 逆推：浮時與關鍵路徑', () => {
  it('最長的那條路是關鍵路徑，短的有浮時', () => {
    const r = schedule(project([
      task('A', 2), task('B', 5, [fs('A')]), task('C', 2, [fs('A')]), task('D', 1, [fs('B'), fs('C')]),
    ]));
    expect(r.byId.B.critical).toBe(true);
    expect(r.byId.C.critical).toBe(false);
    expect(r.byId.C.float).toBe(3);
    expect(r.byId.D.critical).toBe(true);
    expect(r.criticalCount).toBe(3);
  });
  it('最晚開始/完成', () => {
    const r = schedule(project([task('A', 2), task('B', 5, [fs('A')]), task('C', 2, [fs('A')])]));
    expect(r.byId.C.lf).toBe(7);
    expect(r.byId.C.ls).toBe(5);
  });
  it('SS 關係的逆推', () => {
    const r = schedule(project([task('A', 10), task('B', 3, [ss('A', 2)])]));
    // B 最晚可到第 7 天開始，A 最晚開始受 B 限制 = 7-2 = 5，但 A 自己是最長的，所以 A 浮時 0
    expect(r.byId.A.float).toBe(0);
    expect(r.byId.B.float).toBe(5);
  });
});

describe('里程碑', () => {
  it('里程碑接在前置完成當天，後續任務從下一個工作天開始', () => {
    const r = schedule(project([
      task('A', 5), task('M', 0, [fs('A')], { milestone: true }), task('B', 1, [fs('M')]),
    ]));
    expect(r.byId.M.finish).toBe('2026-09-11'); // 週五
    expect(r.byId.B.start).toBe('2026-09-14');  // 下週一
  });
});

describe('工作日曆與限制條件', () => {
  it('遇國定假日順延', () => {
    const p = project([task('A', 3)]);
    p.calendar.holidays = ['2026-09-08'];
    expect(schedule(p).byId.A.finish).toBe('2026-09-10');
  });
  it('不得早於某日開始', () => {
    const r = schedule(project([task('A', 2, [], { notEarlierThan: '2026-09-16' })]));
    expect(r.byId.A.start).toBe('2026-09-16');
  });
});

describe('進度與資料日期', () => {
  it('未開始的任務不會排在資料日期之前', () => {
    const r = schedule(project([task('A', 3)], { dataDate: '2026-09-14' }));
    expect(r.byId.A.start).toBe('2026-09-14');
  });
  it('已完成任務使用實際日期', () => {
    const r = schedule(project([
      task('A', 3, [], { progress: 100, actualStart: '2026-09-07', actualFinish: '2026-09-10' }),
      task('B', 2, [fs('A')]),
    ], { dataDate: '2026-09-11' }));
    expect(r.byId.A.finish).toBe('2026-09-10');
    expect(r.byId.A.float).toBeNull();
    expect(r.byId.B.start).toBe('2026-09-11');
  });
  it('進行中任務：剩餘工期從資料日期往後排', () => {
    const r = schedule(project([
      task('A', 10, [], { progress: 50, actualStart: '2026-09-07' }),
    ], { dataDate: '2026-09-21' }));
    // 第 10 個工作天是 9/21，剩 5 天 → 9/25 完成
    expect(r.byId.A.start).toBe('2026-09-07');
    expect(r.byId.A.finish).toBe('2026-09-25');
    expect(r.byId.A.remaining).toBe(5);
  });
});

describe('WBS 與摘要任務', () => {
  it('摘要任務彙總子任務日期與進度', () => {
    const r = schedule(project([
      task('P', 0, [], { name: '階段' }),
      task('A', 2, [], { parent: 'P', progress: 100 }),
      task('B', 2, [fs('A')], { parent: 'P' }),
    ]));
    expect(r.byId.P.isSummary).toBe(true);
    expect(r.byId.P.start).toBe('2026-09-07');
    expect(r.byId.P.finish).toBe('2026-09-10');
    expect(r.byId.P.progress).toBe(50);
    expect(r.byId.A.wbs).toBe('1.1');
    expect(r.byId.B.wbs).toBe('1.2');
  });
});

describe('錯誤處理', () => {
  it('循環相依會發出警告而不是當掉', () => {
    const r = schedule(project([task('A', 1, [fs('B')]), task('B', 1, [fs('A')])]));
    expect(r.warnings.some((w) => w.includes('循環'))).toBe(true);
    expect(r.byId.A).toBeDefined();
  });
  it('前置任務不存在時略過', () => {
    const r = schedule(project([task('A', 1, [fs('X')])]));
    expect(r.byId.A.es).toBe(0);
    expect(r.warnings.length).toBe(1);
  });
});

describe('基準線', () => {
  it('延後時顯示完成日差異', () => {
    const p = project([task('A', 3)]);
    p.baseline = makeBaseline(schedule(p), '2026-09-07');
    p.tasks[0].duration = 5;
    expect(schedule(p).byId.A.finishVariance).toBe(2);
  });
});
