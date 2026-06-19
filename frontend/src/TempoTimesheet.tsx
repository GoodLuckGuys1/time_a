import { useEffect, useMemo, useState } from "react";
import { fetchSprintLoad, type TimeReport } from "./api";
import { WorklogEditor } from "./WorklogEditor";
import { AssigneeWorklogView } from "./AssigneeWorklogView";
import { SprintLoadView } from "./SprintLoadView";
import {
  ALL_ASSIGNEES_ID,
  buildTimesheet,
  canEditIssueAssigneeFilter,
  cellKey,
  formatCellMinutes,
  formatColumnHeader,
  formatTotalMinutes,
  isWeekend,
  listIssueAssignees,
  type GroupMode,
  type TimesheetCell,
} from "./tempoData";

interface TempoTimesheetProps {
  report: TimeReport;
  canEdit: boolean;
  writeAccessMessage?: string;
  onRefresh: () => void;
}

type TimesheetTab = "timesheet" | "sprint" | "assignee";

export function TempoTimesheet({ report, canEdit, writeAccessMessage, onRefresh }: TempoTimesheetProps) {
  const [activeTab, setActiveTab] = useState<TimesheetTab>("timesheet");
  const [groupBy, setGroupBy] = useState<GroupMode>("issue");
  const [selectedIssueAssignee, setSelectedIssueAssignee] = useState(ALL_ASSIGNEES_ID);
  const [activeCell, setActiveCell] = useState<TimesheetCell | null>(null);

  useEffect(() => {
    fetchSprintLoad(report.board.id).catch(() => {});
  }, [report.board.id]);

  const issueAssignees = useMemo(() => listIssueAssignees(report), [report]);

  useEffect(() => {
    const cu = report.currentUser;
    if (!cu) {
      setSelectedIssueAssignee(ALL_ASSIGNEES_ID);
      return;
    }
    const match = issueAssignees.find(
      (a) => a.id === cu.id || (cu.login && a.id === cu.login) || a.name === cu.name,
    );
    setSelectedIssueAssignee(match?.id ?? cu.id);
  }, [report.currentUser, issueAssignees]);

  const hasWriteAccess = canEdit;
  const issueFilterAllowsEdit = canEditIssueAssigneeFilter(
    selectedIssueAssignee,
    report.currentUser,
    issueAssignees,
  );
  const canEditIssue = hasWriteAccess && issueFilterAllowsEdit;
  const sheet = useMemo(
    () => buildTimesheet(report, groupBy, selectedIssueAssignee),
    [report, groupBy, selectedIssueAssignee],
  );

  const openCell = (rowId: string, date: string, minutes: number) => {
    const key = cellKey(rowId, date);
    const existing = sheet.cells.get(key);
    if (existing) {
      setActiveCell(existing);
      return;
    }
    if (groupBy === "issue" && canEditIssue) {
      setActiveCell({ rowId, date, issueKey: rowId, entries: [], totalMinutes: 0 });
      return;
    }
    if (minutes > 0) {
      setActiveCell(
        existing ?? { rowId, date, issueKey: groupBy === "issue" ? rowId : null, entries: [], totalMinutes: minutes },
      );
    }
  };

  const cellClickable = (rowId: string, date: string, minutes: number) => {
    const key = cellKey(rowId, date);
    if (sheet.cells.has(key)) return true;
    if (groupBy === "issue" && canEditIssue) return true;
    return minutes > 0;
  };

  return (
    <section className="tempo-wrap card">
      <div className="tempo-toolbar">
        <div className="tempo-toolbar-left">
          <h2 className="tempo-title">Timesheet</h2>
          <span className="tempo-period">{report.period.from} — {report.period.to}</span>
          {hasWriteAccess && <span className="tempo-edit-hint">Клик по ячейке — редактирование</span>}
        </div>
        <div className="tempo-toolbar-right">
          <div className="tempo-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "timesheet" && groupBy === "issue"}
              className={activeTab === "timesheet" && groupBy === "issue" ? "active" : ""}
              onClick={() => {
                setActiveTab("timesheet");
                setGroupBy("issue");
              }}
            >
              По задачам
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "timesheet" && groupBy === "user"}
              className={activeTab === "timesheet" && groupBy === "user" ? "active" : ""}
              onClick={() => {
                setActiveTab("timesheet");
                setGroupBy("user");
              }}
            >
              По исполнителям
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "sprint"}
              className={activeTab === "sprint" ? "active" : ""}
              onClick={() => setActiveTab("sprint")}
            >
              Спринт
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "assignee"}
              className={activeTab === "assignee" ? "active" : ""}
              onClick={() => setActiveTab("assignee")}
            >
              Списания
            </button>
          </div>
          {activeTab === "timesheet" && <span className="tempo-grand">{formatTotalMinutes(sheet.grandTotal)}</span>}
        </div>
      </div>

      {activeTab === "timesheet" && groupBy === "issue" && (
        <div className="assignee-worklog-toolbar">
          <label className="assignee-select-label">
            Исполнитель:
            <select
              className="assignee-select"
              value={selectedIssueAssignee}
              onChange={(e) => setSelectedIssueAssignee(e.target.value)}
            >
              <option value={ALL_ASSIGNEES_ID}>Все</option>
              {issueAssignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {report.currentUser?.id === a.id ? " (вы)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {activeTab === "sprint" ? (
        <SprintLoadView boardId={report.board.id} />
      ) : activeTab === "assignee" ? (
        <AssigneeWorklogView boardId={report.board.id} periodFrom={report.period.from} periodTo={report.period.to} />
      ) : sheet.rows.length === 0 ? (
        <p className="sprint-empty">За выбранный период списаний нет.</p>
      ) : (
        <div className="tempo-scroll">
          <table className="tempo-grid">
            <thead>
              <tr>
                <th className="tempo-sticky tempo-row-head">{groupBy === "issue" ? "Задача" : "Исполнитель"}</th>
                {sheet.dates.map((d) => {
                  const h = formatColumnHeader(d);
                  return (
                    <th key={d} className={`tempo-day-col${isWeekend(d) ? " tempo-weekend" : ""}`} title={d}>
                      <span className="tempo-day-top">{h.top}</span>
                      <span className="tempo-day-bottom">{h.bottom}</span>
                    </th>
                  );
                })}
                <th className="tempo-total-col">Итого</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => (
                <tr key={row.id} className="tempo-row">
                  <td className="tempo-sticky tempo-row-label">
                    {row.link ? (
                      <a href={row.link} target="_blank" rel="noreferrer" className="tempo-issue-key">
                        {row.primary}
                      </a>
                    ) : (
                      <span className="tempo-user-name">{row.primary}</span>
                    )}
                    {row.secondary && (
                      <span className="tempo-row-sub" title={row.secondary}>
                        {row.secondary}
                      </span>
                    )}
                  </td>
                  {sheet.dates.map((d) => {
                    const minutes = row.byDate[d] ?? 0;
                    const clickable = cellClickable(row.id, d, minutes);
                    return (
                      <td
                        key={d}
                        className={`tempo-cell${isWeekend(d) ? " tempo-weekend" : ""}${minutes ? " tempo-cell-filled" : ""}${clickable ? " tempo-cell-editable" : ""}`}
                        onClick={clickable ? () => openCell(row.id, d, minutes) : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openCell(row.id, d, minutes);
                                }
                              }
                            : undefined
                        }
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        title={clickable ? "Редактировать списания" : undefined}
                      >
                        {formatCellMinutes(minutes)}
                      </td>
                    );
                  })}
                  <td className="tempo-row-total">{formatTotalMinutes(row.totalMinutes)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="tempo-foot">
                <td className="tempo-sticky tempo-foot-label">Итого за день</td>
                {sheet.dates.map((d) => (
                  <td key={d} className={`tempo-foot-cell${isWeekend(d) ? " tempo-weekend" : ""}`}>
                    {formatCellMinutes(sheet.colTotals[d] ?? 0)}
                  </td>
                ))}
                <td className="tempo-foot-grand">{formatTotalMinutes(sheet.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {activeCell && activeTab === "timesheet" && (
        <WorklogEditor
          cell={activeCell}
          groupBy={groupBy}
          hasWriteAccess={hasWriteAccess}
          allowIssueEdit={issueFilterAllowsEdit}
          currentUser={report.currentUser}
          writeAccessMessage={writeAccessMessage}
          onClose={() => setActiveCell(null)}
          onChanged={onRefresh}
        />
      )}
    </section>
  );
}
