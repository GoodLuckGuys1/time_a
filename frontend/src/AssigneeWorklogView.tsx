import { Fragment, useEffect, useState } from "react";

import { fetchAssigneeWorklogs, type AssigneeWorklogReport } from "./api";
import { LoadingOverlay, LoadingPanel } from "./LoadingSpinner";

interface AssigneeWorklogViewProps {
  boardId: number;
  periodFrom: string;
  periodTo: string;
}

export function AssigneeWorklogView({ boardId, periodFrom, periodTo }: AssigneeWorklogViewProps) {
  const [data, setData] = useState<AssigneeWorklogReport | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const assigneeParam = selectedId || undefined;
    fetchAssigneeWorklogs(periodFrom, periodTo, boardId, assigneeParam)
      .then((report) => {
        if (cancelled) return;
        setData(report);
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Не удалось загрузить списания");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, periodFrom, periodTo, selectedId]);

  if (loading && !data) {
    return <LoadingPanel message="Загрузка списаний…" />;
  }

  if (error) {
    return <p className="sprint-empty sprint-error">{error}</p>;
  }

  if (!data) {
    return null;
  }

  const handleAssigneeChange = (id: string) => {
    setExpanded(null);
    setSelectedId(id);
  };

  return (
    <div className="assignee-worklog loading-host">
      {loading && <LoadingOverlay message="Загрузка списаний…" />}
      <div className="assignee-worklog-toolbar">
        <label className="assignee-select-label">
          Исполнитель
          <select
            className="assignee-select"
            value={selectedId || data.selectedAssigneeId || ""}
            onChange={(e) => handleAssigneeChange(e.target.value)}
            disabled={loading}
          >
            {data.assignees.length === 0 ? (
              <option value="">Нет списаний за период</option>
            ) : (
              data.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {data.currentUser?.id === a.id ? " (вы)" : ""} — {a.totalFormatted} ({a.worklogCount})
                </option>
              ))
            )}
          </select>
        </label>
        {data.selectedAssigneeName && (
          <span className="assignee-worklog-total">
            Итого: <strong>{data.totalFormatted}</strong>
            <span className="assignee-worklog-meta">
              {" "}
              · {data.worklogCount} записей · {data.tasks.length} задач
            </span>
          </span>
        )}
      </div>

      {data.assignees.length === 0 ? (
        <p className="sprint-empty">
          За период {data.period.from} — {data.period.to} нет списаний по задачам доски.
        </p>
      ) : data.tasks.length === 0 ? (
        <p className="sprint-empty">У выбранного исполнителя нет списаний за период.</p>
      ) : (
        <table className="sprint-table assignee-worklog-table">
          <thead>
            <tr>
              <th>Задача</th>
              <th className="sprint-num">Записей</th>
              <th className="sprint-num">Списано</th>
            </tr>
          </thead>
          <tbody>
            {data.tasks.map((task) => {
              const open = expanded === task.issueKey;
              return (
                <Fragment key={task.issueKey}>
                  <tr
                    className={`sprint-row${open ? " sprint-row-open" : ""}`}
                    onClick={() => setExpanded(open ? null : task.issueKey)}
                  >
                    <td>
                      <button type="button" className="sprint-toggle" aria-expanded={open}>
                        {open ? "▾" : "▸"}
                      </button>
                      <a
                        href={task.issueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="tempo-issue-key"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {task.issueKey}
                      </a>
                      <span className="tempo-row-sub" title={task.issueTitle}>
                        {task.issueTitle}
                      </span>
                    </td>
                    <td className="sprint-num">{task.entries.length}</td>
                    <td className="sprint-num sprint-spent">{task.totalFormatted}</td>
                  </tr>
                  {open &&
                    task.entries.map((entry) => (
                      <tr key={`${task.issueKey}-${entry.id}-${entry.date}`} className="sprint-issue-row">
                        <td colSpan={2} className="sprint-issue-cell">
                          <span className="assignee-entry-date">{entry.date}</span>
                          {entry.comment && (
                            <span className="tempo-row-sub" title={entry.comment}>
                              {entry.comment}
                            </span>
                          )}
                        </td>
                        <td className="sprint-num">{entry.formatted}</td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Итого</td>
              <td className="sprint-num">{data.worklogCount}</td>
              <td className="sprint-num sprint-spent">{data.totalFormatted}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <p className="sprint-hint">
        Списания по полю «Кто списал» (автор worklog) за выбранный период в шапке страницы.
      </p>
    </div>
  );
}
