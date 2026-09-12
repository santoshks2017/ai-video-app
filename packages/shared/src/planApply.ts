/**
 * Filling a project in from its brief.
 *
 * The designer writes what the film is for — "a Ganesh Chaturthi post inviting
 * customers to buy a bike" — and everything up to the storyboard follows from that:
 * the use cases, the fields each one asks for, the vehicle, the presenter, the call
 * to action. Reading the brief is the server's job (it takes a model); deciding what
 * may be written into the project is this file's, so the rules are testable and the
 * same wherever a plan comes from.
 *
 * The rule that matters: a filled-in answer is never overwritten. The plan fills what
 * is still empty, so a designer who has already chosen something keeps it — unless
 * they ask for a fresh fill, which replaces the lot.
 */

import type { CarModelProfile, ActorProfile, Project, ProjectVideoSpec } from './library.js';
import type { CategoryDef, CategoryId } from './types.js';
import { CATEGORY_BY_ID } from './categories.js';
import { emptySpec } from './compose.js';
import { brandMatches } from './compose.js';

/** What reading a brief produces. Everything is optional: an unclear brief says less. */
export interface BriefPlan {
  useCases?: CategoryId[];
  /** Per use case, the field values the brief actually states. */
  fieldValues?: Partial<Record<CategoryId, Record<string, string>>>;
  spec?: Partial<ProjectVideoSpec>;
  /** The vehicle and paint the brief names, as written. */
  vehicle?: { model?: string; colour?: string };
  /** The presenter the brief asks for, by name. */
  actor?: string;
  /** One sentence for the designer, on what was understood. */
  why?: string;
}

export interface ApplyPlanInput {
  cars: CarModelProfile[];
  actors: ActorProfile[];
  /** Replace what is already there, rather than only filling the blanks. */
  force?: boolean;
}

const blank = (v: unknown): boolean => !String(v ?? '').trim();

/** A spec value counts as unset when it is still whatever a new project starts with. */
function untouched<K extends keyof ProjectVideoSpec>(spec: ProjectVideoSpec, key: K, fresh: ProjectVideoSpec): boolean {
  const v = spec[key];
  return blank(v) || v === fresh[key];
}

/**
 * A field this use case actually has: one of its own, or a numbered row of one of its
 * lists (feature3, benefit3, offer2). Anything else is something the reader made up.
 */
function knownField(cat: CategoryDef, key: string): boolean {
  return cat.fields.some((f) => {
    if (f.id === key) return true;
    if (f.type !== 'list' || !f.list) return false;
    const row = (id: string): boolean => new RegExp(`^${id}\\d+$`).test(key);
    return row(f.id) || Boolean(f.list.sub && row(f.list.sub.id));
  });
}

const match = (haystack: string, needle: string): boolean => {
  const a = haystack.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const b = needle.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
};

/**
 * The changes a plan makes to a project — nothing else is touched, and the result is
 * a patch the editor can apply and undo in one step.
 */
export function applyBriefPlan(project: Project, plan: BriefPlan, input: ApplyPlanInput): Partial<Project> {
  const force = input.force === true;
  const patch: Partial<Project> = {};
  const fresh = emptySpec();

  // Use cases the library actually has, in the order the plan put them.
  const useCases = [...new Set((plan.useCases ?? []).filter((id) => CATEGORY_BY_ID[id]))];
  if (useCases.length && (force || !project.useCases.length)) patch.useCases = useCases;
  const live = patch.useCases ?? project.useCases;

  // Field values, for the use cases the project ends up with.
  const fieldValues: Project['fieldValues'] = { ...project.fieldValues };
  let touchedFields = false;
  for (const id of live) {
    const asked = plan.fieldValues?.[id];
    const cat = CATEGORY_BY_ID[id];
    if (!asked || !cat) continue;
    const current = { ...(fieldValues[id] ?? {}) };
    for (const [key, value] of Object.entries(asked)) {
      if (blank(value)) continue;
      if (!knownField(cat, key)) continue;
      // A select only ever holds one of its own options.
      const field = cat.fields.find((f) => f.id === key);
      if (field?.type === 'select' && !(field.options ?? []).includes(value)) continue;
      if (!force && !blank(current[key])) continue;
      current[key] = value.trim();
      touchedFields = true;
    }
    fieldValues[id] = current;
  }
  if (touchedFields) patch.fieldValues = fieldValues;

  // The spec: only the parts a brief can reasonably decide.
  const spec = { ...project.spec };
  let touchedSpec = false;
  const specKeys: (keyof ProjectVideoSpec)[] = ['narration', 'aspect', 'cta', 'music', 'captionStyle', 'visualStyle'];
  for (const key of specKeys) {
    const value = plan.spec?.[key];
    if (value === undefined || blank(value)) continue;
    if (!force && !untouched(project.spec, key, fresh)) continue;
    (spec[key] as unknown) = value;
    touchedSpec = true;
  }
  if (typeof plan.spec?.pace === 'number' && (force || !project.spec.pace)) {
    spec.pace = plan.spec.pace;
    touchedSpec = true;
  }
  if (touchedSpec) patch.spec = spec;

  // The vehicle, matched against the library rather than taken on trust.
  const wanted = plan.vehicle?.model?.trim();
  if (wanted && (force || !project.carIds?.length)) {
    const car =
      input.cars.find((c) => match(`${c.brand} ${c.model}`, wanted)) ??
      input.cars.find((c) => match(c.model, wanted)) ??
      input.cars.find((c) => brandMatches(c.brand, wanted));
    if (car) {
      patch.carIds = [car.id];
      patch.carId = car.id;
      const colour = plan.vehicle?.colour?.trim();
      const found = colour ? car.colours.find((c) => match(c.name, colour)) : undefined;
      if (found && (force || blank(project.carColour))) patch.carColour = found.name;
    }
  }

  const actorName = plan.actor?.trim();
  if (actorName && (force || !project.actorId)) {
    const actor = input.actors.find((a) => match(a.name, actorName));
    if (actor) patch.actorId = actor.id;
  }

  return patch;
}
