import { APP_VERSION, CHANGELOG } from '@ava/shared';
import { Panel } from '../components/ui.js';

/** Release notes, straight from the list the repo's CHANGELOG.md is built from. */
export function WhatsNewSection() {
  return (
    <Panel title="What's new" step={`v${APP_VERSION}`}>
      <div className="section-desc">
        Every change that has shipped, newest first. Minor numbers move with each release; the major number
        only moves for an overhaul of how the app works.
      </div>
      <div className="releases">
        {CHANGELOG.map((r, i) => (
          <div className={`release${i === 0 ? ' current' : ''}`} key={r.version}>
            <div className="release-head">
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
              </span>
            </div>
            <ul>
              {r.changes.map((c, ci) => (
                <li key={ci}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
