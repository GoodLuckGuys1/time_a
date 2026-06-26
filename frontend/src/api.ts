export interface TimeEntry {
  id: string | number;
  issueKey?: string;
  duration: string;
  minutes?: number;
  formatted: string;
  comment: string;
  author: string;
  authorKey?: string;
  authorLogin?: string;
  start?: string;
}

export interface TaskRow {
  issueKey: string;
  issueTitle: string;
  issueUrl: string;
  minutes: number;
  formatted: string;
  entries: TimeEntry[];
}

export interface DayRow {
  date: string;
  totalMinutes: number;
  totalFormatted: string;
  tasks: TaskRow[];
}

export interface TimeReport {
  board: {
    id: number;
    name: string;
    url: string;
    issuesOnBoard: number;
  };
  period: { from: string; to: string };
  currentUser?: { id: string; login?: string; name: string } | null;
  totalMinutes: number;
  totalFormatted: string;
  myDays?: DayRow[];
  myTotalMinutes?: number;
  myTotalFormatted?: string;
  days: DayRow[];
  worklogCount: number;
  stats?: {
    issuesScanned?: number;
    worklogsFromIssues?: number;
    worklogsFromSearch?: number;
    worklogsMerged?: number;
    worklogsInReport?: number;
    skippedOutOfPeriod?: number;
    skippedZeroDuration?: number;
  };
}

export interface ConfigStatus {
  configured: boolean;
  boardId: number;
  orgHeader: string;
  envPath?: string;
  hasToken?: boolean;
  hasOrgId?: boolean;
  hasClientId?: boolean;
  oauthStartUrl?: string;
  oauthRedirectUri?: string;
  oauthScope?: string;
  canEditWorklogs?: boolean;
  oauthAppInfoUrl?: string | null;
}

export async function fetchConfig(): Promise<ConfigStatus> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Не удалось получить конфигурацию");
  return res.json();
}

export async function fetchCheckWriteAccess(): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("/api/check-write-access");
  return res.json();
}

export async function discoverOrgFromText(
  text: string,
): Promise<{ found: Array<{ ok: boolean; orgId: string; orgHeader: string; display?: string }>; tried: number }> {
  const res = await fetch("/api/discover-org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Ошибка поиска");
  return body;
}

export async function testOrgId(
  orgId: string,
  orgHeader: string,
): Promise<{ ok: boolean; display?: string; detail?: unknown; hint?: string }> {
  const params = new URLSearchParams({ org_id: orgId, org_header: orgHeader });
  const res = await fetch(`/api/test-org?${params}`);
  return res.json();
}

function formatApiError(body: Record<string, unknown>, status: number): string {
  const detail = body.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(String).join("\n");
  return `Ошибка ${status}`;
}

export interface SprintLoadIssue {
  issueKey: string;
  issueTitle: string;
  issueUrl: string;
  originalMinutes: number;
  originalFormatted: string;
  minutes: number;
  formatted: string;
  spentMinutes: number;
  spentFormatted: string;
  status: string;
}

export interface SprintLoadAssignee {
  id: string;
  name: string;
  totalOriginalMinutes: number;
  totalOriginalFormatted: string;
  totalMinutes: number;
  totalFormatted: string;
  totalSpentMinutes: number;
  totalSpentFormatted: string;
  issueCount: number;
  issues: SprintLoadIssue[];
}

export interface SprintLoadGroup {
  label: string;
  sprintId?: string | null;
  url?: string | null;
  showSpent?: boolean;
  sprintStartDate?: string | null;
  sprintEndDate?: string | null;
  assignees: SprintLoadAssignee[];
  issueCount: number;
  issuesWithoutEstimate: number;
  totalOriginalMinutes: number;
  totalOriginalFormatted: string;
  totalMinutes: number;
  totalFormatted: string;
  totalSpentMinutes: number;
  totalSpentFormatted: string;
}

export interface SprintLoadReport {
  board: {
    id: number;
    name?: string;
    url: string;
  };
  groupBy?: "agile" | "label";
  groups?: SprintLoadGroup[];
  activeLabel?: string | null;
  sprint: {
    id: number | null;
    name: string;
    status?: string;
    startDate?: string | null;
    endDate?: string | null;
    url?: string | null;
  } | null;
  boardOnly?: boolean;
  message?: string;
  assignees: SprintLoadAssignee[];
  issueCount: number;
  issuesWithoutEstimate: number;
  totalOriginalMinutes: number;
  totalOriginalFormatted: string;
  totalMinutes: number;
  totalFormatted: string;
  showSpentColumn?: boolean;
  totalSpentMinutes?: number;
  totalSpentFormatted?: string;
  stats?: {
    issuesOnBoard?: number;
    issuesWithSprint?: number;
  };
}

export interface AssigneeWorklogEntry {
  id: string | number;
  date: string;
  minutes: number;
  formatted: string;
  comment: string;
  start?: string;
}

export interface AssigneeWorklogTask {
  issueKey: string;
  issueTitle: string;
  issueUrl: string;
  totalMinutes: number;
  totalFormatted: string;
  entries: AssigneeWorklogEntry[];
}

export interface AssigneeOption {
  id: string;
  name: string;
  totalMinutes: number;
  totalFormatted: string;
  worklogCount: number;
}

export interface AssigneeWorklogReport {
  board: { id: number; name?: string; url: string };
  period: { from: string; to: string };
  assignees: AssigneeOption[];
  currentUser: { id: string; name: string } | null;
  selectedAssigneeId: string | null;
  selectedAssigneeName: string | null;
  tasks: AssigneeWorklogTask[];
  totalMinutes: number;
  totalFormatted: string;
  worklogCount: number;
}

export async function fetchAssigneeWorklogs(
  from: string,
  to: string,
  boardId?: number,
  assigneeId?: string,
): Promise<AssigneeWorklogReport> {
  const params = new URLSearchParams({ from, to });
  if (boardId != null) params.set("board_id", String(boardId));
  if (assigneeId) params.set("assignee", assigneeId);
  const res = await fetch(`/api/assignee-worklogs?${params}`);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(formatApiError(body, res.status));
  return body as AssigneeWorklogReport;
}

export async function fetchSprintLoad(boardId?: number): Promise<SprintLoadReport> {
  const params = new URLSearchParams();
  if (boardId != null) params.set("board_id", String(boardId));
  const qs = params.toString();
  const res = await fetch(`/api/sprint-load${qs ? `?${qs}` : ""}`);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(formatApiError(body, res.status));
  }
  return body as SprintLoadReport;
}

export async function fetchTimeReport(from: string, to: string): Promise<TimeReport> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/time-report?${params}`);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(formatApiError(body, res.status));
  }
  return body as TimeReport;
}

export async function updateWorklog(
  issueKey: string,
  worklogId: string | number,
  payload: { minutes: number; comment?: string; day?: string },
): Promise<void> {
  const res = await fetch(`/api/issues/${encodeURIComponent(issueKey)}/worklog/${worklogId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(formatApiError(body, res.status));
}

export async function deleteWorklog(issueKey: string, worklogId: string | number): Promise<void> {
  const res = await fetch(
    `/api/issues/${encodeURIComponent(issueKey)}/worklog/${worklogId}`,
    { method: "DELETE" },
  );
  if (res.status === 204) return;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(formatApiError(body, res.status));
}

export async function createWorklog(
  issueKey: string,
  payload: { day: string; minutes: number; comment?: string },
): Promise<void> {
  const res = await fetch(`/api/issues/${encodeURIComponent(issueKey)}/worklog`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(formatApiError(body, res.status));
}
