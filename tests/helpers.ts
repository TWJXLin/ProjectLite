import type { Project, Task, Pred } from '../src/model/types';
import { WORKWEEK_PRESETS } from '../src/model/calendar';

export function task(id: string, duration: number, preds: Pred[] = [], extra: Partial<Task> = {}): Task {
  return { id, name: `T${id}`, parent: null, duration, milestone: false, preds, progress: 0, ...extra };
}
export const fs = (id: string, lag = 0): Pred => ({ id, type: 'FS', lag });
export const ss = (id: string, lag = 0): Pred => ({ id, type: 'SS', lag });
export const ff = (id: string, lag = 0): Pred => ({ id, type: 'FF', lag });
export const sf = (id: string, lag = 0): Pred => ({ id, type: 'SF', lag });

/** 2026-09-07 是星期一；預設週休二日、無假日、資料日期=開始日 */
export function project(tasks: Task[], over: Partial<Project> = {}): Project {
  return {
    version: 1, name: 'test', start: '2026-09-07', dataDate: '2026-09-07',
    calendar: { workWeek: WORKWEEK_PRESETS.five.week, holidays: [], extraWorkdays: [] },
    tasks, ...over,
  };
}
