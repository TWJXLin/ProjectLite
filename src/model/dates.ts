/**
 * 日期工具。內部把日期換成「日序號」（自 1970-01-01 起第幾天）來算，
 * 完全不碰時區，避免跨時區或夏令時間造成差一天的錯誤。
 */
const MS_PER_DAY = 86_400_000;

export function toDayNum(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromDayNum(n: number): string {
  const dt = new Date(n * MS_PER_DAY);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** 0=週日 … 6=週六 */
export function weekday(dayNum: number): number {
  // 1970-01-01 是星期四
  return ((dayNum + 4) % 7 + 7) % 7;
}

export function addDays(iso: string, n: number): string {
  return fromDayNum(toDayNum(iso) + n);
}

export function isValidIso(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromDayNum(toDayNum(s)) === s;
}

export function todayIso(): string {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
