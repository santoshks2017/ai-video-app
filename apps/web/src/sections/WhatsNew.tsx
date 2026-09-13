import { useState } from 'react';
import { APP_VERSION, CHANGELOG } from '@ava/shared';
import { Panel } from '../components/ui.js';

/**
 * Release notes, straight from the list the repo's CHANGELOG.md is built from.
 *
 * Two dozen releases laid out in full is a page nobody reads, so they are folded
 * — one open at a time, the current one to begin with. Reading two releases at
 * once is not something anybody does; finding one is.
 */
export function WhatsNewSection() {
  const [open, setOpen] = useState<string>(CHANGELOG[0]?.version ?? '');

  return (
    <Panel title="What's new" step={`v${APP_VERSION}`}>
      <div className="section-desc">
        Every change that has shipped, newest first. Minor numbers move with each release; the major number
        only moves for an overhaul of how the app works.
      </div>
      <div className="releases">
        {CHANGELOG.map((r, i) => {
          const on = open === r.version;
          return (
            <div className={`release${i === 0 ? ' current' : ''}${on ? ' open' : ''}`} key={r.version}>
              <button
                type="button"
                className="release-head"
                aria-expanded={on}
                onClick={() => setOpen(on ? '' : r.version)}
              >
                <span className="release-caret" aria-hidden>
                  ▶
                </span>
                <b>
                  {r.version} — {r.title}
                </b>
                <span>
                  {new Date(r.date).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                  {i === 0 && <span className="chip accent">current</span>}
                  <em>
                    {r.changes.length} change{r.changes.length === 1 ? '' : 's'}
                  </em>
                </span>
              </button>
              {on && (
                <ul>
                  {r.changes.map((c, ci) => (
                    <li key={ci}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
