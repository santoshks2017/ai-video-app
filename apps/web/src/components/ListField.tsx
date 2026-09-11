import { listLength, type CategoryField } from '@ava/shared';
import { Field } from './ui.js';

/**
 * A repeatable field — features, offers — two rows to start and more on request.
 *
 * Rows are stored as numbered keys (`${field.id}1`, `${field.id}2`…). How many rows
 * someone has added is kept as `${field.id}Rows`, so an empty row they add survives
 * a re-render or a reload instead of vanishing before it is typed into. Removing a
 * row moves every row below it up, so the numbering never has a gap.
 */
export function ListField({
  field,
  label,
  values,
  onPatch,
}: {
  field: CategoryField;
  label: string;
  values: Record<string, string>;
  onPatch: (patch: Record<string, string>) => void;
}) {
  const spec = field.list!;
  const subId = spec.sub?.id;
  const countKey = `${field.id}Rows`;
  const rows = Math.min(
    spec.max,
    Math.max(spec.min, listLength(values, field.id, subId, spec.max), Number(values[countKey]) || 0),
  );
  const Noun = spec.noun.charAt(0).toUpperCase() + spec.noun.slice(1);

  const removeRow = (n: number) => {
    const patch: Record<string, string> = {};
    for (let k = n; k < rows; k++) {
      patch[`${field.id}${k}`] = values[`${field.id}${k + 1}`] ?? '';
      if (subId) patch[`${subId}${k}`] = values[`${subId}${k + 1}`] ?? '';
    }
    patch[`${field.id}${rows}`] = '';
    if (subId) patch[`${subId}${rows}`] = '';
    patch[countKey] = String(Math.max(spec.min, rows - 1));
    onPatch(patch);
  };

  return (
    <Field label={label}>
      <div className="list-rows">
        {Array.from({ length: rows }, (_, i) => i + 1).map((n) => (
          <div className="list-row" key={n}>
            <span className="list-row-no" aria-hidden>
              {n}
            </span>
            <div className="list-row-inputs">
              <input
                value={values[`${field.id}${n}`] ?? ''}
                placeholder={n === 1 ? field.ph : `${Noun} ${n}`}
                aria-label={`${spec.noun} ${n}`}
                onChange={(e) => onPatch({ [`${field.id}${n}`]: e.target.value })}
              />
              {spec.sub && subId && (
                <input
                  className="list-row-sub"
                  value={values[`${subId}${n}`] ?? ''}
                  placeholder={`${spec.sub.label}${n === 1 && spec.sub.ph ? ` — ${spec.sub.ph}` : ''}`}
                  aria-label={`${spec.sub.label} for ${spec.noun} ${n}`}
                  onChange={(e) => onPatch({ [`${subId}${n}`]: e.target.value })}
                />
              )}
            </div>
            {rows > spec.min ? (
              <button
                type="button"
                className="btn ghost small"
                title={`Remove ${spec.noun} ${n}`}
                aria-label={`Remove ${spec.noun} ${n}`}
                onClick={() => removeRow(n)}
              >
                ✕
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {rows < spec.max && (
          <button
            type="button"
            className="btn small list-add"
            onClick={() => onPatch({ [countKey]: String(rows + 1) })}
          >
            + Add another {spec.noun}
          </button>
        )}
      </div>
    </Field>
  );
}
