import { useApp, type Tab } from '../state/appStore.js';
import { SECTION_META } from './Shell.js';

/**
 * The workspace tab strip.
 *
 * Every open tab stays mounted — that is the whole point of it. A designer can
 * start a generation on one project, switch to another, and come back to a
 * finished video rather than a lost run, and library sections open beside the
 * work instead of replacing it.
 */
export function Tabs() {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const focusTab = useApp((s) => s.focusTab);
  const closeTab = useApp((s) => s.closeTab);
  const projects = useApp((s) => s.projects);
  const busyProjects = useApp((s) => s.busyProjects);

  const label = (t: Tab): string => {
    if (t.kind === 'section') return SECTION_META[t.section].label;
    return projects.find((p) => p.id === t.projectId)?.name?.trim() || 'Untitled project';
  };
  const icon = (t: Tab): string => (t.kind === 'section' ? SECTION_META[t.section].icon : '📄');

  return (
    <div className="tabstrip" role="tablist">
      {tabs.map((t) => {
        const on = t.id === activeTabId;
        const busy = t.kind === 'project' && Boolean(busyProjects[t.projectId ?? '']);
        return (
          <div key={t.id} className={`wtab${on ? ' on' : ''}${busy ? ' busy' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={on}
              className="wtab-main"
              onClick={() => focusTab(t.id)}
              title={busy ? `${label(t)} — generating` : label(t)}
            >
              <span className="wtab-icon" aria-hidden>
                {icon(t)}
              </span>
              <span className="wtab-label">{label(t)}</span>
              {busy && <span className="wtab-dot" aria-label="generating" />}
            </button>
            {/* The last tab has no close button — there is nothing to fall back to. */}
            {tabs.length > 1 && (
              <button
                type="button"
                className="wtab-x"
                aria-label={`Close ${label(t)}`}
                title={busy ? 'Generating — closing loses the run' : 'Close'}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
