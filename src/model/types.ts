/**
 * 資料模型：整個工具只認這幾種資料。
 * 日期一律存成 'YYYY-MM-DD' 字串，存檔、匯出都好讀。
 */

/** 前置關係類型：FS 完成→開始、SS 開始→開始、FF 完成→完成、SF 開始→完成 */
export type RelType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Pred {
  id: string;     // 前置任務的 id
  type: RelType;
  lag: number;    // 工作天；正數延後、負數提前
}

export interface Task {
  id: string;
  name: string;
  parent: string | null;     // 上層任務 id；null 代表第一層
  duration: number;          // 工期（工作天）；里程碑為 0
  milestone: boolean;
  preds: Pred[];
  progress: number;          // 0–100
  actualStart?: string;      // 實際開始
  actualFinish?: string;     // 實際完成
  notEarlierThan?: string;   // 限制條件：不得早於此日開始
  responsible?: string;
  budget?: number;           // 預算（元）
  actualCost?: number;       // 實際成本（元）
  notes?: string;
}

export interface WorkCalendar {
  /** 一週七天是否上班，索引 0=週日 … 6=週六 */
  workWeek: boolean[];
  /** 放假日（含國定假日、颱風假等） */
  holidays: string[];
  /** 補班日：原本放假但要上班的日子 */
  extraWorkdays: string[];
}

export interface BaselineEntry { start: string; finish: string; }

export interface Baseline {
  savedAt: string;
  tasks: Record<string, BaselineEntry>;
}

export interface Project {
  version: 1;
  name: string;
  start: string;        // 專案開始日
  dataDate: string;     // 資料日期：進度回報的截止日，未開始的工作不會排在這天之前
  calendar: WorkCalendar;
  tasks: Task[];        // 依畫面順序排列（父任務在子任務前面）
  baseline?: Baseline;
}
