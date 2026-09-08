import { create } from 'zustand';
import type {
  ActorProfile,
  ApiCredential,
  CarModelProfile,
  ClientProfile,
  GlobalInstruction,
  LanguageProfile,
  Project,
  VideoModelProfile,
} from '@ava/shared';
import { collection, getToken, isApiError, session, setToken } from '../lib/client.js';

export type Section =
  | 'projects'
  | 'actors'
  | 'cars'
  | 'clients'
  | 'instructions'
  | 'languages'
  | 'models'
  | 'whatsnew';

const actorsApi = collection<ActorProfile>('actors');
const carsApi = collection<CarModelProfile>('cars');
const clientsApi = collection<ClientProfile>('clients');
const instructionsApi = collection<GlobalInstruction>('instructions');
const languagesApi = collection<LanguageProfile>('languages');
const projectsApi = collection<Project>('projects');
const credentialsApi = collection<ApiCredential>('credentials');
const modelsApi = collection<VideoModelProfile>('models');

export const api = {
  actors: actorsApi,
  cars: carsApi,
  clients: clientsApi,
  instructions: instructionsApi,
  languages: languagesApi,
  projects: projectsApi,
  credentials: credentialsApi,
  models: modelsApi,
};

/**
 * One open workspace tab. The id is derived from what the tab shows, so opening
 * the same project or section twice focuses the tab that already exists.
 */
export interface Tab {
  id: string;
  kind: 'section' | 'project';
  /** Which rail item lights up — a project tab still belongs to Projects. */
  section: Section;
  projectId?: string;
}

export const sectionTabId = (section: Section): string => `section:${section}`;
export const projectTabId = (projectId: string): string => `project:${projectId}`;

interface AppState {
  /** null = still checking */
  signedIn: boolean | null;
  authEnabled: boolean;
  signInError: string;
  /** Every open tab stays mounted, so a generation running in one keeps running
   *  while the designer works in another. */
  tabs: Tab[];
  activeTabId: string;
  /** Projects with a generation in flight, so their tab can say so. */
  busyProjects: Record<string, boolean>;

  actors: ActorProfile[];
  cars: CarModelProfile[];
  clients: ClientProfile[];
  instructions: GlobalInstruction[];
  languages: LanguageProfile[];
  projects: Project[];
  credentials: ApiCredential[];
  models: VideoModelProfile[];
  loading: boolean;

  init: () => Promise<void>;
  signIn: (password: string) => Promise<boolean>;
  signOut: () => void;
  /** Open the tab for this section or project, or focus it if already open. */
  go: (section: Section, projectId?: string | null) => void;
  focusTab: (id: string) => void;
  closeTab: (id: string) => void;
  setProjectBusy: (projectId: string, busy: boolean) => void;
  refresh: () => Promise<void>;
}

const HOME: Tab = { id: sectionTabId('projects'), kind: 'section', section: 'projects' };

export const useApp = create<AppState>()((set, get) => ({
  signedIn: null,
  authEnabled: true,
  signInError: '',
  tabs: [HOME],
  activeTabId: HOME.id,
  busyProjects: {},
  actors: [],
  cars: [],
  clients: [],
  instructions: [],
  languages: [],
  projects: [],
  credentials: [],
  models: [],
  loading: false,

  init: async () => {
    const s = await session.status();
    const authEnabled = isApiError(s) ? true : s.authEnabled;
    const hasToken = !!getToken();
    const signedIn = !authEnabled || hasToken;
    set({ authEnabled, signedIn });
    if (signedIn) await get().refresh();
  },

  signIn: async (password) => {
    set({ signInError: '' });
    const r = await session.signIn(password);
    if (isApiError(r)) {
      set({ signInError: r.message });
      return false;
    }
    setToken(r.token);
    set({ signedIn: true });
    await get().refresh();
    return true;
  },

  signOut: () => {
    setToken(null);
    set({
      tabs: [HOME],
      activeTabId: HOME.id,
      busyProjects: {},
      signedIn: false,
      actors: [],
      cars: [],
      clients: [],
      instructions: [],
      languages: [],
      projects: [],
      credentials: [],
      models: [],
    });
  },

  go: (section, projectId = null) => {
    const tab: Tab = projectId
      ? { id: projectTabId(projectId), kind: 'project', section: 'projects', projectId }
      : { id: sectionTabId(section), kind: 'section', section };
    set((s) => ({
      tabs: s.tabs.some((t) => t.id === tab.id) ? s.tabs : [...s.tabs, tab],
      activeTabId: tab.id,
    }));
  },

  focusTab: (id) => set({ activeTabId: id }),

  closeTab: (id) =>
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      if (i < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      // Closing the last tab leaves the projects list rather than a blank screen.
      if (!tabs.length) return { tabs: [HOME], activeTabId: HOME.id };
      // Focus moves to the neighbour on the left, which is where the eye already is.
      const activeTabId =
        s.activeTabId === id ? (tabs[Math.max(0, i - 1)] ?? tabs[0])!.id : s.activeTabId;
      return { tabs, activeTabId };
    }),

  setProjectBusy: (projectId, busy) =>
    set((s) => ({ busyProjects: { ...s.busyProjects, [projectId]: busy } })),

  refresh: async () => {
    set({ loading: true });
    const [actors, cars, clients, instructions, languages, projects, credentials, models] = await Promise.all([
      actorsApi.list(),
      carsApi.list(),
      clientsApi.list(),
      instructionsApi.list(),
      languagesApi.list(),
      projectsApi.list(),
      credentialsApi.list(),
      modelsApi.list(),
    ]);
    set({ actors, cars, clients, instructions, languages, projects, credentials, models, loading: false });
  },
}));
