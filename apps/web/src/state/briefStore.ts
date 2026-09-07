import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  emptyBrief,
  SAMPLE_FIELDS,
  SAMPLE_DEALER,
  SAMPLE_ACTOR,
  SAMPLE_CAR_MODEL,
  CATEGORY_BY_ID,
  type Brief,
  type CategoryId,
  type DealerPhoto,
} from '@ava/shared';

interface BriefState {
  brief: Brief;
  set: (patch: Partial<Brief>) => void;
  setDealer: (patch: Partial<Brief['dealer']>) => void;
  setActor: (patch: Partial<Brief['actor']>) => void;
  toggleCategory: (id: CategoryId) => void;
  setFieldValue: (cat: CategoryId, field: string, value: string) => void;
  /** Fill this category's fields with sample data + backfill any blank shared essentials. */
  prefillCategory: (cat: CategoryId) => void;
  addAttachment: (a: DealerPhoto) => void;
  removeAttachment: (filename: string) => void;
  reset: () => void;
  /** Per-scene manual overrides of dialogue / shot, keyed by "part:index". */
  sceneEdits: Record<string, { dialogue?: string; shot?: string }>;
  editScene: (key: string, patch: { dialogue?: string; shot?: string }) => void;
  clearSceneEdits: () => void;
}

export const useBrief = create<BriefState>()(
  persist(
    (setState, get) => ({
      brief: emptyBrief(),
      sceneEdits: {},
      set: (patch) => setState({ brief: { ...get().brief, ...patch } }),
      setDealer: (patch) =>
        setState({ brief: { ...get().brief, dealer: { ...get().brief.dealer, ...patch } } }),
      setActor: (patch) =>
        setState({ brief: { ...get().brief, actor: { ...get().brief.actor, ...patch } } }),
      toggleCategory: (id) => {
        const cur = get().brief.categories;
        const next = cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id];
        setState({ brief: { ...get().brief, categories: next } });
      },
      setFieldValue: (cat, field, value) => {
        const fv = get().brief.fieldValues;
        setState({
          brief: {
            ...get().brief,
            fieldValues: { ...fv, [cat]: { ...(fv[cat] ?? {}), [field]: value } },
          },
        });
      },
      prefillCategory: (cat) => {
        const b = get().brief;
        const orBlank = (cur: string | undefined, sample: string) => (cur?.trim() ? cur : sample);
        setState({
          brief: {
            ...b,
            categories: b.categories.includes(cat) ? b.categories : [...b.categories, cat],
            music: b.music.trim() || CATEGORY_BY_ID[cat].music,
            carModel: b.modelSpecific ? orBlank(b.carModel, SAMPLE_CAR_MODEL) : b.carModel,
            fieldValues: { ...b.fieldValues, [cat]: { ...SAMPLE_FIELDS[cat] } },
            dealer: {
              ...b.dealer,
              dealerName: orBlank(b.dealer.dealerName, SAMPLE_DEALER.dealerName),
              brandModel: orBlank(b.dealer.brandModel, SAMPLE_DEALER.brandModel),
              phone: orBlank(b.dealer.phone, SAMPLE_DEALER.phone),
              address: orBlank(b.dealer.address, SAMPLE_DEALER.address),
              fakeBrandModel: orBlank(b.dealer.fakeBrandModel, SAMPLE_DEALER.fakeBrandModel),
              fakeDealer: orBlank(b.dealer.fakeDealer, SAMPLE_DEALER.fakeDealer),
            },
            actor: {
              ...b.actor,
              name: orBlank(b.actor.name, SAMPLE_ACTOR.name),
              age: orBlank(b.actor.age, SAMPLE_ACTOR.age ?? ''),
              style: orBlank(b.actor.style, SAMPLE_ACTOR.style ?? ''),
              voice: orBlank(b.actor.voice, SAMPLE_ACTOR.voice ?? ''),
            },
          },
        });
      },
      addAttachment: (a) => {
        const cur = get().brief.attachments.filter((x) => x.filename !== a.filename);
        setState({ brief: { ...get().brief, attachments: [...cur, a] } });
      },
      removeAttachment: (filename) =>
        setState({
          brief: {
            ...get().brief,
            attachments: get().brief.attachments.filter((x) => x.filename !== filename),
          },
        }),
      reset: () => setState({ brief: emptyBrief(), sceneEdits: {} }),
      editScene: (key, patch) =>
        setState({ sceneEdits: { ...get().sceneEdits, [key]: { ...get().sceneEdits[key], ...patch } } }),
      clearSceneEdits: () => setState({ sceneEdits: {} }),
    }),
    { name: 'ava.brief.v1' },
  ),
);
