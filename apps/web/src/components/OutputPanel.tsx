import { useState } from 'react';
import {
  joinPromptParts,
  formatInr,
  type PromptPart,
  type CostEstimate,
} from '@ava/shared';
import type { PreflightResult } from '@ava/shared';

export function OutputPanel({
  parts,
  preflight,
  cost,
  promptOnly,
}: {
  parts: PromptPart[];
  preflight: PreflightResult;
  cost: CostEstimate | null;
  promptOnly: boolean;
}) {
  const [toast, setToast] = useState('');
  const longest = parts.reduce((n, p) => Math.max(n, p.text.length), 0);
  // Accordion: at most one prompt part open at a time, all collapsed by default.
  const [openPart, setOpenPart] = useState<number | null>(null);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`${label} copied`);
      setTimeout(() => setToast(''), 1600);
    } catch {
      setToast('Copy failed — select manually');
    }
  };

  return (
    <div className="card">
      <div className="head">
        <div>
          <h2>{promptOnly ? 'Master prompt (copy for Lumina)' : 'Master prompt'}</h2>
          <div className="prompt-meta">
            {parts.length > 0 ? (
              <>
                {parts.length} part{parts.length > 1 ? 's' : ''} ·{' '}
                {/* Size is shown because a bloated prompt is invisible otherwise:
                    direction pasted here once grew to 54% of what the model read,
                    and the footage collapsed with nothing on screen to explain it. */}
                <span className={longest > 12000 ? 'bloat' : undefined}>
                  {(longest / 1000).toFixed(1)}k characters
                </span>
                {longest > 12000 && ' — the shot direction is competing with the rules'}
              </>
            ) : (
              'Pick categories and fill the brief'
            )}
          </div>
        </div>
        {toast && <span className="toast">{toast}</span>}
      </div>

      {preflight.checks.length > 0 && (
        <div className="checks">
          {preflight.checks.map((c, i) => (
            <div className={`check ${c.level}`} key={i}>
              <span className="icon">{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'}</span>
              <span>{c.text}</span>
            </div>
          ))}
        </div>
      )}

      {!promptOnly && cost && parts.length > 0 && (
        <div className={`cost${cost.needsConfirmation ? ' confirm' : ''}`}>
          <div>
            Estimated cost: <strong>{formatInr(cost.inr)}</strong> (${cost.usd.toFixed(2)} ·{' '}
            {cost.totalSeconds}s × ${cost.usdPerSecond}/s × ₹{cost.usdToInr}/$), {cost.clipCount} API call
            {cost.clipCount > 1 ? 's' : ''}.
          </div>
          {cost.highCallCountWarning && (
            <div style={{ marginTop: 4 }}>
              ⚠ {cost.clipCount} sequential calls — a long multi-part video. Consider a shorter cut.
            </div>
          )}
        </div>
      )}

      <div className="toolbar" style={{ margin: '0 16px 12px' }}>
        <button
          className="btn"
          disabled={parts.length === 0}
          onClick={() => copy(joinPromptParts(parts), promptOnly ? 'Prompt' : 'All parts')}
        >
          Copy {parts.length > 1 ? 'all parts' : 'prompt'}
        </button>
      </div>

      {parts.length === 0 ? (
        <div className="prompt-empty">
          <span className="big">🎬</span>
          Pick your categories and fill in the dealer details to see the storyboard and master prompt.
        </div>
      ) : (
        parts.map((p) => {
          const open = openPart === p.partNum;
          return (
            <div className={`prompt-part${open ? ' open' : ''}`} key={p.partNum}>
              <div
                className="ph"
                role="button"
                tabIndex={0}
                onClick={() => setOpenPart(open ? null : p.partNum)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpenPart(open ? null : p.partNum);
                  }
                }}
              >
                <span>
                  <span className="ph-caret" aria-hidden>
                    ▸
                  </span>
                  {p.totalParts > 1 ? `Part ${p.partNum} / ${p.totalParts}` : 'Master prompt'} · {p.duration}s
                  {p.isFirst ? ' · create' : ' · continue'}
                  {p.isLast && p.totalParts > 1 ? ' · final' : ''}
                </span>
                <button
                  className="btn ghost small"
                  onClick={(e) => {
                    e.stopPropagation();
                    copy(p.text, `Part ${p.partNum}`);
                  }}
                >
                  Copy
                </button>
              </div>
              {open && <pre>{p.text}</pre>}
            </div>
          );
        })
      )}
    </div>
  );
}
