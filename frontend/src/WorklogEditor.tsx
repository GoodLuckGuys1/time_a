import { useEffect, useState } from "react";
import { createWorklog, deleteWorklog, fetchCheckWriteAccess, updateWorklog } from "./api";
import { isOwnWorklogEntry, type GroupMode } from "./tempoData";
import {
  formatCellMinutes,
  minutesFromParts,
  splitMinutes,
  type TimesheetCell,
} from "./tempoData";

interface EntryDraft {
  worklogId: string | number;
  issueKey: string;
  issueTitle: string;
  issueUrl: string;
  author: string;
  authorKey?: string;
  authorLogin?: string;
  hours: number;
  minutes: number;
  comment: string;
}

interface WorklogEditorProps {
  cell: TimesheetCell;
  groupBy: GroupMode;
  hasWriteAccess: boolean;
  allowIssueEdit?: boolean;
  currentUser?: { id: string; login?: string; name: string } | null;
  writeAccessMessage?: string;
  onClose: () => void;
  onChanged: () => void;
}

export function WorklogEditor({
  cell,
  groupBy,
  hasWriteAccess,
  allowIssueEdit = true,
  currentUser,
  writeAccessMessage,
  onClose,
  onChanged,
}: WorklogEditorProps) {
  const [drafts, setDrafts] = useState<EntryDraft[]>([]);
  const [newHours, setNewHours] = useState(0);
  const [newMinutes, setNewMinutes] = useState(0);
  const [newComment, setNewComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeOk, setWriteOk] = useState(hasWriteAccess);
  const [writeChecked, setWriteChecked] = useState(hasWriteAccess === false);

  useEffect(() => {
    setWriteOk(hasWriteAccess);
    if (hasWriteAccess) setWriteChecked(true);
  }, [hasWriteAccess]);

  useEffect(() => {
    let cancelled = false;
    fetchCheckWriteAccess()
      .then((r) => {
        if (cancelled) return;
        setWriteOk(r.ok);
        setWriteChecked(true);
      })
      .catch(() => {
        if (!cancelled) setWriteChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const issueKeyForCreate = cell.issueKey ?? cell.entries[0]?.issueKey ?? null;
  const canCreate =
    writeOk &&
    allowIssueEdit &&
    groupBy === "issue" &&
    !!issueKeyForCreate;

  const canEditDraft = (draft: EntryDraft) => {
    if (!writeOk) return false;
    if (groupBy === "issue") {
      return allowIssueEdit && isOwnWorklogEntry(draft, currentUser);
    }
    return true;
  };

  useEffect(() => {
    setDrafts(
      cell.entries.map((e) => {
        const { hours, minutes } = splitMinutes(e.minutes);
        return {
          worklogId: e.worklogId,
          issueKey: e.issueKey,
          issueTitle: e.issueTitle,
          issueUrl: e.issueUrl,
          author: e.author,
          authorKey: e.authorKey,
          authorLogin: e.authorLogin,
          hours,
          minutes,
          comment: e.comment,
        };
      }),
    );
    setNewHours(0);
    setNewMinutes(0);
    setNewComment("");
    setError(null);
  }, [cell]);

  const title = `${cell.rowId} · ${cell.date}`;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  const saveEntry = (draft: EntryDraft) =>
    run(async () => {
      const total = minutesFromParts(draft.hours, draft.minutes);
      if (total <= 0) throw new Error("Укажите длительность больше 0");
      await updateWorklog(draft.issueKey, draft.worklogId, {
        minutes: total,
        comment: draft.comment || undefined,
      });
    });

  const removeEntry = (draft: EntryDraft) => {
    if (!confirm("Удалить эту запись о времени?")) return;
    run(() => deleteWorklog(draft.issueKey, draft.worklogId));
  };

  const addEntry = () =>
    run(async () => {
      if (!issueKeyForCreate) return;
      const total = minutesFromParts(newHours, newMinutes);
      if (total <= 0) throw new Error("Укажите длительность больше 0");
      await createWorklog(issueKeyForCreate, {
        day: cell.date,
        minutes: total,
        comment: newComment || undefined,
      });
    });

  const assigneeFilterBlocksEdit = groupBy === "issue" && writeOk && !allowIssueEdit;

  return (
    <div className="wl-backdrop" onClick={onClose} role="presentation">
      <div
        className="wl-modal card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="wl-title"
      >
        <header className="wl-header">
          <div>
            <h3 id="wl-title">Списания</h3>
            <p className="wl-sub">{title}</p>
          </div>
          <button type="button" className="wl-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        {writeChecked && !writeOk && (
          <p className="wl-hint banner-warn">
            {writeAccessMessage ??
              "В токене нет права tracker:write. Проверьте TRACKER_OAUTH_SCOPE в .env и перевыпустите токен через /oauth/start."}
          </p>
        )}

        {assigneeFilterBlocksEdit && (
          <p className="wl-hint banner-warn">
            Сейчас выбран другой исполнитель. Чтобы редактировать свои списания, выберите себя или
            «Все» в фильтре над таблицей.
          </p>
        )}

        {cell.entries.length === 0 && !canCreate && (
          <p className="wl-empty">Нет записей за этот день.</p>
        )}

        {drafts.map((draft, idx) => {
          const editable = canEditDraft(draft);
          return (
            <div key={`${draft.issueKey}-${draft.worklogId}`} className="wl-entry">
              {groupBy === "user" && (
                <a href={draft.issueUrl} target="_blank" rel="noreferrer" className="wl-issue">
                  {draft.issueKey}
                </a>
              )}
              {draft.author && <span className="wl-author">{draft.author}</span>}
              {!editable && writeOk && groupBy === "issue" && (
                <p className="wl-hint">Только просмотр — это списание другого исполнителя.</p>
              )}
              <div className="wl-duration">
                <label>
                  Часы
                  <input
                    type="number"
                    min={0}
                    disabled={!editable || busy}
                    value={draft.hours}
                    onChange={(e) => {
                      const hours = Number(e.target.value);
                      setDrafts((list) =>
                        list.map((d, i) => (i === idx ? { ...d, hours } : d)),
                      );
                    }}
                  />
                </label>
                <label>
                  Мин
                  <input
                    type="number"
                    min={0}
                    max={59}
                    disabled={!editable || busy}
                    value={draft.minutes}
                    onChange={(e) => {
                      const minutes = Number(e.target.value);
                      setDrafts((list) =>
                        list.map((d, i) => (i === idx ? { ...d, minutes } : d)),
                      );
                    }}
                  />
                </label>
                <span className="wl-preview">
                  {formatCellMinutes(minutesFromParts(draft.hours, draft.minutes))}
                </span>
              </div>
              <label className="wl-comment-label">
                Комментарий
                <input
                  type="text"
                  disabled={!editable || busy}
                  value={draft.comment}
                  onChange={(e) => {
                    const comment = e.target.value;
                    setDrafts((list) =>
                      list.map((d, i) => (i === idx ? { ...d, comment } : d)),
                    );
                  }}
                />
              </label>
              {editable && (
                <div className="wl-actions">
                  <button type="button" disabled={busy} onClick={() => saveEntry(draft)}>
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="wl-danger"
                    disabled={busy}
                    onClick={() => removeEntry(draft)}
                  >
                    Удалить
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {canCreate && (
          <div className="wl-entry wl-new">
            <h4>Добавить списание</h4>
            <div className="wl-duration">
              <label>
                Часы
                <input
                  type="number"
                  min={0}
                  disabled={busy}
                  value={newHours}
                  onChange={(e) => setNewHours(Number(e.target.value))}
                />
              </label>
              <label>
                Мин
                <input
                  type="number"
                  min={0}
                  max={59}
                  disabled={busy}
                  value={newMinutes}
                  onChange={(e) => setNewMinutes(Number(e.target.value))}
                />
              </label>
            </div>
            <label className="wl-comment-label">
              Комментарий
              <input
                type="text"
                disabled={busy}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
              />
            </label>
            <button type="button" disabled={busy} onClick={addEntry}>
              Добавить
            </button>
          </div>
        )}

        {error && <p className="wl-error">{error}</p>}
      </div>
    </div>
  );
}
