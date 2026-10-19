/**
 * 工作日曆：決定哪些日子算「工作天」。
 *
 * 排程引擎只會用「第幾個工作天」來計算（0、1、2…），
 * 這個模組負責把「第幾個工作天」和真正的日曆日期互相轉換。
 * 例如專案從週一開始、週休二日，第 5 個工作天就是下週一。
 */
import type { WorkCalendar } from './types';
import { toDayNum, fromDayNum, weekday } from './dates';

/** 可計算的最遠距離（日曆天）；超過就視為資料錯誤，避免瀏覽器卡死 */
export const MAX_CALENDAR_SPAN = 2_000_000;

export interface CalendarIndex {
  /** 第 i 個工作天的日期 */
  dateOf(index: number): string;
  /** 某日期是第幾個工作天；若當天放假，回傳之後第一個工作天的序號 */
  indexOnOrAfter(iso: string): number;
  /** 某日期之前（含當天）最後一個工作天的序號；用於「實際完成日」 */
  indexOnOrBefore(iso: string): number;
  isWorkday(iso: string): boolean;
}

export function isWorkdayNum(cal: WorkCalendar, dayNum: number, holidays: Set<number>, extra: Set<number>): boolean {
  if (extra.has(dayNum)) return true;
  if (holidays.has(dayNum)) return false;
  return !!cal.workWeek[weekday(dayNum)];
}

/**
 * 從專案開始日建立工作天索引。工作天序號 0 = 開始日當天或之後第一個工作天。
 * 開始日之前的日期序號為負數（實際開始日早於專案開始時會用到）。
 */
export function buildCalendarIndex(cal: WorkCalendar, startIso: string): CalendarIndex {
  if (!cal.workWeek.some(Boolean)) throw new Error('工作日曆至少要有一天是工作天');
  const holidays = new Set(cal.holidays.map(toDayNum));
  const extra = new Set(cal.extraWorkdays.map(toDayNum));
  const isWork = (n: number) => isWorkdayNum(cal, n, holidays, extra);

  const origin = toDayNum(startIso);
  // forward[i] = 第 i 個工作天的日序號；backward[i] = 第 -(i+1) 個工作天
  const forward: number[] = [];
  const backward: number[] = [];
  let fCursor = origin;
  let bCursor = origin - 1;

  const ensureForward = (i: number) => {
    while (forward.length <= i) {
      while (!isWork(fCursor)) fCursor++;
      forward.push(fCursor++);
    }
  };
  const ensureBackward = (i: number) => {
    while (backward.length <= i) {
      while (!isWork(bCursor)) bCursor--;
      backward.push(bCursor--);
    }
  };

  const dateOf = (index: number): string => {
    if (!Number.isFinite(index) || Math.abs(index) > MAX_CALENDAR_SPAN) throw new Error('日期超出可計算範圍，請檢查工期或 Lag 是否填錯');
    if (index >= 0) { ensureForward(index); return fromDayNum(forward[index]); }
    const i = -index - 1; ensureBackward(i); return fromDayNum(backward[i]);
  };

  // 找出 >= dayNum 的第一個工作天序號
  const indexOnOrAfterNum = (dayNum: number): number => {
    if (Math.abs(dayNum - origin) > MAX_CALENDAR_SPAN) throw new Error('日期超出可計算範圍');
    if (dayNum >= origin) {
      // 先往後補足索引，直到最後一個工作天 >= dayNum，再用二分搜尋
      ensureForward(0);
      while (forward[forward.length - 1] < dayNum) ensureForward(forward.length);
      let lo = 0, hi = forward.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (forward[mid] >= dayNum) hi = mid; else lo = mid + 1;
      }
      return lo;
    }
    // 開始日之前：往回找，最後一個 >= dayNum 的負序號
    let i = 0;
    let best = 0; // 若都找不到，回傳 0（開始日）
    while (true) {
      ensureBackward(i);
      if (backward[i] < dayNum) return best;
      best = -(i + 1);
      i++;
    }
  };

  return {
    dateOf,
    indexOnOrAfter: (iso) => indexOnOrAfterNum(toDayNum(iso)),
    indexOnOrBefore: (iso) => {
      const n = toDayNum(iso);
      const i = indexOnOrAfterNum(n);
      // 若 i 對應的日期剛好是 n，就是它；否則前一個工作天
      return toDayNum(dateOf(i)) === n ? i : i - 1;
    },
    isWorkday: (iso) => isWork(toDayNum(iso)),
  };
}

export const WORKWEEK_PRESETS: Record<string, { label: string; week: boolean[] }> = {
  five: { label: '週休二日（一～五）', week: [false, true, true, true, true, true, false] },
  six: { label: '週休一日（一～六）', week: [false, true, true, true, true, true, true] },
  seven: { label: '全年無休（日曆天）', week: [true, true, true, true, true, true, true] },
};
