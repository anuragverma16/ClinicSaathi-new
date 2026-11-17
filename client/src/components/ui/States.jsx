import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-paper-sunk ${className}`} />;
}

export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} className="h-5" />)}
        </div>
      ))}
    </div>
  );
}

/** Empty states are an invitation to act, not an apology. */
export function EmptyState({ title, body, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 rounded-full bg-pulse-soft p-3">
        <Icon className="h-6 w-6 text-pulse-deep" strokeWidth={1.5} />
      </div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Errors say what happened and what to do. They don't apologise. */
export function ErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 rounded-full bg-alert-soft p-3">
        <AlertCircle className="h-6 w-6 text-alert" strokeWidth={1.5} />
      </div>
      <h3 className="font-display text-lg font-semibold">{error?.message || 'That request failed'}</h3>
      {error?.code && <p className="mt-1 font-mono text-xs text-ink-muted">{error.code}</p>}
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost mt-5">
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      )}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
