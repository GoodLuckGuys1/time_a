export interface TimeEntry {
  id: string | number;
  issueKey?: string;
  duration: string;
  minutes?: number;
  formatted: string;
  comment: string;
  author: string;
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
  totalMinutes: number;
  totalFormatted: string;
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
  payload: { minutes: number; comment?: string },
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
