import { Fragment, useEffect, useState } from "react";

import { fetchSprintLoad, type SprintLoadGroup, type SprintLoadReport } from "./api";
import { LoadingOverlay, LoadingPanel } from "./LoadingSpinner";
import { formatTotalMinutes } from "./tempoData";

interface SprintLoadViewProps {
  boardId?: number;
}

function AssigneeTable({
  group,
  expanded,
  onToggle,
  showSpent,
}: {
  group: SprintLoadGroup;
  expanded: string | null;
  onToggle: (key: string | null) => void;
  showSpent: boolean;
}) {
  if (group.assignees.length === 0) {
    return <p className="sprint-empty">Нет задач.</p>;
  }

  return (
    <table className="sprint-table">
      <thead>
        <tr>
          <th>Исполнитель</th>
          <th className="sprint-num">Задач</th>
          <th className="sprint-num">Первоначальная оценка</th>
          <th className="sprint-num">Оценка</th>
          {showSpent && <th className="sprint-num">Списано в спринте</th>}
        </tr>
      </thead>
      <tbody>
        {group.assignees.map((row) => {
          const rowKey = `${group.label}:${row.id}`;
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
                  <tr key={`${rowKey}-${issue.issueKey}`} className="sprint-issue-row">
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
                      {issue.status && <span className="sprint-issue-status">{issue.status}</span>}
                    </td>
                    <td className="sprint-num sprint-original">
                      {issue.originalMinutes ? issue.originalFormatted : "—"}
                    </td>
                    <td className="sprint-num">{issue.formatted}</td>
                    {showSpent && (
                      <td className="sprint-num sprint-spent">
                        {issue.spentMinutes ? issue.spentFormatted : "—"}
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
          <td className="sprint-num">{group.issueCount}</td>
          <td className="sprint-num sprint-original">
            {group.totalOriginalMinutes ? group.totalOriginalFormatted : "—"}
          </td>
          <td className="sprint-num sprint-hours">
            {group.totalMinutes ? group.totalFormatted : "—"}
          </td>
          {showSpent && (
            <td className="sprint-num sprint-spent">
              {group.totalSpentMinutes ? group.totalSpentFormatted : "—"}
            </td>
          )}
        </tr>
      </tfoot>
    </table>
  );
}

export function SprintLoadView({ boardId }: SprintLoadViewProps) {
  const [data, setData] = useState<SprintLoadReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSprintLoad(boardId)
      .then((report) => {
        if (!cancelled) setData(report);
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Не удалось загрузить спринт");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  if (loading && !data) {
    return <LoadingPanel message="Загрузка спринтов…" />;
  }

  if (error) {
    return <p className="sprint-empty sprint-error">{error}</p>;
  }

  if (!data) {
    return null;
  }

  const groups = data.groups?.length ? data.groups : [];

  if (groups.length === 0) {
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
      {loading && <LoadingOverlay message="Обновление спринтов…" />}
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

      {groups.map((group) => (
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
          <AssigneeTable
            group={group}
            expanded={expanded}
            onToggle={setExpanded}
            showSpent={group.showSpent ?? false}
          />
        </section>
      ))}

      <p className="sprint-hint">
        Перв. оценка — «Первоначальная оценка»; оценка — текущая «Оценка».
        {data.showSpentColumn
          ? " Списано в спринте — сумма списаний по задаче за даты спринта."
          : " Списания за спринт недоступны (нет дат спринта в Tracker)."}
        {" "}
        Фильтр: <code>TRACKER_SPRINT_TAG_PREFIX</code> в .env.
      </p>
    </div>
  );
}
