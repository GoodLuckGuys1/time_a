import type { DayRow, ExtraAssigneeOption, TaskRow, TimeReport } from "./api";

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
  date: string;
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

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  while (cursor <= end) {
    dates.push(formatLocalDate(cursor));
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

/** План спринта: первоначальная оценка (поле estimation в Tracker — это остаток). */
export function sprintPlannedMinutes(issue: { originalMinutes: number; minutes: number }): number {
  if (issue.originalMinutes > 0) return issue.originalMinutes;
  return issue.minutes;
}

/** Ключ сортировки по фамилии (последнее слово в display name). */
export function surnameSortKey(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return parts[parts.length - 1].toLocaleLowerCase("ru-RU");
  return trimmed.toLocaleLowerCase("ru-RU");
}

export function compareBySurname(a: string, b: string): number {
  const bySurname = surnameSortKey(a).localeCompare(surnameSortKey(b), "ru-RU");
  if (bySurname !== 0) return bySurname;
  return a.localeCompare(b, "ru-RU");
}

export const ALL_TEAMS_ID = "__all_teams__";
export const NO_TEAM_LABEL = "Без команды";

export function listSprintTeams(
  report: { teams?: string[]; groups?: { teams?: { id: string; name: string }[] }[] },
): string[] {
  const names = new Set<string>(report.teams ?? []);
  for (const group of report.groups ?? []) {
    for (const team of group.teams ?? []) {
      if (team.id && team.id !== NO_TEAM_LABEL) names.add(team.id);
    }
  }
  return [...names].sort((a, b) => {
    const na = /^Команда-(\d+)$/i.exec(a);
    const nb = /^Команда-(\d+)$/i.exec(b);
    if (na && nb) return Number(na[1]) - Number(nb[1]);
    if (na) return -1;
    if (nb) return 1;
    return a.localeCompare(b, "ru-RU");
  });
}

export function filterGroupByTeam<
  T extends {
    teams?: Array<{
      id: string;
      assignees: unknown[];
      issueCount?: number;
      totalOriginalMinutes?: number;
      totalOriginalFormatted?: string;
      totalMinutes?: number;
      totalFormatted?: string;
      totalSpentMinutes?: number;
      totalSpentFormatted?: string;
    }>;
    assignees: unknown[];
    issueCount?: number;
    totalOriginalMinutes?: number;
    totalOriginalFormatted?: string;
    totalMinutes?: number;
    totalFormatted?: string;
    totalSpentMinutes?: number;
    totalSpentFormatted?: string;
  },
>(group: T, selectedTeam: string): T {
  if (!selectedTeam || selectedTeam === ALL_TEAMS_ID) return group;
  const teams = (group.teams ?? []).filter((t) => t.id === selectedTeam);
  if (!teams.length) {
    return {
      ...group,
      teams: [],
      assignees: [] as T["assignees"],
      issueCount: 0,
      totalOriginalMinutes: 0,
      totalOriginalFormatted: "",
      totalMinutes: 0,
      totalFormatted: "",
      totalSpentMinutes: 0,
      totalSpentFormatted: "",
    };
  }
  const team = teams[0];
  return {
    ...group,
    teams,
    assignees: team.assignees as T["assignees"],
    issueCount: team.issueCount ?? 0,
    totalOriginalMinutes: team.totalOriginalMinutes ?? 0,
    totalOriginalFormatted: team.totalOriginalFormatted ?? "",
    totalMinutes: team.totalMinutes ?? 0,
    totalFormatted: team.totalFormatted ?? "",
    totalSpentMinutes: team.totalSpentMinutes ?? 0,
    totalSpentFormatted: team.totalSpentFormatted ?? "",
  };
}

export function listSprintAssignees(
  report: { groups?: { assignees: { id: string; name: string }[] }[] },
): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const group of report.groups ?? []) {
    for (const a of group.assignees) {
      if (!byId.has(a.id)) byId.set(a.id, a.name);
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => compareBySurname(a.name, b.name));
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

function assigneeAliasIds(
  selectedId: string,
  assignees: IssueAssigneeOption[],
  extraAssignees?: ExtraAssigneeOption[],
): Set<string> {
  const ids = new Set<string>([selectedId]);
  const picked = assignees.find((a) => a.id === selectedId);
  if (picked) ids.add(picked.id);
  const extra = extraAssignees?.find(
    (row) => row.id === selectedId || row.login === selectedId || row.uid === selectedId,
  );
  if (extra) {
    ids.add(extra.id);
    if (extra.login) ids.add(extra.login);
    if (extra.uid) ids.add(extra.uid);
  }
  return ids;
}

function entryMatchesAssignee(
  entry: { authorKey?: string; authorLogin?: string; author?: string },
  selectedId: string,
  assignees: IssueAssigneeOption[],
  extraAssignees?: ExtraAssigneeOption[],
): boolean {
  if (selectedId === ALL_ASSIGNEES_ID) return true;
  const aliases = assigneeAliasIds(selectedId, assignees, extraAssignees);
  const entryId = issueEntryAuthorId(entry);
  if (aliases.has(entryId)) return true;
  if (entry.authorKey && aliases.has(entry.authorKey)) return true;
  if (entry.authorLogin && aliases.has(entry.authorLogin)) return true;
  const picked = assignees.find((a) => a.id === selectedId);
  if (picked && entry.author?.trim() === picked.name.trim()) return true;
  return false;
}

export function hasAssigneeInReport(
  report: TimeReport,
  assigneeId: string,
  assignees: IssueAssigneeOption[],
): boolean {
  for (const day of report.days) {
    for (const task of day.tasks) {
      for (const entry of task.entries) {
        if (entryMatchesAssignee(entry, assigneeId, assignees, report.extraAssignees)) {
          return true;
        }
      }
    }
  }
  return false;
}

function formatMinutesRu(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}ч ${m}м`;
  if (h) return `${h}ч`;
  return `${m}м`;
}

function stripAssigneeFromDays(
  days: DayRow[],
  assigneeId: string,
  assignees: IssueAssigneeOption[],
  extraAssignees?: ExtraAssigneeOption[],
): DayRow[] {
  const result: DayRow[] = [];
  for (const day of days) {
    const tasks: TaskRow[] = [];
    let dayMinutes = 0;
    for (const task of day.tasks) {
      const kept = task.entries.filter(
        (e) => !entryMatchesAssignee(e, assigneeId, assignees, extraAssignees),
      );
      if (kept.length === 0) continue;
      const minutes = kept.reduce((sum, e) => sum + (e.minutes ?? 0), 0);
      tasks.push({
        ...task,
        entries: kept,
        minutes,
        formatted: formatMinutesRu(minutes),
      });
      dayMinutes += minutes;
    }
    if (tasks.length === 0) continue;
    result.push({
      date: day.date,
      tasks,
      totalMinutes: dayMinutes,
      totalFormatted: formatMinutesRu(dayMinutes),
    });
  }
  return result;
}

function mergeDayMaps(baseDays: DayRow[], patchDays: DayRow[]): DayRow[] {
  const byDate = new Map<string, DayRow>();
  for (const day of baseDays) {
    byDate.set(day.date, {
      date: day.date,
      totalMinutes: day.totalMinutes,
      totalFormatted: day.totalFormatted,
      tasks: day.tasks.map((t) => ({
        ...t,
        entries: [...t.entries],
      })),
    });
  }

  for (const patchDay of patchDays) {
    let day = byDate.get(patchDay.date);
    if (!day) {
      day = {
        date: patchDay.date,
        totalMinutes: 0,
        totalFormatted: "0м",
        tasks: [],
      };
      byDate.set(patchDay.date, day);
    }
    const taskMap = new Map(day.tasks.map((t) => [t.issueKey, t]));
    for (const patchTask of patchDay.tasks) {
      let task = taskMap.get(patchTask.issueKey);
      if (!task) {
        task = {
          issueKey: patchTask.issueKey,
          issueTitle: patchTask.issueTitle,
          issueUrl: patchTask.issueUrl,
          minutes: 0,
          formatted: "0м",
          entries: [],
        };
        taskMap.set(patchTask.issueKey, task);
        day.tasks.push(task);
      }
      task.entries.push(...patchTask.entries);
      task.minutes = task.entries.reduce((sum, e) => sum + (e.minutes ?? 0), 0);
      task.formatted = formatMinutesRu(task.minutes);
    }
    day.totalMinutes = day.tasks.reduce((sum, t) => sum + t.minutes, 0);
    day.totalFormatted = formatMinutesRu(day.totalMinutes);
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Подменяет списания выбранного исполнителя данными точечного /api/time-report?assignee=… */
export function mergeAssigneeIntoReport(
  base: TimeReport,
  patch: TimeReport,
  assigneeId: string,
): TimeReport {
  if (!assigneeId || assigneeId === ALL_ASSIGNEES_ID) return patch;

  const assignees = [
    ...listIssueAssignees(base),
    ...listIssueAssignees(patch),
  ];
  // уникальные по id
  const seen = new Set<string>();
  const uniqAssignees = assignees.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  const extraAssignees = [...(base.extraAssignees ?? []), ...(patch.extraAssignees ?? [])].filter(
    (row, index, all) => all.findIndex((other) => other.id === row.id) === index,
  );

  const stripped = stripAssigneeFromDays(base.days, assigneeId, uniqAssignees, extraAssignees);
  const days = mergeDayMaps(stripped, patch.days);
  const totalMinutes = days.reduce((sum, d) => sum + d.totalMinutes, 0);
  const worklogCount = days.reduce(
    (sum, d) => sum + d.tasks.reduce((s, t) => s + t.entries.length, 0),
    0,
  );

  const isSelf =
    !!base.currentUser &&
    (assigneeId === base.currentUser.id ||
      (base.currentUser.login && assigneeId === base.currentUser.login) ||
      uniqAssignees.find((a) => a.id === assigneeId)?.name.trim() ===
        base.currentUser.name.trim());

  return {
    ...base,
    days,
    totalMinutes,
    totalFormatted: formatMinutesRu(totalMinutes),
    worklogCount,
    extraAssignees,
    board: {
      ...base.board,
      issuesOnBoard: Math.max(base.board.issuesOnBoard, patch.board.issuesOnBoard),
    },
    ...(isSelf
      ? {
          myDays: patch.myDays ?? patch.days,
          myTotalMinutes: patch.myTotalMinutes ?? patch.totalMinutes,
          myTotalFormatted: patch.myTotalFormatted ?? patch.totalFormatted,
        }
      : {}),
  };
}

export function listIssueAssignees(report: TimeReport): IssueAssigneeOption[] {
  const byId = new Map<string, string>();
  for (const extra of report.extraAssignees ?? []) {
    byId.set(extra.id, extra.name?.trim() || extra.login || extra.id);
  }
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
    .sort((a, b) => compareBySurname(a.name, b.name));
}

function worklogEntryDate(start: string | undefined, fallback: string): string {
  if (start && start.length >= 10) return start.slice(0, 10);
  return fallback;
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
        if (mode === "issue" && !entryMatchesAssignee(entry, issueAssigneeId, assignees, report.extraAssignees)) {
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
          date: worklogEntryDate(entry.start, day.date),
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

  const rows = [...rowsMap.values()].sort((a, b) =>
    mode === "user"
      ? compareBySurname(a.primary, b.primary)
      : b.totalMinutes - a.totalMinutes,
  );
  const colTotals: Record<string, number> = {};
  for (const d of dates) {
    colTotals[d] = rows.reduce((sum, r) => sum + (r.byDate[d] ?? 0), 0);
  }
  const grandTotal = rows.reduce((sum, r) => sum + r.totalMinutes, 0);
  return { dates, rows, colTotals, grandTotal, cells: cellsMap };
}


