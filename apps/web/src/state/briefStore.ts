import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  emptyBrief,
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
