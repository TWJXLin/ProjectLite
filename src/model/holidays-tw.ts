/**
 * 台灣國定假日預設表（含補假）。
 * 依《紀念日及節日實施條例》2025 年修正後的規定整理，
 * 實際以行政院人事行政總處公告的「政府行政機關辦公日曆表」為準。
 * 在「專案設定 → 工作日曆」可以自行增刪。
 */
export const TW_HOLIDAYS: Record<number, { date: string; name: string }[]> = {
  2026: [
    { date: '2026-01-01', name: '元旦' },
    { date: '2026-02-16', name: '除夕' },
    { date: '2026-02-17', name: '春節' },
    { date: '2026-02-18', name: '春節' },
    { date: '2026-02-19', name: '春節' },
    { date: '2026-02-20', name: '春節補假' },
    { date: '2026-02-27', name: '和平紀念日補假' },
    { date: '2026-04-03', name: '兒童節補假' },
    { date: '2026-04-06', name: '清明節補假' },
    { date: '2026-05-01', name: '勞動節' },
    { date: '2026-06-19', name: '端午節' },
    { date: '2026-09-25', name: '中秋節' },
    { date: '2026-09-28', name: '教師節' },
    { date: '2026-10-09', name: '國慶日補假' },
    { date: '2026-10-26', name: '臺灣光復節補假' },
    { date: '2026-12-25', name: '行憲紀念日' },
  ],
};

export function holidaysForYears(years: number[]): string[] {
  return years.flatMap((y) => (TW_HOLIDAYS[y] ?? []).map((h) => h.date));
}

export function holidayName(iso: string): string | undefined {
  const y = Number(iso.slice(0, 4));
  return TW_HOLIDAYS[y]?.find((h) => h.date === iso)?.name;
}
