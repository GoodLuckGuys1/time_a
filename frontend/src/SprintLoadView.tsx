import { Fragment, useEffect, useMemo, useState } from "react";

import {
  fetchSprintLoad,
  type SprintLoadAssignee,
  type SprintLoadGroup,
  type SprintLoadReport,
  type SprintLoadTeam,
} from "./api";
import { LoadingOverlay, LoadingPanel } from "./LoadingSpinner";
import { SprintAssigneeRefreshBar } from "./SprintAssigneeRefreshBar";
import {
  ALL_TEAMS_ID,
  filterGroupByTeam,
  formatTotalMinutes,
  listSprintTeams,
  NO_TEAM_LABEL,
} from "./tempoData";

interface SprintLoadViewProps {
  boardId?: number;
}

function AssigneeTable({
  rowPrefix,
  assignees,
  totals,
  expanded,
  onToggle,
  showSpent,
}: {
  rowPrefix: string;
  assignees: SprintLoadAssignee[];
  totals: {
    issueCount: number;
    totalOriginalMinutes: number;
    totalOriginalFormatted: string;
    totalMinutes: number;
    totalFormatted: string;
    totalSpentMinutes: number;
    totalSpentFormatted: string;
  };
  expanded: string | null;
  onToggle: (key: string | null) => void;
  showSpent: boolean;
}) {
  if (assignees.length === 0) {
    return <p className="sprint-empty">Нет задач.</p>;
  }

  return (
    <table className="sprint-table">
      <thead>
        <tr>
          <th>Исполнитель</th>
          <th className="sprint-num">Задач</th>
          <th className="sprint-num">Первоначальная оценка</th>
          <th className="sprint-num">Остаток</th>
          {showSpent && <th className="sprint-num">Списано в спринте</th>}
        </tr>
      </thead>
      <tbody>
        {assignees.map((row) => {
          const rowKey = `${rowPrefix}:${row.id}`;
          const open = expanded === rowKey;
          return (
            <Fragment key={rowKey}>
              <tr
                className={`sprint-row${open ? " sprint-row-open" : ""}`}
                onClick={() => onToggle(open ? null : rowKey)}
              >
                <td>
                  <button type="button" className="sprint-toggle" aria-expanded={open}>
                    {open ? "▾" : "▸"}
                  </button>
                  <span className="tempo-user-name">{row.name}</span>
                </td>
                <td className="sprint-num">{row.issueCount}</td>
                <td className="sprint-num sprint-original">
                  {row.totalOriginalMinutes ? formatTotalMinutes(row.totalOriginalMinutes) : "—"}
                </td>
                <td className="sprint-num sprint-hours">
                  {row.totalMinutes ? formatTotalMinutes(row.totalMinutes) : "—"}
                </td>
                {showSpent && (
                  <td className="sprint-num sprint-spent">
                    {row.totalSpentMinutes ? formatTotalMinutes(row.totalSpentMinutes) : "—"}
                  </td>
                )}
              </tr>
              {open &&
                row.issues.map((issue) => (
                  <tr
                    key={`${rowKey}-${issue.issueKey}`}
                    className={`sprint-issue-row${issue.lateAdded ? " sprint-issue-late" : ""}`}
                    title={
                      issue.lateAdded
                        ? "Влетела в спринт: создана после старта спринта"
                        : undefined
                    }
                  >
                    <td colSpan={2} className="sprint-issue-cell">
                      <a
                        href={issue.issueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="tempo-issue-key"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {issue.issueKey}
                      </a>
                      <span className="tempo-row-sub" title={issue.issueTitle}>
                        {issue.issueTitle}
                      </span>
                      {issue.lateAdded && <span className="sprint-issue-late-badge">влетела</span>}
                      {issue.status && <span className="sprint-issue-status">{issue.status}</span>}
                    </td>
                    <td className="sprint-num sprint-original">
                      {issue.originalMinutes ? formatTotalMinutes(issue.originalMinutes) : "—"}
                    </td>
                    <td className="sprint-num">
                      {issue.minutes ? formatTotalMinutes(issue.minutes) : "—"}
                    </td>
                    {showSpent && (
                      <td className="sprint-num sprint-spent">
                        {issue.spentMinutes ? formatTotalMinutes(issue.spentMinutes) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
            </Fragment>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td>Итого</td>
          <td className="sprint-num">{totals.issueCount}</td>
          <td className="sprint-num sprint-original">
            {totals.totalOriginalMinutes ? totals.totalOriginalFormatted : "—"}
          </td>
          <td className="sprint-num sprint-hours">
            {totals.totalMinutes ? totals.totalFormatted : "—"}
          </td>
          {showSpent && (
            <td className="sprint-num sprint-spent">
              {totals.totalSpentMinutes ? totals.totalSpentFormatted : "—"}
            </td>
          )}
        </tr>
      </tfoot>
    </table>
  );
}

function teamSections(group: SprintLoadGroup): SprintLoadTeam[] {
  if (group.teams?.length) return group.teams;
  if (!group.assignees.length) return [];
  return [
    {
      id: NO_TEAM_LABEL,
      name: NO_TEAM_LABEL,
      assignees: group.assignees,
      issueCount: group.issueCount,
      totalOriginalMinutes: group.totalOriginalMinutes,
      totalOriginalFormatted: group.totalOriginalFormatted,
      totalMinutes: group.totalMinutes,
      totalFormatted: group.totalFormatted,
      totalSpentMinutes: group.totalSpentMinutes,
      totalSpentFormatted: group.totalSpentFormatted,
    },
  ];
}

export function SprintLoadView({ boardId }: SprintLoadViewProps) {
  const [skeleton, setSkeleton] = useState<SprintLoadReport | null>(null);
  const [spentCache, setSpentCache] = useState<Record<string, SprintLoadReport>>({});
  const [loading, setLoading] = useState(true);
  const [assigneeRefreshing, setAssigneeRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedAssignee, setSelectedAssignee] = useState("");
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
        const first = report.groups?.[0]?.assignees?.[0]?.id ?? "";
        setSelectedAssignee((prev) => prev || first);
      })
      .catch((e) => {
        if (cancelled) return;
        setSkeleton(null);
        setError(e instanceof Error ? e.message : "Не удалось загрузить спринт");
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
    // spentCache intentionally omitted: only auto-load when missing for this assignee
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, skeleton, selectedAssignee]);

  const data = useMemo(() => {
    if (!skeleton) return null;
    return spentCache[selectedAssignee] ?? skeleton;
  }, [skeleton, spentCache, selectedAssignee]);

  const spentLoaded = Boolean(selectedAssignee && spentCache[selectedAssignee]);
  const teamOptions = useMemo(() => listSprintTeams(skeleton ?? { teams: [] }), [skeleton]);

  const loadEveryone = async () => {
    setEveryoneLoading(true);
    setError(null);
    try {
      const report = await fetchSprintLoad(boardId, "__all__");
      setSkeleton(report);
      setSpentCache({});
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

  if (loading && !skeleton) {
    return <LoadingPanel message="Загрузка ваших задач…" />;
  }

  if (error && !skeleton) {
    return <p className="sprint-empty sprint-error">{error}</p>;
  }

  if (!data || !skeleton) {
    return null;
  }

  const groups = (data.groups?.length ? data.groups : []).map((g) =>
    filterGroupByTeam(g, selectedTeam),
  );

  if ((data.groups?.length ?? 0) === 0) {
    const scanned = data.stats?.issuesOnBoard;
    const withSprint = data.stats?.issuesWithSprint;
    return (
      <p className="sprint-empty">
        {data.message ??
          "Не найдено задач со спринтом во вкладке Agile. Укажите спринт в карточке задачи на доске."}
        {scanned != null && (
          <>
            <br />
            <span className="sprint-hint">
              На доске: {scanned} задач
              {withSprint != null ? `, со спринтом: ${withSprint}` : ""}.
            </span>
          </>
        )}
      </p>
    );
  }

  return (
    <div className="sprint-load loading-host">
      {(loading || assigneeRefreshing || everyoneLoading) && (
        <LoadingOverlay
          message={
            assigneeRefreshing
              ? "Загрузка списаний…"
              : everyoneLoading
                ? "Загрузка всех исполнителей…"
                : "Обновление спринтов…"
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
          teamOptions.length > 0 ? (
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
          ) : null
        }
      />
      {!spentLoaded && (
        <p className="inline-hint">Подтягиваем списания за даты спринта…</p>
      )}
      <div className="sprint-head">
        <div>
          <span className="sprint-name">По спринтам (Agile)</span>
          {data.activeLabel && (
            <span className="sprint-period">актуальный: {data.activeLabel}</span>
          )}
        </div>
        <div className="sprint-meta">
          <span>{data.issueCount} задач</span>
          <span>{groups.length} спринтов</span>
          <span>
            перв. оценка: {data.totalOriginalFormatted || "—"}
            {data.totalFormatted ? ` · оценка: ${data.totalFormatted}` : ""}
            {data.showSpentColumn && data.totalSpentFormatted
              ? ` · списано в спринте: ${data.totalSpentFormatted}`
              : ""}
          </span>
          {data.issuesWithoutEstimate > 0 && (
            <span className="sprint-warn">без оценки: {data.issuesWithoutEstimate}</span>
          )}
        </div>
      </div>

      {groups.map((group) => {
        const sections = teamSections(group);
        return (
          <section key={group.sprintId ?? group.label} className="sprint-group">
            <header className="sprint-group-head">
              <h3 className="sprint-group-title">
                {group.url ? (
                  <a href={group.url} target="_blank" rel="noreferrer">
                    {group.label}
                  </a>
                ) : (
                  group.label
                )}
              </h3>
              <span className="sprint-group-meta">
                {group.issueCount} задач · перв. {group.totalOriginalFormatted || "—"}
                {group.totalFormatted ? ` · оценка ${group.totalFormatted}` : ""}
                {group.showSpent && group.totalSpentFormatted
                  ? ` · списано ${group.totalSpentFormatted}`
                  : ""}
                {group.showSpent && group.sprintStartDate && group.sprintEndDate && (
                  <span className="sprint-hint">
                    {" "}
                    ({group.sprintStartDate} — {group.sprintEndDate})
                  </span>
                )}
                {group.label === data.activeLabel && (
                  <span className="sprint-group-badge">текущий</span>
                )}
              </span>
            </header>
            {sections.length === 0 ? (
              <p className="sprint-empty">Нет задач в выбранной команде.</p>
            ) : (
              sections.map((team) => (
                <div key={`${group.label}:${team.id}`} className="sprint-team">
                  <h4 className="sprint-team-title">
                    {team.name}
                    <span className="sprint-team-meta">
                      {team.issueCount} задач · перв. {team.totalOriginalFormatted || "—"}
                      {team.totalFormatted ? ` · оценка ${team.totalFormatted}` : ""}
                      {group.showSpent && team.totalSpentFormatted
                        ? ` · списано ${team.totalSpentFormatted}`
                        : ""}
                    </span>
                  </h4>
                  <AssigneeTable
                    rowPrefix={`${group.label}:${team.id}`}
                    assignees={team.assignees}
                    totals={team}
                    expanded={expanded}
                    onToggle={setExpanded}
                    showSpent={group.showSpent ?? false}
                  />
                </div>
              ))
            )}
          </section>
        );
      })}

      <p className="sprint-hint">
        Перв. оценка — первоначальная; остаток — поле «Оценка» в Tracker. Команды — компонент
        «Команда-N». Жёлтым — задачи, созданные после старта спринта (влетели).
      </p>
    </div>
  );
}
