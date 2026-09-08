import { useState, type ReactElement } from 'react';
import {
  fmtTime,
  wordBudget,
  narrationMode,
  type ScenePlan,
} from '@ava/shared';
import type { NarrationKey } from '@ava/shared';

/**
 * Editable storyboard (PRD P0.5): scene-by-scene table with timing, roll type,
 * reference image and voiceover. Edits to a scene's script or shot are saved and
 * fed back into the master prompt (buildPrompt sceneOverrides).
 */
export function Storyboard({
  scenePlan,
  sceneEdits,
  narration,
  onEditScene,
  onClearEdits,
  onWriteScript,
}: {
  scenePlan: ScenePlan | null;
  sceneEdits: Record<string, { dialogue?: string; shot?: string }>;
  narration: NarrationKey;
  onEditScene: (key: string, patch: { dialogue?: string; shot?: string }) => void;
  onClearEdits: () => void;
  /** Fills every spoken scene with a real line. Resolves to a status message. */
  onWriteScript?: () => Promise<string>;
}) {
  const [writing, setWriting] = useState(false);
  const [scriptNote, setScriptNote] = useState('');
  const mode = narrationMode(narration);
  const editScene = onEditScene;
  const clearSceneEdits = onClearEdits;

  if (!scenePlan || scenePlan.scenes.length === 0) {
    return null;
  }

  const editCount = Object.keys(sceneEdits).length;
  const spokenScenes = mode.speaks ? scenePlan.scenes.filter((sc) => sc.beat.dialogue).length : 0;
  const scripted = mode.speaks
    ? scenePlan.scenes.filter((_, i) => (sceneEdits[String(i)]?.dialogue ?? '').trim()).length
    : 0;

  const writeScript = async () => {
    if (!onWriteScript) return;
    setWriting(true);
    setScriptNote('');
    setScriptNote(await onWriteScript());
    setWriting(false);
  };

  let lastPart = -1;

  return (
    <div className="card">
      <div className="head">
        <h2>Storyboard</h2>
        <span className="step">
          {scenePlan.scenes.length} scenes · {scenePlan.parts} part{scenePlan.parts > 1 ? 's' : ''}
        </span>
      </div>
      <div className="body tight" style={{ overflowX: 'auto' }}>
        {mode.speaks && onWriteScript && (
          <div className={`script-bar${scripted >= spokenScenes && spokenScenes > 0 ? ' done' : ''}`}>
            <div>
              <b>
                {scripted}/{spokenScenes} scenes have a written line
              </b>
              <span>
                {scripted >= spokenScenes && spokenScenes > 0
                  ? 'The model speaks these words instead of composing its own — read them through before generating.'
                  : 'Without a line the model invents the Hindi, pronounces it and lip-syncs to it all at once. Write the lines and it just reads them.'}
              </span>
              {scriptNote && <span className="script-note">{scriptNote}</span>}
            </div>
            <button className="btn primary small" type="button" disabled={writing} onClick={writeScript}>
              {writing ? 'Writing…' : scripted ? 'Rewrite script' : 'Write the script'}
            </button>
          </div>
        )}
        <div className="section-desc">
          Edit any scene’s script or shot below — changes flow straight into the master prompt on the right, no
          full rebuild of the brief.
          {editCount > 0 && (
            <>
              {' '}
              <button className="btn ghost small" onClick={clearSceneEdits}>
                Reset {editCount} edit{editCount > 1 ? 's' : ''}
              </button>
            </>
          )}
        </div>
        <table className="sb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Timing</th>
              <th>Scene / roll</th>
              <th>Shot direction</th>
              <th>{mode.speaks ? 'Voiceover / script' : 'Story beat (no speech)'}</th>
              <th>On-screen</th>
            </tr>
          </thead>
          <tbody>
            {scenePlan.scenes.map((sc, gi) => {
              const rows: ReactElement[] = [];
              if (sc.part !== lastPart && scenePlan.parts > 1) {
                lastPart = sc.part;
                rows.push(
                  <tr className="sb-part-row" key={`p${sc.part}`}>
                    <td colSpan={6}>
                      Part {sc.part + 1} of {scenePlan.parts}
                      {sc.part === 0 ? ' — create' : ' — extend'}
                    </td>
                  </tr>,
                );
              }
              const ov = sceneEdits[String(gi)] ?? {};
              const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
              rows.push(
                <tr key={gi}>
                  <td className="t">{gi + 1}</td>
                  <td className="t">
                    {fmtTime(sc.start)}–{fmtTime(sc.end)}
                    <br />
                    {sc.duration}s
                  </td>
                  <td>
                    <div className="sb-scene-title">{sc.beat.title}</div>
                    <div className="hint">{sc.beat.cat}</div>
                  </td>
                  <td>
                    <textarea
                      value={ov.shot ?? baseShot}
                      onChange={(e) => editScene(String(gi), { shot: e.target.value })}
                    />
                  </td>
                  <td>
                    <textarea
                      value={ov.dialogue ?? sc.beat.dialogue ?? ''}
                      onChange={(e) => editScene(String(gi), { dialogue: e.target.value })}
                    />
                    {mode.speaks && (
                      <div className="hint">~{wordBudget(sc.duration)} words max</div>
                    )}
                  </td>
                  <td>
                    {sc.beat.card && <div>“{sc.beat.card}”</div>}
                    {sc.beat.cardSub && <div className="hint">“{sc.beat.cardSub}”</div>}
                    {(sc.beat.cardLines ?? []).map((l, i) => (
                      <div key={i} className="hint">
                        “{l}”
                      </div>
                    ))}
                  </td>
                </tr>,
              );
              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
