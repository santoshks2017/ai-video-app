import { create } from 'zustand';
import type {
  ActorProfile,
  ApiCredential,
  CarModelProfile,
  ClientProfile,
  GlobalInstruction,
  LanguageProfile,
  AppUser,
  Role,
  Project,
  VideoModelProfile,
} from '@ava/shared';
import { collection, isApiError, session, type SessionUser } from '../lib/client.js';
import { completeRedirectSignIn, signInWithGoogle, signOutGoogle, watchGoogleAuth } from '../lib/firebase.js';

export type Section =
  | 'projects'
  | 'actors'
  | 'cars'
  | 'clients'
  | 'instructions'
  | 'languages'
  | 'models'
  | 'users'
  | 'whatsnew';

const actorsApi = collection<ActorProfile>('actors');
const carsApi = collection<CarModelProfile>('cars');
const clientsApi = collection<ClientProfile>('clients');
const instructionsApi = collection<GlobalInstruction>('instructions');
const languagesApi = collection<LanguageProfile>('languages');
const usersApi = collection<AppUser>('users');
const projectsApi = collection<Project>('projects');
const credentialsApi = collection<ApiCredential>('credentials');
const modelsApi = collection<VideoModelProfile>('models');

export const api = {
  actors: actorsApi,
  cars: carsApi,
  clients: clientsApi,
  instructions: instructionsApi,
  languages: languagesApi,
  users: usersApi,
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
  /** True when this session is a sign-in-free preview. */
  previewOpen: boolean;
  authEnabled: boolean;
  signInError: string;
  /** Who is signed in, and what they may do. Null while still checking. */
  me: SessionUser | null;
  /** Convenience: does the signed-in person clear this bar? */
  can: (needed: Role) => boolean;
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
  users: AppUser[];
  projects: Project[];
  credentials: ApiCredential[];
  models: VideoModelProfile[];
  loading: boolean;

  init: () => Promise<void>;
  signInGoogle: () => Promise<boolean>;
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
  previewOpen: false,
  authEnabled: true,
  signInError: '',
  me: null,
  can: (needed) => {
    const order = { viewer: 0, creator: 1, admin: 2 } as const;
    return order[get().me?.role ?? 'viewer'] >= order[needed];
  },
  tabs: [HOME],
  activeTabId: HOME.id,
  busyProjects: {},
  actors: [],
  cars: [],
  clients: [],
  instructions: [],
  languages: [],
  users: [],
  projects: [],
  credentials: [],
  models: [],
  loading: false,

  init: async () => {
    // A preview built to open without signing in asks the server straight away.
    // The server decides whether this address and moment allow it; the page only
    // asks. If it says no, normal Google sign-in follows below.
    if (import.meta.env.VITE_PREVIEW_OPEN === '1') {
      const open = await session.status();
      if (!isApiError(open) && open.signedIn && open.previewOpen) {
        set({ authEnabled: open.authEnabled, me: open.user, signedIn: true, previewOpen: true });
        await get().refresh();
        return;
      }
    }

    // A redirect sign-in lands back here mid-flight; finish it before deciding
    // whether anybody is signed in, and surface anything it went wrong with.
    const redirectError = await completeRedirectSignIn();
    if (redirectError) set({ signInError: redirectError });

    // Firebase restores a session asynchronously, and refreshes the token every
    // hour, so the app follows that stream rather than checking once at startup.
    let settled = false;
    watchGoogleAuth(async () => {
      const s = await session.status();
      // Settle the moment the session answers, BEFORE loading the libraries.
      // Marking it settled after the refresh meant a slow refresh let the
      // fallback below fire and sign a signed-in person straight back out.
      settled = true;
      if (isApiError(s)) {
        set({ signedIn: false, me: null });
        return;
      }
      set({ authEnabled: s.authEnabled, me: s.user, signedIn: s.signedIn });
      if (s.signedIn) await get().refresh();
    });
    // No Firebase session and no legacy token means nothing will fire above.
    setTimeout(() => {
      if (!settled) set({ signedIn: false, me: null });
    }, 2500);
  },

  signInGoogle: async () => {
    set({ signInError: '' });
    const r = await signInWithGoogle();
    if (!r.ok) {
      if (r.message) set({ signInError: r.message });
      return false;
    }
    // watchGoogleAuth picks the token up and loads the session.
    return true;
  },


  signOut: () => {
    void signOutGoogle().catch(() => {});
    set({
      tabs: [HOME],
      activeTabId: HOME.id,
      busyProjects: {},
      signedIn: false,
      me: null,
      actors: [],
      cars: [],
      clients: [],
      instructions: [],
      languages: [],
      users: [],
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
    const admin = get().can('admin');
    const [actors, cars, clients, instructions, languages, projects, credentials, models, users] = await Promise.all([
      actorsApi.list(),
      carsApi.list(),
      clientsApi.list(),
      instructionsApi.list(),
      languagesApi.list(),
      projectsApi.list(),
      admin ? credentialsApi.list() : Promise.resolve([]),
      modelsApi.list(),
      admin ? usersApi.list() : Promise.resolve([]),
    ]);
    set({ actors, cars, clients, instructions, languages, projects, credentials, models, users, loading: false });
  },
}));
