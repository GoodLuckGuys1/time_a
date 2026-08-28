import type { ReactNode } from "react";
import { listSprintAssignees } from "./tempoData";
import type { SprintLoadReport } from "./api";

interface SprintAssigneeRefreshBarProps {
  data: SprintLoadReport;
  selectedAssignee: string;
  onSelectAssignee: (id: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  spentLoaded?: boolean;
  onLoadEveryone?: () => void;
  everyoneLoading?: boolean;
  extra?: ReactNode;
}

export function SprintAssigneeRefreshBar({
  data,
  selectedAssignee,
  onSelectAssignee,
  onRefresh,
  refreshing,
  spentLoaded = false,
  onLoadEveryone,
  everyoneLoading = false,
  extra,
}: SprintAssigneeRefreshBarProps) {
  const assignees = listSprintAssignees(data);
  const everyoneLoaded = data.scope === "all";

  return (
    <div className="filter-bar">
      {assignees.length > 0 && (
        <label className="field">
          <span>Исполнитель</span>
          <select value={selectedAssignee} onChange={(e) => onSelectAssignee(e.target.value)}>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {extra}
      <div className="filter-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={refreshing || !selectedAssignee}
          title="Списания только выбранного исполнителя"
          onClick={onRefresh}
        >
          {refreshing ? "Загрузка…" : spentLoaded ? "Обновить факт" : "Загрузить факт"}
        </button>
        {!everyoneLoaded && onLoadEveryone && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={everyoneLoading || refreshing}
            onClick={onLoadEveryone}
          >
            {everyoneLoading ? "Загрузка…" : "Показать всех"}
          </button>
        )}
      </div>
      <span className={`scope-chip${everyoneLoaded ? " is-all" : ""}`}>
        {everyoneLoaded ? "Все исполнители" : "Только вы"}
      </span>
    </div>
  );
}
