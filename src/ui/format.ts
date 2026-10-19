/** 顯示用的格式：民國/西元日期、金額、HTML 跳脫 */
export type Era = 'roc' | 'ad';

const p2 = (n: number) => String(n).padStart(2, '0');

export function eraYear(y: number, era: Era) { return era === 'roc' ? y - 1911 : y; }

/** 115/09/07 或 2026/09/07 */
export function fmtDate(iso: string | undefined, era: Era): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${eraYear(y, era)}/${p2(m)}/${p2(d)}`;
}

/** 9/7 */
export function fmtMD(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

export function fmtMoney(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '';
  return Math.round(n).toLocaleString('zh-TW');
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export const REL_LABEL: Record<string, string> = {
  FS: 'FS 完成→開始',
  SS: 'SS 開始→開始',
  FF: 'FF 完成→完成',
  SF: 'SF 開始→完成',
};
