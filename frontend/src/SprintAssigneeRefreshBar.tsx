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
}: SprintAssigneeRefreshBarProps) {
  const assignees = listSprintAssignees(data);
  const everyoneLoaded = data.scope === "all";

  return (
    <div className="assignee-worklog-toolbar">
      {assignees.length > 0 && (
        <label className="assignee-select-label">
          Исполнитель
          <select
            className="assignee-select"
            value={selectedAssignee}
            onChange={(e) => onSelectAssignee(e.target.value)}
          >
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="btn-secondary assignee-refresh-btn"
        disabled={refreshing || !selectedAssignee}
        title="Загрузить списания в спринте только для выбранного исполнителя"
        onClick={onRefresh}
      >
        {refreshing ? "Загрузка…" : spentLoaded ? "Обновить списания" : "Загрузить списания"}
      </button>
      {!everyoneLoaded && onLoadEveryone && (
        <button
          type="button"
          className="btn-secondary assignee-refresh-btn"
          disabled={everyoneLoading || refreshing}
          title="Загрузить задачи всех исполнителей доски"
          onClick={onLoadEveryone}
        >
          {everyoneLoading ? "Загрузка всех…" : "Загрузить всех исполнителей"}
        </button>
      )}
    </div>
  );
}
