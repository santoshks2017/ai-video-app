import { useMemo } from 'react';
import {
  buildPrompt,
  runChecks,
  estimateCost,
  isPromptOnly,
  type PromptPart,
} from '@ava/shared';
import { useBrief } from './state/briefStore.js';
import { BriefForm } from './components/BriefForm.js';
import { Storyboard } from './components/Storyboard.js';
import { OutputPanel } from './components/OutputPanel.js';
import { GenerationPanel } from './components/GenerationPanel.js';

export default function App() {
  const brief = useBrief((s) => s.brief);
  const sceneEdits = useBrief((s) => s.sceneEdits);
  const prefillAll = useBrief((s) => s.prefillAll);
  const resetBrief = useBrief((s) => s.reset);

  const promptOnly = isPromptOnly(brief.categories);

  const built = useMemo(() => buildPrompt(brief, { sceneOverrides: sceneEdits }), [brief, sceneEdits]);

  const preflight = useMemo(() => runChecks(brief), [brief]);
  const cost = useMemo(
    () => (promptOnly ? null : estimateCost(brief)),
    [brief, promptOnly],
  );

  const parts: PromptPart[] = built?.parts ?? [];

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="mark">AV</div>
          <div>
            <h1>AI Video App</h1>
            <div className="sub">CarDekho dealer ad-slot videos &middot; brief → storyboard → pre-flight → prompt</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="btn small"
            type="button"
            disabled={brief.categories.length === 0}
            title={
              brief.categories.length === 0
                ? 'Pick at least one category first'
                : 'Fill every section with sample data for the selected categor' +
                  (brief.categories.length > 1 ? 'ies' : 'y') +
                  ' (overwrites current values)'
            }
            onClick={prefillAll}
          >
            Prefill sample data
          </button>
          {brief.categories.length > 0 && (
            <button className="btn ghost small" type="button" onClick={resetBrief} title="Clear the whole brief">
              Reset
            </button>
          )}
          {brief.categories.length > 0 && (
            <span className={`pill ${promptOnly ? 'prompt-only' : 'automated'}`}>
              {promptOnly ? 'Prompt-only (presenter)' : 'Automated (Omni Flash)'}
            </span>
          )}
        </div>
      </div>

      <div className="grid">
        <div className="left-col">
          <BriefForm />
          <Storyboard scenePlan={built?.scenePlan ?? null} sceneEdits={sceneEdits} />
        </div>
        <div className="right-col">
          <OutputPanel parts={parts} preflight={preflight} cost={cost} promptOnly={promptOnly} />
          {!promptOnly && parts.length > 0 && (
            <GenerationPanel
              brief={brief}
              parts={parts}
              scenePlan={built?.scenePlan ?? null}
              canGenerate={preflight.canGenerate}
              needsCostConfirm={!!cost?.needsConfirmation}
              costInr={cost?.inr ?? 0}
            />
          )}
        </div>
      </div>

      <div className="foot-note">
        v1 single-user tool. The 5 automated categories call Gemini Omni Flash with a server-side key; the 4
        presenter categories stop at the master prompt for manual use in Lumina. Pronunciation &amp; delivery
        rules are injected into every prompt that contains speech.
      </div>
    </div>
  );
}
