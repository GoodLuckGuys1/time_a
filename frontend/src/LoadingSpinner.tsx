interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export function LoadingSpinner({ size = "md", label }: LoadingSpinnerProps) {
  return (
    <span className={`loading-spinner loading-spinner-${size}`} role="status" aria-label={label ?? "Загрузка"}>
      <span className="loading-spinner-ring" />
    </span>
  );
}

export function LoadingPanel({ message = "Загрузка…" }: { message?: string }) {
  return (
    <div className="loading-panel card" role="status" aria-live="polite">
      <LoadingSpinner size="lg" label={message} />
      <p className="loading-panel-text">{message}</p>
    </div>
  );
}

export function LoadingOverlay({ message = "Загрузка…" }: { message?: string }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <LoadingSpinner size="md" label={message} />
      <p className="loading-panel-text">{message}</p>
    </div>
  );
}
