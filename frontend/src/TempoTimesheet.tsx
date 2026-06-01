import { useMemo, useState } from "react";

import type { TimeReport } from "./api";

import { WorklogEditor } from "./WorklogEditor";

import {

  buildTimesheet,

  cellKey,

  formatCellMinutes,

  formatColumnHeader,

  formatTotalMinutes,

  isWeekend,

  type GroupMode,

  type TimesheetCell,

} from "./tempoData";



interface TempoTimesheetProps {

  report: TimeReport;

  canEdit: boolean;

  onRefresh: () => void;

}



export function TempoTimesheet({ report, canEdit, onRefresh }: TempoTimesheetProps) {

  const [groupBy, setGroupBy] = useState<GroupMode>("issue");

  const [activeCell, setActiveCell] = useState<TimesheetCell | null>(null);

  const sheet = useMemo(() => buildTimesheet(report, groupBy), [report, groupBy]);



  if (sheet.rows.length === 0) {

    return null;

  }



  const openCell = (rowId: string, date: string, minutes: number) => {

    const key = cellKey(rowId, date);

    const existing = sheet.cells.get(key);

    if (existing) {

      setActiveCell(existing);

      return;

    }

    if (groupBy === "issue" && canEdit) {

      setActiveCell({

        rowId,

        date,

        issueKey: rowId,

        entries: [],

        totalMinutes: 0,

      });

      return;

    }

    if (minutes > 0) {

      setActiveCell(

        existing ?? {

          rowId,

          date,

          issueKey: groupBy === "issue" ? rowId : null,

          entries: [],

          totalMinutes: minutes,

        },

      );

    }

  };



  const cellClickable = (rowId: string, date: string, minutes: number) => {

    const key = cellKey(rowId, date);

    if (sheet.cells.has(key)) return true;

    if (groupBy === "issue" && canEdit) return true;

    return minutes > 0;

  };



  return (

    <section className="tempo-wrap card">

      <div className="tempo-toolbar">

        <div className="tempo-toolbar-left">

          <h2 className="tempo-title">Timesheet</h2>

          <span className="tempo-period">

            {report.period.from} — {report.period.to}

          </span>

          {canEdit && <span className="tempo-edit-hint">Клик по ячейке — редактирование</span>}

        </div>

        <div className="tempo-toolbar-right">

          <div className="tempo-tabs" role="tablist">

            <button

              type="button"

              role="tab"

              className={groupBy === "issue" ? "active" : ""}

              onClick={() => setGroupBy("issue")}

            >

              По задачам

            </button>

            <button

              type="button"

              role="tab"

              className={groupBy === "user" ? "active" : ""}

              onClick={() => setGroupBy("user")}

            >

              По исполнителям

            </button>

          </div>

          <span className="tempo-grand">{report.totalFormatted}</span>

        </div>

      </div>



      <div className="tempo-scroll">

        <table className="tempo-grid">

          <thead>

            <tr>

              <th className="tempo-sticky tempo-row-head">

                {groupBy === "issue" ? "Задача" : "Исполнитель"}

              </th>

              {sheet.dates.map((d) => {

                const h = formatColumnHeader(d);

                return (

                  <th

                    key={d}

                    className={`tempo-day-col${isWeekend(d) ? " tempo-weekend" : ""}`}

                    title={d}

                  >

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

                <td

                  key={d}

                  className={`tempo-foot-cell${isWeekend(d) ? " tempo-weekend" : ""}`}

                >

                  {formatCellMinutes(sheet.colTotals[d] ?? 0)}

                </td>

              ))}

              <td className="tempo-foot-grand">{formatTotalMinutes(sheet.grandTotal)}</td>

            </tr>

          </tfoot>

        </table>

      </div>



      {activeCell && (

        <WorklogEditor

          cell={activeCell}

          groupBy={groupBy}

          canEdit={canEdit}

          onClose={() => setActiveCell(null)}

          onChanged={onRefresh}

        />

      )}

    </section>

  );

}


