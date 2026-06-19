import type { TimeReport } from "./api";

export type GroupMode = "issue" | "user";
export const ALL_ASSIGNEES_ID = "__all__";

export interface IssueAssigneeOption {
  id: string;
  name: string;
}

export interface TimesheetRow {
  id: string;
  primary: string;
  secondary?: string;
  link?: string;
  byDate: Record<string, number>;
  totalMinutes: number;
}

export interface TimesheetCellEntry {
  worklogId: string | number;
  issueKey: string;
  issueUrl: string;
  issueTitle: string;
  minutes: number;
  formatted: string;
  comment: string;
  author: string;
  authorKey?: string;
  authorLogin?: string;
}

export interface TimesheetCell {
  rowId: string;
  date: string;
  issueKey: string | null;
  entries: TimesheetCellEntry[];
  totalMinutes: number;
}

export function cellKey(rowId: string, date: string): string {
  return `${rowId}|${date}`;
}

export function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function isWeekend(iso: string): boolean {
  const day = new Date(iso + "T12:00:00").getDay();
  return day === 0 || day === 6;
}

export function formatColumnHeader(iso: string): { top: string; bottom: string } {
  const d = new Date(iso + "T12:00:00");
  return {
    top: d.toLocaleDateString("ru-RU", { weekday: "short" }),
    bottom: d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
  };
}

export function formatCellMinutes(minutes: number): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function formatTotalMinutes(minutes: number): string {
  return formatCellMinutes(minutes) || "0h";
}

export function minutesFromParts(hours: number, mins: number): number {
  return Math.max(0, Math.floor(hours) * 60 + Math.floor(mins));
}

export function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

function issueEntryAuthorId(entry: {
  authorKey?: string;
  authorLogin?: string;
  author?: string;
}): string {
  return entry.authorLogin || entry.authorKey || entry.author || "Без исполнителя";
}

export function isOwnWorklogEntry(
  entry: { authorKey?: string; authorLogin?: string; author?: string },
  currentUser?: { id: string; login?: string; name: string } | null,
): boolean {
  if (!currentUser) return false;
  const entryId = issueEntryAuthorId(entry);
  if (entryId === currentUser.id) return true;
  if (currentUser.login && entry.authorLogin === currentUser.login) return true;
  if (currentUser.login && entryId === currentUser.login) return true;
  if (currentUser.name && entry.author?.trim() === currentUser.name.trim()) return true;
  return false;
}

export function canEditIssueAssigneeFilter(
  selectedId: string,
  currentUser?: { id: string; login?: string; name: string } | null,
  assignees?: IssueAssigneeOption[],
): boolean {
  if (selectedId === ALL_ASSIGNEES_ID) return true;
  if (!currentUser) return false;
  if (selectedId === currentUser.id) return true;
  if (currentUser.login && selectedId === currentUser.login) return true;
  const selected = assignees?.find((a) => a.id === selectedId);
  if (selected && currentUser.name && selected.name.trim() === currentUser.name.trim()) return true;
  return false;
}

function entryMatchesAssignee(
  entry: { authorKey?: string; authorLogin?: string; author?: string },
  selectedId: string,
  assignees: IssueAssigneeOption[],
): boolean {
  if (selectedId === ALL_ASSIGNEES_ID) return true;
  const entryId = issueEntryAuthorId(entry);
  if (entryId === selectedId) return true;
  const picked = assignees.find((a) => a.id === selectedId);
  if (picked && entry.author?.trim() === picked.name.trim()) return true;
  return false;
}

export function listIssueAssignees(report: TimeReport): IssueAssigneeOption[] {
  const byId = new Map<string, string>();
  for (const day of report.days) {
    for (const task of day.tasks) {
      for (const entry of task.entries) {
        const id = issueEntryAuthorId(entry);
        if (!byId.has(id)) byId.set(id, entry.author?.trim() || id);
      }
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru-RU"));
}

export function buildTimesheet(
  report: TimeReport,
  mode: GroupMode,
  issueAssigneeId: string = ALL_ASSIGNEES_ID,
) {
  const dates = enumerateDates(report.period.from, report.period.to);
  const rowsMap = new Map<string, TimesheetRow>();
  const cellsMap = new Map<string, TimesheetCell>();
  const assignees = listIssueAssignees(report);

  for (const day of report.days) {
    for (const task of day.tasks) {
      for (const entry of task.entries) {
        const minutes = entry.minutes ?? 0;
        if (minutes <= 0) continue;
        if (mode === "issue" && !entryMatchesAssignee(entry, issueAssigneeId, assignees)) {
          continue;
        }

        const rowId = mode === "issue" ? task.issueKey : entry.author?.trim() || "Без исполнителя";
        let row = rowsMap.get(rowId);
        if (!row) {
          row = {
            id: rowId,
            primary: mode === "issue" ? task.issueKey : entry.author || "—",
            secondary: mode === "issue" ? task.issueTitle : task.issueKey,
            link: mode === "issue" ? task.issueUrl : undefined,
            byDate: {},
            totalMinutes: 0,
          };
          rowsMap.set(rowId, row);
        }

        row.byDate[day.date] = (row.byDate[day.date] ?? 0) + minutes;
        row.totalMinutes += minutes;

        const key = cellKey(rowId, day.date);
        let cell = cellsMap.get(key);
        if (!cell) {
          cell = {
            rowId,
            date: day.date,
            issueKey: mode === "issue" ? task.issueKey : null,
            entries: [],
            totalMinutes: 0,
          };
          cellsMap.set(key, cell);
        }
        cell.entries.push({
          worklogId: entry.id,
          issueKey: entry.issueKey ?? task.issueKey,
          issueUrl: task.issueUrl,
          issueTitle: task.issueTitle,
          minutes,
          formatted: entry.formatted,
          comment: entry.comment,
          author: entry.author,
          authorKey: entry.authorKey,
          authorLogin: entry.authorLogin,
        });
        cell.totalMinutes += minutes;
      }
    }
  }

  const rows = [...rowsMap.values()].sort((a, b) => b.totalMinutes - a.totalMinutes);
  const colTotals: Record<string, number> = {};
  for (const d of dates) {
    colTotals[d] = rows.reduce((sum, r) => sum + (r.byDate[d] ?? 0), 0);
  }
  const grandTotal = rows.reduce((sum, r) => sum + r.totalMinutes, 0);
  return { dates, rows, colTotals, grandTotal, cells: cellsMap };
}


