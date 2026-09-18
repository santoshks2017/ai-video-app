import { createContext, useContext } from 'react';

/** Projects are films or social creatives; the Projects section shows one kind at a time. */
export type ProjectKind = 'video' | 'image';
const KIND_KEY = 'ava.projects.kind';

export const readProjectKind = (): ProjectKind => {
  try {
    return localStorage.getItem(KIND_KEY) === 'image' ? 'image' : 'video';
  } catch {
    return 'video';
  }
};
export const keepProjectKind = (k: ProjectKind): void => {
  try {
    localStorage.setItem(KIND_KEY, k);
  } catch {
    /* storage off: the choice lasts for this visit */
  }
};

export const ProjectKindContext = createContext<{ kind: ProjectKind; pick: (k: ProjectKind) => void }>({ kind: 'video', pick: () => {} });

/** Video | Image, beside the Projects heading of either list. */
export function ProjectKindSwitch() {
  const { kind, pick } = useContext(ProjectKindContext);
  return (
    <div className="seg ip-kind" role="tablist" aria-label="Kind of project">
      <button type="button" role="tab" aria-selected={kind === 'video'} className={kind === 'video' ? 'on' : ''} onClick={() => pick('video')}>
        Video
      </button>
      <button type="button" role="tab" aria-selected={kind === 'image'} className={kind === 'image' ? 'on' : ''} onClick={() => pick('image')}>
        Image
      </button>
    </div>
  );
}
