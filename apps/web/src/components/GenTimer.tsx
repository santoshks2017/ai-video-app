import type { ReactElement } from 'react';

/** 4m 07s, or 42s under a minute. */
export const fmtDur = (secs: number): string => {
  const t = Math.max(0, Math.round(secs));
  return t >= 60 ? `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s` : `${t}s`;
};

export type Eta = { seconds: number; basis: 'history' | 'default'; samples: number };

/**
 * Elapsed time, and an honest estimate of what is left.
 *
 * No provider reports progress, so the bar is time against the estimate, not
 * work done. It stops short of full rather than pretending to finish, and says
 * so when a run is taking longer than this model usually takes.
 */
export function GenTimer({ startedAt, now, eta, segments }: {
  startedAt: number;
  now: number;
  eta: Eta | null;
  segments: number;
}): ReactElement {
  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));
  const left = eta ? eta.seconds - elapsed : null;
  const pct = eta && eta.seconds > 0 ? Math.min(97, Math.round((elapsed / eta.seconds) * 100)) : null;
  return (
    <div className="gen-timer" role="timer">
      <div className="gen-timer-row">
        <b>{fmtDur(elapsed)}</b>
        <span>
          {left == null
            ? 'elapsed'
            : left > 0
              ? `elapsed · about ${fmtDur(left)} left`
              : 'elapsed · taking longer than this model usually does — still working'}
        </span>
      </div>
      {pct != null && (
        <div className="gen-timer-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="hint">
        {eta?.basis === 'history'
          ? `Estimated from ${eta.samples} recent run${eta.samples === 1 ? '' : 's'} on this model.`
          : 'Rough estimate — it sharpens after a few runs on this model.'}{' '}
        {segments > 1 ? `${segments} segments. ` : ''}You can keep working in other tabs.
      </div>
    </div>
  );
}
