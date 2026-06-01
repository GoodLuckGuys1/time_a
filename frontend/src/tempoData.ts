import type { TimeReport } from "./api";



export type GroupMode = "issue" | "user";



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



export function buildTimesheet(report: TimeReport, mode: GroupMode) {

  const dates = enumerateDates(report.period.from, report.period.to);

  const rowsMap = new Map<string, TimesheetRow>();

  const cellsMap = new Map<string, TimesheetCell>();



  for (const day of report.days) {

    for (const task of day.tasks) {

      for (const entry of task.entries) {

        const minutes = entry.minutes ?? 0;

        if (minutes <= 0) continue;



        const rowId =

          mode === "issue"

            ? task.issueKey

            : entry.author?.trim() || "Без исполнителя";



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


