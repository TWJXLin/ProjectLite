/**
 * 畫面狀態：只影響「怎麼看」，不影響專案資料本身。
 * 例如目前選了哪個任務、甘特圖縮放、要不要顯示相依線。
 * 這些偏好存在瀏覽器，下次打開會記得。
 */
import type { Era } from './format';

export type Zoom = 'day' | 'week' | 'month';

export const COLUMNS = {
  wbs: { label: 'WBS', width: 56 },
  name: { label: '任務名稱', width: 230 },
  duration: { label: '工期', width: 58 },
  start: { label: '開始', width: 86 },
  finish: { label: '完成', width: 86 },
  progress: { label: '進度', width: 74 },
  float: { label: '浮時', width: 52 },
  responsible: { label: '負責人', width: 84 },
  lateStart: { label: '最晚開始', width: 86 },
  lateFinish: { label: '最晚完成', width: 86 },
  baselineFinish: { label: '基準完成', width: 86 },
  variance: { label: '落後', width: 52 },
  budget: { label: '預算', width: 92 },
  actualCost: { label: '實際成本', width: 92 },
} as const;
export type ColumnKey = keyof typeof COLUMNS;
export const ALL_COLUMNS = Object.keys(COLUMNS) as ColumnKey[];

export interface UiState {
  selected: string | null;
  multi: string[];            // Ctrl+點選的順序，用來串連任務
  collapsed: string[];
  zoom: Zoom;
  era: Era;
  showDeps: boolean;
  showCrit: boolean;
  critOnly: boolean;
  showBaseline: boolean;
  columns: ColumnKey[];
  listWidth: number | null;   // 拖曳分隔線後的寬度
  drawerOpen: boolean;
}

const KEY = 'projectlite.ui.v1';

export function defaultUi(): UiState {
  return {
    selected: null, multi: [], collapsed: [], zoom: 'week', era: 'roc',
    showDeps: true, showCrit: true, critOnly: false, showBaseline: true,
    columns: ['wbs', 'name', 'duration', 'start', 'finish', 'progress'],
    listWidth: null, drawerOpen: false,
  };
}

export function loadUi(): UiState {
  const base = defaultUi();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    const merged = { ...base, ...saved, selected: null, multi: [], drawerOpen: false };
    merged.columns = (merged.columns as string[]).filter((c): c is ColumnKey => c in COLUMNS);
    if (!merged.columns.includes('name')) merged.columns.unshift('name');
    return merged;
  } catch { return base; }
}

export function saveUi(ui: UiState) {
  try {
    const { selected: _s, multi: _m, drawerOpen: _d, ...keep } = ui;
    localStorage.setItem(KEY, JSON.stringify(keep));
  } catch { /* 無痕模式等情況存不了，忽略 */ }
}
