import type { Project, Pred } from './types';
import { WORKWEEK_PRESETS } from './calendar';
import { holidaysForYears } from './holidays-tw';

const fs = (id: string, lag = 0): Pred => ({ id, type: 'FS', lag });
const ss = (id: string, lag = 0): Pred => ({ id, type: 'SS', lag });

/** 範例專案：商辦大樓新建工程。工期單位為工作天（週休二日、扣國定假日）。 */
export function sampleProject(): Project {
  const T = (id: string, name: string, parent: string | null, duration = 0, preds: Pred[] = [], extra: Record<string, unknown> = {}) =>
    ({ id, name, parent, duration, milestone: false, preds, progress: 0, ...extra });
  return {
    version: 1,
    name: '大安區OO商辦大樓新建工程（範例）',
    start: '2026-09-07',
    dataDate: '2026-10-19',
    calendar: { workWeek: [...WORKWEEK_PRESETS.five.week], holidays: holidaysForYears([2026]), extraWorkdays: [] },
    tasks: [
      T('1', '專案啟動', null),
      T('2', '專案啟動會議', '1', 2, [], { progress: 100, responsible: '王經理', budget: 50000, actualCost: 52000 }),
      T('3', '需求確認與範疇界定', '1', 3, [fs('2')], { progress: 100, responsible: '王經理', budget: 80000, actualCost: 78000 }),
      T('4', '設計階段', null),
      T('5', '建築設計', '4', 15, [fs('3')], { progress: 100, responsible: '陳建築師', budget: 600000, actualCost: 615000 }),
      T('6', '結構設計', '4', 12, [fs('5')], { progress: 80, responsible: '李結構技師', budget: 450000, actualCost: 360000 }),
      T('7', '機電設計', '4', 10, [ss('5', 5)], { progress: 60, responsible: '林機電技師', budget: 350000, actualCost: 210000 }),
      T('8', '設計審查完成', '4', 0, [fs('6'), fs('7')], { milestone: true, responsible: '王經理' }),
      T('9', '許可與發包', null),
      T('10', '建照申請', '9', 20, [fs('8')], { responsible: '王經理', budget: 100000 }),
      T('11', '工程發包招標', '9', 15, [fs('8')], { responsible: '張採購', budget: 50000 }),
      T('12', '開工', '9', 0, [fs('10'), fs('11')], { milestone: true }),
      T('13', '基礎工程', null),
      T('14', '基地整地與開挖', '13', 10, [fs('12')], { responsible: '吳工地主任', budget: 800000 }),
      T('15', '基礎鋼筋綁紮', '13', 8, [fs('14')], { responsible: '吳工地主任', budget: 600000 }),
      T('16', '基礎混凝土澆置', '13', 5, [fs('15')], { responsible: '吳工地主任', budget: 500000 }),
      T('17', '結構工程', null),
      T('18', 'RC 結構施工－地上層', '17', 40, [fs('16')], { responsible: '吳工地主任', budget: 3500000 }),
      T('19', '鋼構安裝', '17', 25, [ss('18', 10)], { responsible: '鄭鋼構', budget: 1200000 }),
      T('20', '結構體完成', '17', 0, [fs('18'), fs('19')], { milestone: true }),
    ],
  };
}

export function blankProject(today: string): Project {
  return {
    version: 1,
    name: '新專案',
    start: today,
    dataDate: today,
    calendar: { workWeek: [...WORKWEEK_PRESETS.five.week], holidays: holidaysForYears([2026]), extraWorkdays: [] },
    tasks: [{ id: '1', name: '第一個任務', parent: null, duration: 5, milestone: false, preds: [], progress: 0 }],
  };
}
