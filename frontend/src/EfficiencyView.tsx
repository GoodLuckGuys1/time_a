import { Fragment, useEffect, useMemo, useState } from "react";

import {
  fetchSprintLoad,
  type SprintLoadGroup,
  type SprintLoadIssue,
  type SprintLoadReport,
} from "./api";
import { LoadingOverlay, LoadingPanel } from "./LoadingSpinner";
import { SprintAssigneeRefreshBar } from "./SprintAssigneeRefreshBar";
import { formatTotalMinutes, sprintPlannedMinutes, compareBySurname, ALL_TEAMS_ID, filterGroupByTeam, listSprintTeams, NO_TEAM_LABEL } from "./tempoData";

interface EfficiencyViewProps {
  boardId?: number;
}

interface EfficiencyIssueRow {
  issue: SprintLoadIssue;
  plannedMinutes: number;
  spentMinutes: number;
  deltaMinutes: number;
  ratioPct: number | null;
}

interface EfficiencyPersonRow {
  id: string;
  name: string;
  issueCount: number;
  plannedMinutes: number;
  spentMinutes: number;
  deltaMinutes: number;
  ratioPct: number | null;
  issues: EfficiencyIssueRow[];
}

function isClosedStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  if (!s) return false;
  return /закрыт|closed|done|resolved|выполнен|готово|complete/.test(s);
}

function ratioPct(planned: number, spent: number): number | null {
  if (planned <= 0) return null;
  return Math.round((spent / planned) * 100);
}

function buildPersonRows(group: SprintLoadGroup, closedOnly: boolean): EfficiencyPersonRow[] {
  const rows: EfficiencyPersonRow[] = [];

  for (const person of group.assignees) {
    const issues: EfficiencyIssueRow[] = [];
    for (const issue of person.issues) {
      if (closedOnly && !isClosedStatus(issue.status)) continue;
      const planned = sprintPlannedMinutes(issue);
      const spent = issue.spentMinutes || 0;
      if (planned <= 0 && spent <= 0) continue;
      issues.push({
        issue,
        plannedMinutes: planned,
        spentMinutes: spent,
        deltaMinutes: spent - planned,
        ratioPct: ratioPct(planned, spent),
      });
    }
    if (issues.length === 0) continue;

    const plannedMinutes = issues.reduce((s, i) => s + i.plannedMinutes, 0);
    const spentMinutes = issues.reduce((s, i) => s + i.spentMinutes, 0);
    rows.push({
      id: person.id,
      name: person.name,
      issueCount: issues.length,
      plannedMinutes,
      spentMinutes,
      deltaMinutes: spentMinutes - plannedMinutes,
      ratioPct: ratioPct(plannedMinutes, spentMinutes),
      issues: issues.sort((a, b) => b.spentMinutes - a.spentMinutes),
    });
  }

  return rows.sort(
    (a, b) =>
      compareBySurname(a.name, b.name) ||
      b.spentMinutes - a.spentMinutes ||
      b.plannedMinutes - a.plannedMinutes,
  );
}

function formatSignedMinutes(minutes: number): string {
  if (!minutes) return "0h";
  const sign = minutes > 0 ? "+" : "−";
  return `${sign}${formatTotalMinutes(Math.abs(minutes))}`;
}

function ratioClass(pct: number | null): string {
  if (pct == null) return "eff-ratio-na";
  if (pct <= 100) return "eff-ratio-ok";
  if (pct <= 120) return "eff-ratio-warn";
  return "eff-ratio-over";
}

function deltaClass(delta: number): string {
  if (delta > 0) return "eff-delta-over";
  if (delta < 0) return "eff-delta-under";
  return "";
}

function pickDefaultSprint(groups: SprintLoadGroup[], activeLabel?: string | null): string {
  if (!groups.length) return "";
  if (activeLabel) {
    const active = groups.find((g) => g.label === activeLabel);
    if (active) return active.sprintId ?? active.label;
  }
  const withSpent = groups.find((g) => g.showSpent);
  const pick = withSpent ?? groups[0];
  return pick.sprintId ?? pick.label;
}

function groupKey(group: SprintLoadGroup): string {
  return group.sprintId ?? group.label;
}

export function EfficiencyView({ boardId }: EfficiencyViewProps) {
  const [skeleton, setSkeleton] = useState<SprintLoadReport | null>(null);
  const [spentCache, setSpentCache] = useState<Record<string, SprintLoadReport>>({});
  const [loading, setLoading] = useState(true);
  const [assigneeRefreshing, setAssigneeRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSprint, setSelectedSprint] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [closedOnly, setClosedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState(ALL_TEAMS_ID);
  const [everyoneLoading, setEveryoneLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSpentCache({});
    fetchSprintLoad(boardId)
      .then((report) => {
        if (cancelled) return;
        setSkeleton(report);
        const groups = report.groups ?? [];
        setSelectedSprint(pickDefaultSprint(groups, report.activeLabel));
        const first = groups[0]?.assignees?.[0]?.id ?? "";
        setSelectedAssignee((prev) => prev || first);
      })
      .catch((e) => {
        if (cancelled) return;
        setSkeleton(null);
        setError(e instanceof Error ? e.message : "Не удалось загрузить данные");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  useEffect(() => {
    if (!skeleton || !selectedAssignee) return;
    if (spentCache[selectedAssignee]) return;
    let cancelled = false;
    setAssigneeRefreshing(true);
    setError(null);
    fetchSprintLoad(boardId, selectedAssignee)
      .then((report) => {
        if (cancelled) return;
        setSpentCache((prev) => ({ ...prev, [selectedAssignee]: report }));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Не удалось загрузить списания");
      })
      .finally(() => {
        if (!cancelled) setAssigneeRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, skeleton, selectedAssignee]);

  const data = useMemo(() => {
    if (!skeleton) return null;
    return spentCache[selectedAssignee] ?? skeleton;
  }, [skeleton, spentCache, selectedAssignee]);

  const spentLoaded = Boolean(selectedAssignee && spentCache[selectedAssignee]);

  const loadEveryone = async () => {
    setEveryoneLoading(true);
    setError(null);
    try {
      const report = await fetchSprintLoad(boardId, "__all__");
      setSkeleton(report);
      setSpentCache({});
      const groups = report.groups ?? [];
      setSelectedSprint((prev) => prev || pickDefaultSprint(groups, report.activeLabel));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить всех исполнителей");
    } finally {
      setEveryoneLoading(false);
    }
  };

  const refreshAssignee = async () => {
    if (!selectedAssignee) return;
    setAssigneeRefreshing(true);
    setError(null);
    try {
      const report = await fetchSprintLoad(boardId, selectedAssignee);
      setSpentCache((prev) => ({ ...prev, [selectedAssignee]: report }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить списания");
    } finally {
      setAssigneeRefreshing(false);
    }
  };

  const groups = data?.groups ?? [];
  const teamOptions = useMemo(() => listSprintTeams(skeleton ?? { teams: [] }), [skeleton]);
  const activeGroup = useMemo(
    () => groups.find((g) => groupKey(g) === selectedSprint) ?? groups[0] ?? null,
    [groups, selectedSprint],
  );

  const displayGroup = useMemo(() => {
    if (!activeGroup) return null;
    let group = activeGroup;
    if (selectedAssignee && !spentLoaded) {
      const matched = activeGroup.assignees.filter((a) => a.id === selectedAssignee);
      if (matched.length) {
        const teams = (activeGroup.teams ?? [])
          .map((team) => ({
            ...team,
            assignees: team.assignees.filter((a) => a.id === selectedAssignee),
          }))
          .filter((team) => team.assignees.length > 0);
        group = { ...activeGroup, assignees: matched, teams };
      }
    }
    return filterGroupByTeam(group, selectedTeam);
  }, [activeGroup, selectedAssignee, spentLoaded, selectedTeam]);

  const peopleSections = useMemo(() => {
    if (!displayGroup) return [];
    const sections =
      displayGroup.teams?.length
        ? displayGroup.teams
        : [
            {
              id: NO_TEAM_LABEL,
              name: NO_TEAM_LABEL,
              assignees: displayGroup.assignees,
            },
          ];
    return sections
      .map((team) => ({
        id: team.id,
        name: team.name,
        people: buildPersonRows(
          { ...displayGroup, assignees: team.assignees },
          closedOnly,
        ),
      }))
      .filter((section) => section.people.length > 0);
  }, [displayGroup, closedOnly]);

  const people = useMemo(
    () => peopleSections.flatMap((section) => section.people),
    [peopleSections],
  );

  const totals = useMemo(() => {
    const planned = people.reduce((s, p) => s + p.plannedMinutes, 0);
    const spent = people.reduce((s, p) => s + p.spentMinutes, 0);
    return {
      planned,
      spent,
      delta: spent - planned,
      ratio: ratioPct(planned, spent),
      issues: people.reduce((s, p) => s + p.issueCount, 0),
      people: people.length,
    };
  }, [people]);

  if (loading && !skeleton) {
    return <LoadingPanel message="Загрузка ваших задач…" />;
  }

  if (error && !skeleton) {
    return <p className="sprint-empty sprint-error">{error}</p>;
  }

  if (!data || !skeleton || groups.length === 0) {
    return (
      <p className="sprint-empty">
        {data?.message ??
          "Нет спринтов для расчёта. Укажите спринт в карточке задачи на доске Agile."}
      </p>
    );
  }

  if (!activeGroup) {
    return <p className="sprint-empty">Выберите спринт.</p>;
  }

  return (
    <div className="efficiency-view loading-host">
      {(loading || assigneeRefreshing || everyoneLoading) && (
        <LoadingOverlay
          message={
            assigneeRefreshing
              ? "Загрузка списаний…"
              : everyoneLoading
                ? "Загрузка всех исполнителей…"
                : "Обновление…"
          }
        />
      )}

      {error && <p className="sprint-empty sprint-error">{error}</p>}

      <SprintAssigneeRefreshBar
        data={skeleton}
        selectedAssignee={selectedAssignee}
        onSelectAssignee={setSelectedAssignee}
        onRefresh={refreshAssignee}
        refreshing={assigneeRefreshing}
        spentLoaded={spentLoaded}
        onLoadEveryone={loadEveryone}
        everyoneLoading={everyoneLoading}
        extra={
          <>
            <label className="field">
              <span>Спринт</span>
              <select
                value={groupKey(activeGroup)}
                onChange={(e) => {
                  setSelectedSprint(e.target.value);
                  setExpanded(null);
                }}
              >
                {groups.map((g) => (
                  <option key={groupKey(g)} value={groupKey(g)}>
                    {g.label}
                    {g.label === data.activeLabel ? " · текущий" : ""}
                    {!g.showSpent ? " · нет дат" : ""}
                  </option>
                ))}
              </select>
            </label>
            {teamOptions.length > 0 && (
              <label className="field">
                <span>Команда</span>
                <select
                  value={selectedTeam}
                  onChange={(e) => {
                    setSelectedTeam(e.target.value);
                    setExpanded(null);
                  }}
                >
                  <option value={ALL_TEAMS_ID}>Все команды</option>
                  {teamOptions.map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                  <option value={NO_TEAM_LABEL}>{NO_TEAM_LABEL}</option>
                </select>
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={closedOnly}
                onChange={(e) => {
                  setClosedOnly(e.target.checked);
                  setExpanded(null);
                }}
              />
              Только закрытые
            </label>
          </>
        }
      />

      {!spentLoaded && (
        <p className="inline-hint">Подтягиваем списания за даты спринта…</p>
      )}

      {!activeGroup.showSpent && (
        <p className="inline-hint">У спринта нет дат в Tracker — факт за период недоступен.</p>
      )}

      <div className="efficiency-summary">
        <article className="efficiency-stat">
          <span className="efficiency-stat-label">Запланировано</span>
          <strong className="efficiency-stat-value">
            {totals.planned ? formatTotalMinutes(totals.planned) : "—"}
          </strong>
        </article>
        <article className="efficiency-stat">
          <span className="efficiency-stat-label">Списано в спринте</span>
          <strong className="efficiency-stat-value efficiency-spent">
            {activeGroup.showSpent && spentLoaded && totals.spent
              ? formatTotalMinutes(totals.spent)
              : "—"}
          </strong>
        </article>
        <article className="efficiency-stat">
          <span className="efficiency-stat-label">Δ факт − план</span>
          <strong className={`efficiency-stat-value ${deltaClass(totals.delta)}`}>
            {activeGroup.showSpent && spentLoaded && totals.planned
              ? formatSignedMinutes(totals.delta)
              : "—"}
          </strong>
        </article>
        <article className="efficiency-stat">
          <span className="efficiency-stat-label">Факт / план</span>
          <strong className={`efficiency-stat-value ${ratioClass(totals.ratio)}`}>
            {activeGroup.showSpent && spentLoaded && totals.ratio != null ? `${totals.ratio}%` : "—"}
          </strong>
        </article>
      </div>

      <div className="sprint-head">
        <div>
          <span className="sprint-name">
            {activeGroup.url ? (
              <a href={activeGroup.url} target="_blank" rel="noreferrer">
                {activeGroup.label}
              </a>
            ) : (
              activeGroup.label
            )}
          </span>
          {activeGroup.sprintStartDate && activeGroup.sprintEndDate && (
            <span className="sprint-period">
              {activeGroup.sprintStartDate} — {activeGroup.sprintEndDate}
            </span>
          )}
        </div>
        <div className="sprint-meta">
          <span>{totals.people} чел.</span>
          <span>{totals.issues} задач</span>
        </div>
      </div>

      {people.length === 0 ? (
        <p className="sprint-empty">
          {closedOnly
            ? "Нет закрытых задач с оценкой или списаниями в этом спринте."
            : selectedTeam !== ALL_TEAMS_ID
              ? "Нет задач выбранной команды в этом спринте."
              : "Нет задач с оценкой или списаниями в этом спринте."}
        </p>
      ) : (
        <table className="sprint-table efficiency-table">
          <thead>
            <tr>
              <th>Исполнитель / задача</th>
              <th className="sprint-num">Задач</th>
              <th className="sprint-num">Запланировано</th>
              <th className="sprint-num">Списано</th>
              <th className="sprint-num">Δ</th>
              <th className="sprint-num">Факт / план</th>
            </tr>
          </thead>
          <tbody>
            {peopleSections.map((section) => (
              <Fragment key={section.id}>
                {(selectedTeam === ALL_TEAMS_ID || peopleSections.length > 1) && (
                  <tr className="sprint-team-row">
                    <td colSpan={6}>
                      <span className="sprint-team-title">{section.name}</span>
                    </td>
                  </tr>
                )}
                {section.people.map((person) => {
                  const rowId = `${section.id}:${person.id}`;
                  const open = expanded === rowId;
                  return (
                    <Fragment key={rowId}>
                      <tr
                        className={`sprint-row${open ? " sprint-row-open" : ""}`}
                        onClick={() => setExpanded(open ? null : rowId)}
                      >
                        <td>
                          <button type="button" className="sprint-toggle" aria-expanded={open}>
                            {open ? "▾" : "▸"}
                          </button>
                          <span className="tempo-user-name">{person.name}</span>
                        </td>
                        <td className="sprint-num">{person.issueCount}</td>
                        <td className="sprint-num sprint-hours">
                          {person.plannedMinutes ? formatTotalMinutes(person.plannedMinutes) : "—"}
                        </td>
                        <td className="sprint-num sprint-spent">
                          {activeGroup.showSpent && spentLoaded && person.spentMinutes
                            ? formatTotalMinutes(person.spentMinutes)
                            : "—"}
                        </td>
                        <td className={`sprint-num ${deltaClass(person.deltaMinutes)}`}>
                          {activeGroup.showSpent && spentLoaded && person.plannedMinutes
                            ? formatSignedMinutes(person.deltaMinutes)
                            : "—"}
                        </td>
                        <td className={`sprint-num ${ratioClass(person.ratioPct)}`}>
                          {activeGroup.showSpent && spentLoaded && person.ratioPct != null
                            ? `${person.ratioPct}%`
                            : "—"}
                        </td>
                      </tr>
                      {open &&
                        person.issues.map((row) => (
                          <tr
                            key={`${rowId}-${row.issue.issueKey}`}
                            className={`sprint-issue-row${row.issue.lateAdded ? " sprint-issue-late" : ""}`}
                            title={
                              row.issue.lateAdded
                                ? "Влетела в спринт: создана после старта спринта"
                                : undefined
                            }
                          >
                            <td colSpan={2} className="sprint-issue-cell">
                              <a
                                href={row.issue.issueUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="tempo-issue-key"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {row.issue.issueKey}
                              </a>
                              <span className="tempo-row-sub" title={row.issue.issueTitle}>
                                {row.issue.issueTitle}
                              </span>
                              {row.issue.lateAdded && (
                                <span className="sprint-issue-late-badge">влетела</span>
                              )}
                              {row.issue.status && (
                                <span className="sprint-issue-status">{row.issue.status}</span>
                              )}
                            </td>
                            <td className="sprint-num">
                              {row.plannedMinutes ? formatTotalMinutes(row.plannedMinutes) : "—"}
                            </td>
                            <td className="sprint-num sprint-spent">
                              {activeGroup.showSpent && spentLoaded && row.spentMinutes
                                ? formatTotalMinutes(row.spentMinutes)
                                : "—"}
                            </td>
                            <td className={`sprint-num ${deltaClass(row.deltaMinutes)}`}>
                              {activeGroup.showSpent && spentLoaded && row.plannedMinutes
                                ? formatSignedMinutes(row.deltaMinutes)
                                : "—"}
                            </td>
                            <td className={`sprint-num ${ratioClass(row.ratioPct)}`}>
                              {activeGroup.showSpent && spentLoaded && row.ratioPct != null
                                ? `${row.ratioPct}%`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Итого</td>
              <td className="sprint-num">{totals.issues}</td>
              <td className="sprint-num sprint-hours">
                {totals.planned ? formatTotalMinutes(totals.planned) : "—"}
              </td>
              <td className="sprint-num sprint-spent">
                {activeGroup.showSpent && spentLoaded && totals.spent
                  ? formatTotalMinutes(totals.spent)
                  : "—"}
              </td>
              <td className={`sprint-num ${deltaClass(totals.delta)}`}>
                {activeGroup.showSpent && spentLoaded && totals.planned
                  ? formatSignedMinutes(totals.delta)
                  : "—"}
              </td>
              <td className={`sprint-num ${ratioClass(totals.ratio)}`}>
                {activeGroup.showSpent && spentLoaded && totals.ratio != null ? `${totals.ratio}%` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      <p className="sprint-hint">
        План — первоначальная оценка. Факт / план = списано ÷ план × 100%. Жёлтым — задачи,
        созданные после старта спринта (влетели).
      </p>
    </div>
  );
}
