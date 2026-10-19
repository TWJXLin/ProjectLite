import { buildCalendarIndex, WORKWEEK_PRESETS } from '../src/model/calendar';
import { weekday, toDayNum, fromDayNum, addDays } from '../src/model/dates';

const five = { workWeek: WORKWEEK_PRESETS.five.week, holidays: [], extraWorkdays: [] };

describe('日期工具', () => {
  it('日序號與日期互轉', () => {
    expect(fromDayNum(toDayNum('2026-02-28'))).toBe('2026-02-28');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
  it('星期判斷', () => {
    expect(weekday(toDayNum('2026-09-07'))).toBe(1); // 週一
    expect(weekday(toDayNum('2026-09-13'))).toBe(0); // 週日
  });
});

describe('工作日曆', () => {
  it('週休二日：第 5 個工作天跳過週末', () => {
    const cal = buildCalendarIndex(five, '2026-09-07');
    expect(cal.dateOf(0)).toBe('2026-09-07');
    expect(cal.dateOf(4)).toBe('2026-09-11'); // 週五
    expect(cal.dateOf(5)).toBe('2026-09-14'); // 下週一
  });
  it('開始日落在週末時，第 0 個工作天是下週一', () => {
    const cal = buildCalendarIndex(five, '2026-09-12');
    expect(cal.dateOf(0)).toBe('2026-09-14');
  });
  it('國定假日不算工作天，補班日要算', () => {
    const cal = buildCalendarIndex({ ...five, holidays: ['2026-09-08'], extraWorkdays: ['2026-09-12'] }, '2026-09-07');
    expect(cal.dateOf(1)).toBe('2026-09-09');
    expect(cal.dateOf(4)).toBe('2026-09-12'); // 週六補班
    expect(cal.isWorkday('2026-09-08')).toBe(false);
  });
  it('日期換回工作天序號', () => {
    const cal = buildCalendarIndex(five, '2026-09-07');
    expect(cal.indexOnOrAfter('2026-09-12')).toBe(5);  // 週六 → 下週一
    expect(cal.indexOnOrBefore('2026-09-12')).toBe(4); // 週六 → 本週五
    expect(cal.indexOnOrAfter('2026-09-04')).toBe(-1); // 開始日前的週五
  });
  it('全年無休就是日曆天', () => {
    const cal = buildCalendarIndex({ ...five, workWeek: WORKWEEK_PRESETS.seven.week }, '2026-09-07');
    expect(cal.dateOf(6)).toBe('2026-09-13');
  });
  it('沒有任何工作天時報錯', () => {
    expect(() => buildCalendarIndex({ ...five, workWeek: Array(7).fill(false) }, '2026-09-07')).toThrow();
  });
});
