import { useEffect, useState } from 'react';

import { api, type RecoveryPoint } from '../api';
import { useStore } from '../state/store';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function HistoryPanel(): JSX.Element {
  const session = useStore((state) => state.session);
  const loadSession = useStore((state) => state.loadSession);
  const [points, setPoints] = useState<RecoveryPoint[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  const loadHistory = async () => {
    if (!session) return;
    try {
      const result = await api.history(session.id);
      setPoints([...result.history].sort((left, right) => right.revision - left.revision || right.createdAt - left.createdAt));
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    setSources({});
    void loadHistory();
  }, [session?.id, session?.revision]);

  const showSource = async (point: RecoveryPoint) => {
    if (sources[point.id] !== undefined || !session) return;
    try {
      const result = await api.historyPoint(session.id, point.id);
      setSources((current) => ({ ...current, [point.id]: result.source }));
    } catch (error) {
      setSources((current) => ({
        ...current,
        [point.id]: `Could not read this recovery point: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  };

  const restore = async (point: RecoveryPoint) => {
    if (!session) return;
    setStatus(`Restoring revision ${point.revision}…`);
    try {
      await api.restoreHistory(session.id, point.id);
      await loadSession(session.id);
      setStatus(`Restored revision ${point.revision} as a new durable revision.`);
      await loadHistory();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="history" aria-labelledby="history-heading">
      <header className="history-header">
        <div>
          <h2 id="history-heading">History</h2>
          <p>Immutable recovery points for this Diagram. Restore creates a new revision; it never rewinds a Conversation.</p>
        </div>
        <button type="button" onClick={() => void loadHistory()}>
          Refresh
        </button>
      </header>
      {session?.historyDegraded && <p className="history-warning">Saved — history unavailable. New recovery points are currently failing.</p>}
      {status && <p className="history-status" role="status">{status}</p>}
      {points.length === 0 ? (
        <p className="muted">No recovery points are available yet.</p>
      ) : (
        <ol className="history-list">
          {points.map((point) => (
            <li key={point.id} className={`history-point${point.revision === session?.revision ? ' history-current' : ''}`}>
              <div className="history-point-heading">
                <strong>Revision {point.revision}</strong>
                {point.revision === session?.revision && <span>Current</span>}
              </div>
              <div className="history-point-meta">
                <span>{point.origin}</span>
                <time dateTime={new Date(point.createdAt).toISOString()}>{formatTime(point.createdAt)}</time>
                {point.outcome && <span>{point.outcome}</span>}
              </div>
              <details onToggle={(event) => event.currentTarget.open && void showSource(point)}>
                <summary>Inspect source</summary>
                <pre>{sources[point.id] ?? 'Loading…'}</pre>
              </details>
              <button type="button" onClick={() => void restore(point)} disabled={point.revision === session?.revision || Boolean(session?.archived)}>
                Restore as new revision
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
