/** 對話框：專案設定、欄位選擇、使用說明；以及檔案匯出匯入 */
import type { App } from './app';
import { COLUMNS, ALL_COLUMNS, type ColumnKey } from './state';
import { WORKWEEK_PRESETS } from '../model/calendar';
import { TW_HOLIDAYS } from '../model/holidays-tw';
import { isValidIso, todayIso } from '../model/dates';
import { validateProject } from '../model/store';
import { esc, fmtDate } from './format';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function parseDateList(text: string): { dates: string[]; bad: string[] } {
  const dates: string[] = [], bad: string[] = [];
  for (const line of text.split(/\n/)) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    const iso = m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
    if (isValidIso(iso)) dates.push(iso); else bad.push(s);
  }
  return { dates: [...new Set(dates)].sort(), bad };
}

function holidayText(dates: string[]) {
  const names = new Map(Object.values(TW_HOLIDAYS).flat().map((h) => [h.date, h.name]));
  return dates.map((d) => (names.has(d) ? `${d} ${names.get(d)}` : d)).join('\n');
}

export function openSettings(app: App) {
  const dlg = app.$('settingsDlg') as HTMLDialogElement;
  const p = app.store.project;
  const years = Object.keys(TW_HOLIDAYS);
  dlg.innerHTML = `<form method="dialog" class="dlg" id="settingsForm">
    <h2>專案設定</h2>
    <div class="dlg-body">
      <div class="fgrid">
        <label class="field full"><span>專案名稱</span><input id="sName" value="${esc(p.name)}" required></label>
        <label class="field"><span>專案開始日</span><input type="date" id="sStart" value="${p.start}" required></label>
        <label class="field"><span>資料日期</span><input type="date" id="sData" value="${p.dataDate}" required>
          <span class="hint">進度回報到哪一天。還沒開始的工作不會排在這天之前。</span></label>
      </div>
      <div><button type="button" class="btn" id="sDataToday">資料日期設為今天</button></div>
      <section>
        <h3>每週工作天</h3>
        <div class="week-picks">${WEEK.map((w, i) => `<label><input type="checkbox" data-wd="${i}" ${p.calendar.workWeek[i] ? 'checked' : ''}> 週${w}</label>`).join('')}</div>
        <div class="presets" style="margin-top:8px">${Object.entries(WORKWEEK_PRESETS).map(([k, v]) => `<button type="button" class="btn" data-preset="${k}">${v.label}</button>`).join('')}</div>
      </section>
      <section class="fgrid">
        <label class="field full"><span>放假日（一行一天，可在日期後面寫說明）</span>
          <textarea id="sHolidays" rows="7" class="num">${esc(holidayText(p.calendar.holidays))}</textarea></label>
        <div class="field full presets">${years.map((y) => `<button type="button" class="btn" data-tw="${y}">加入台灣 ${y} 年國定假日</button>`).join('')}</div>
        <span class="hint field full">預設假日依人事行政總處公告整理，請自行核對。颱風假、停工日也可以加在這裡。</span>
        <label class="field full"><span>補班日（原本放假但要上班）</span>
          <textarea id="sExtra" rows="2" class="num">${esc(p.calendar.extraWorkdays.join('\n'))}</textarea></label>
      </section>
      <div class="err-text" id="sErr"></div>
    </div>
    <div class="dlg-foot"><button class="btn" value="cancel" formnovalidate>取消</button><button class="btn primary" value="ok" id="sOk">儲存</button></div>
  </form>`;

  const $ = <T extends HTMLElement>(sel: string) => dlg.querySelector<T>(sel)!;
  $('#sDataToday').addEventListener('click', () => { $<HTMLInputElement>('#sData').value = todayIso(); });
  dlg.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const week = WORKWEEK_PRESETS[b.dataset.preset!].week;
    dlg.querySelectorAll<HTMLInputElement>('[data-wd]').forEach((c) => { c.checked = week[Number(c.dataset.wd)]; });
  }));
  dlg.querySelectorAll<HTMLButtonElement>('[data-tw]').forEach((b) => b.addEventListener('click', () => {
    const ta = $<HTMLTextAreaElement>('#sHolidays');
    const { dates } = parseDateList(ta.value);
    const merged = [...new Set([...dates, ...TW_HOLIDAYS[Number(b.dataset.tw)].map((h) => h.date)])].sort();
    ta.value = holidayText(merged);
  }));

  $('#sOk').addEventListener('click', (e) => {
    const err = $('#sErr');
    const name = $<HTMLInputElement>('#sName').value.trim();
    const start = $<HTMLInputElement>('#sStart').value;
    const dataDate = $<HTMLInputElement>('#sData').value;
    const workWeek = [...dlg.querySelectorAll<HTMLInputElement>('[data-wd]')].map((c) => c.checked);
    const hol = parseDateList($<HTMLTextAreaElement>('#sHolidays').value);
    const ext = parseDateList($<HTMLTextAreaElement>('#sExtra').value);
    const problems: string[] = [];
    if (!name) problems.push('請輸入專案名稱');
    if (!isValidIso(start)) problems.push('請選擇專案開始日');
    if (!isValidIso(dataDate)) problems.push('請選擇資料日期');
    if (!workWeek.some(Boolean)) problems.push('每週至少要有一天工作天');
    if (hol.bad.length) problems.push(`看不懂的放假日：${hol.bad.slice(0, 3).join('、')}（格式請用 2026-10-10）`);
    if (ext.bad.length) problems.push(`看不懂的補班日：${ext.bad.slice(0, 3).join('、')}`);
    if (problems.length) { e.preventDefault(); err.textContent = problems.join('；'); return; }
    app.store.updateProject({ name, start, dataDate, calendar: { workWeek, holidays: hol.dates, extraWorkdays: ext.dates } });
    app.toast('專案設定已更新，排程已重新計算');
  });
  dlg.showModal();
}

export function openColumns(app: App) {
  const dlg = app.$('settingsDlg') as HTMLDialogElement;
  dlg.innerHTML = `<form method="dialog" class="dlg"><h2>表格欄位</h2>
    <div class="dlg-body"><div class="week-picks">${ALL_COLUMNS.map((k) => `<label><input type="checkbox" data-col="${k}" ${app.ui.columns.includes(k) ? 'checked' : ''} ${k === 'name' ? 'disabled' : ''}> ${COLUMNS[k].label}</label>`).join('')}</div>
    <p class="note">任務名稱一定會顯示。拖曳表格和甘特圖中間的分隔線可以調整寬度。</p></div>
    <div class="dlg-foot"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok" id="cOk">套用</button></div></form>`;
  dlg.querySelector('#cOk')!.addEventListener('click', () => {
    const picked = new Set([...dlg.querySelectorAll<HTMLInputElement>('[data-col]')].filter((c) => c.checked).map((c) => c.dataset.col as ColumnKey));
    picked.add('name');
    app.ui.columns = ALL_COLUMNS.filter((k) => picked.has(k));
    app.ui.listWidth = null;
    app.render();
  });
  dlg.showModal();
}

export function openHelp(app: App) {
  const dlg = app.$('helpDlg') as HTMLDialogElement;
  const k = (s: string) => s.split('+').map((x) => `<kbd>${x}</kbd>`).join('+');
  dlg.innerHTML = `<form method="dialog" class="dlg help"><h2>使用說明</h2>
    <div class="dlg-body">
      <section><h3>三步驟開始</h3>
        <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px">
          <li>「專案設定」填開始日、每週工作天和假日。</li>
          <li>「＋ 新增任務」建立工作項目，雙擊名稱或工期就能直接改。用 ⇥ 降階把細項放進階段底下。</li>
          <li>雙擊任務開啟編輯欄，加入「前置任務」。排程、關鍵路徑會自動算好。</li>
        </ol>
      </section>
      <section><h3>名詞</h3><dl>
        <dt>工作天</dt><dd>扣掉週末與假日後的天數。工期都以工作天計。</dd>
        <dt>前置任務</dt><dd>要等它到某個狀態，這個任務才能開始或完成。</dd>
        <dt>FS 完成→開始</dt><dd>最常用。前一項做完，這一項才開始。</dd>
        <dt>SS 開始→開始</dt><dd>前一項開始後，這一項就能開始（可搭配 Lag，例如開始 5 天後）。</dd>
        <dt>FF 完成→完成</dt><dd>前一項完成後，這一項才能完成。</dd>
        <dt>SF 開始→完成</dt><dd>前一項開始後，這一項才能完成。很少用。</dd>
        <dt>Lag</dt><dd>關係的延後天數。正數延後，負數代表提前（重疊）。</dd>
        <dt>浮時</dt><dd>這個任務可以延誤幾天而不影響完工日。</dd>
        <dt>關鍵路徑</dt><dd>浮時為 0 的任務串成的路線，晚一天整個專案就晚一天。紅框標示。</dd>
        <dt>資料日期</dt><dd>進度回報的截止日。之後才會發生的工作從這天往後排。</dd>
        <dt>基準線</dt><dd>某個時間點排程的快照。之後可以比較實際排程晚了多少（甘特圖下方灰條）。</dd>
      </dl></section>
      <section><h3>快捷鍵</h3><dl>
        <dt>${k('Insert')} 或 ${k('Ctrl+Enter')}</dt><dd>在下方新增任務</dd>
        <dt>${k('Tab')} / ${k('Shift+Tab')}</dt><dd>降階 / 升階</dd>
        <dt>${k('Alt+↑')} / ${k('Alt+↓')}</dt><dd>上移 / 下移</dd>
        <dt>${k('↑')} / ${k('↓')}</dt><dd>選上一個 / 下一個任務</dd>
        <dt>${k('F2')}</dt><dd>改名稱</dd>
        <dt>${k('Enter')}</dt><dd>開啟編輯欄</dd>
        <dt>${k('Delete')}</dt><dd>刪除任務</dd>
        <dt>${k('Ctrl+Z')} / ${k('Ctrl+Y')}</dt><dd>復原 / 重做</dd>
        <dt>${k('Ctrl')}+點選</dt><dd>多選，再按「串連」依序建立前置關係</dd>
      </dl></section>
    </div>
    <div class="dlg-foot"><button class="btn primary" value="ok">知道了</button></div></form>`;
  dlg.showModal();
}

// ---------- 檔案 ----------
function download(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'project';

export function exportJson(app: App) {
  const p = app.store.project;
  download(`${safeName(p.name)}_${todayIso()}.json`, 'application/json', JSON.stringify(p, null, 2));
  app.toast('已下載備份檔');
}

export function exportCsv(app: App) {
  const { store, ui } = app;
  const r = store.result;
  const head = ['WBS', '任務名稱', '工期(工作天)', '開始', '完成', '最晚開始', '最晚完成', '總浮時', '關鍵路徑', '進度%', '前置任務', '負責人', '預算', '實際成本', '基準完成', '完成差異', '備註'];
  const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // 使用者輸入的文字若以 = + - @ 開頭，Excel 會當成公式執行；前面補一個單引號讓它變成純文字
  const text = (v: unknown) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
  const rows = r.order.map((id) => {
    const t = store.task(id)!, s = r.byId[id];
    const preds = t.preds.map((p) => `${r.byId[p.id]?.wbs ?? p.id}${p.type}${p.lag ? (p.lag > 0 ? '+' : '') + p.lag : ''}`).join(' ');
    return [
      s.wbs, text('　'.repeat(s.depth) + t.name), s.isSummary ? '' : t.duration, fmtDate(s.start, ui.era), fmtDate(s.finish, ui.era),
      fmtDate(s.lateStart ?? undefined, ui.era), fmtDate(s.lateFinish ?? undefined, ui.era),
      s.float ?? '', s.critical ? '是' : '', s.progress, preds, text(t.responsible), t.budget ?? '', t.actualCost ?? '',
      fmtDate(s.baselineFinish, ui.era), s.finishVariance ?? '', text(t.notes),
    ].map(q).join(',');
  });
  // 開頭加 BOM，Excel 打開中文才不會亂碼
  download(`${safeName(store.project.name)}_${todayIso()}.csv`, 'text/csv;charset=utf-8', '﻿' + [head.join(','), ...rows].join('\r\n'));
  app.toast('已下載 CSV，可用 Excel 開啟');
}

export function bindImport(app: App) {
  const input = app.$('fileInput') as HTMLInputElement;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const project = validateProject(JSON.parse(await file.text()));
      const ok = await app.confirm('開啟備份檔', `要用「${project.name}」（${project.tasks.length} 個任務）取代目前的專案嗎？取代後仍可按復原救回。`, '開啟');
      if (!ok) return;
      app.ui.selected = null; app.ui.collapsed = []; app.ui.drawerOpen = false;
      app.store.replaceProject(project);
      app.toast('已開啟備份檔');
    } catch (err) {
      app.toast(`無法開啟：${err instanceof Error ? err.message : '檔案格式不正確'}`);
    }
  });
}
