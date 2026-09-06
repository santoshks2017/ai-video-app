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
  const [costConfirmed, setCostConfirmed] = useState(false);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`${label} copied`);
      setTimeout(() => setToast(''), 1600);
    } catch {
      setToast('Copy failed — select manually');
    }
  };

  const hasBad = preflight.checks.some((c) => c.level === 'bad');
  const canProceed = preflight.canGenerate && parts.length > 0;
  const generateBlockedByCost = !!cost?.needsConfirmation && !costConfirmed;

  return (
    <div className="card">
      <div className="head">
        <div>
          <h2>{promptOnly ? 'Master prompt (copy for Lumina)' : 'Master prompt'}</h2>
          <div className="prompt-meta">
            {parts.length > 0
              ? `${parts.length} part${parts.length > 1 ? 's' : ''}`
              : 'Pick categories and fill the brief'}
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
          {cost.needsConfirmation && (
            <label className="check-row" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={costConfirmed}
                onChange={(e) => setCostConfirmed(e.target.checked)}
              />
              <span>Over ₹500 — confirm this spend before generating.</span>
            </label>
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

        {!promptOnly && (
          <button
            className="btn primary"
            disabled={!canProceed || generateBlockedByCost}
            title={
              hasBad
                ? 'Resolve the blocking checks first'
                : generateBlockedByCost
                  ? 'Confirm the cost first'
                  : 'Backend not wired yet in this build'
            }
            onClick={() => setToast('Generation backend not wired yet — copy the prompt into Lumina for now')}
          >
            Generate video
          </button>
        )}
      </div>

      {!promptOnly && (
        <div className="hint" style={{ margin: '0 16px 12px' }}>
          The <code>Generate video</code> path (Omni Flash API call, P0.1) is stubbed in this build. Pre-flight,
          cost gate and prompt assembly are live. Prompt-only presenter categories are fully functional today.
        </div>
      )}

      {parts.length === 0 ? (
        <div className="prompt-empty">
          <span className="big">🎬</span>
          Pick your categories and fill in the dealer details to see the storyboard and master prompt.
        </div>
      ) : (
        parts.map((p) => (
          <div className="prompt-part" key={p.partNum}>
            <div className="ph">
              <span>
                {p.totalParts > 1 ? `Part ${p.partNum} / ${p.totalParts}` : 'Master prompt'} · {p.duration}s
                {p.isFirst ? ' · create' : ' · extend'}
                {p.isLast && p.totalParts > 1 ? ' · final' : ''}
              </span>
              <button className="btn ghost small" onClick={() => copy(p.text, `Part ${p.partNum}`)}>
                Copy
              </button>
            </div>
            <pre>{p.text}</pre>
          </div>
        ))
      )}
    </div>
  );
}
