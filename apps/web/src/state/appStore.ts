import { create } from 'zustand';
import type {
  ActorProfile,
  ApiCredential,
  CarModelProfile,
  ClientProfile,
  GlobalInstruction,
  Project,
  VideoModelProfile,
} from '@ava/shared';
import { collection, getToken, isApiError, session, setToken } from '../lib/client.js';

export type Section = 'projects' | 'actors' | 'cars' | 'clients' | 'instructions' | 'models';

const actorsApi = collection<ActorProfile>('actors');
const carsApi = collection<CarModelProfile>('cars');
const clientsApi = collection<ClientProfile>('clients');
const instructionsApi = collection<GlobalInstruction>('instructions');
const projectsApi = collection<Project>('projects');
const credentialsApi = collection<ApiCredential>('credentials');
const modelsApi = collection<VideoModelProfile>('models');

export const api = {
  actors: actorsApi,
  cars: carsApi,
  clients: clientsApi,
  instructions: instructionsApi,
  projects: projectsApi,
  credentials: credentialsApi,
  models: modelsApi,
};

interface AppState {
  /** null = still checking */
  signedIn: boolean | null;
  authEnabled: boolean;
  signInError: string;
  section: Section;
  openProjectId: string | null;

  actors: ActorProfile[];
  cars: CarModelProfile[];
  clients: ClientProfile[];
  instructions: GlobalInstruction[];
  projects: Project[];
  credentials: ApiCredential[];
  models: VideoModelProfile[];
  loading: boolean;

  init: () => Promise<void>;
  signIn: (password: string) => Promise<boolean>;
  signOut: () => void;
  go: (section: Section, projectId?: string | null) => void;
  refresh: () => Promise<void>;
}

export const useApp = create<AppState>()((set, get) => ({
  signedIn: null,
  authEnabled: true,
  signInError: '',
  section: 'projects',
  openProjectId: null,
  actors: [],
  cars: [],
  clients: [],
  instructions: [],
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
    set({ signedIn: false, actors: [], cars: [], clients: [], instructions: [], projects: [], credentials: [], models: [] });
  },

  go: (section, projectId = null) => set({ section, openProjectId: projectId }),

  refresh: async () => {
    set({ loading: true });
    const [actors, cars, clients, instructions, projects, credentials, models] = await Promise.all([
      actorsApi.list(),
      carsApi.list(),
      clientsApi.list(),
      instructionsApi.list(),
      projectsApi.list(),
      credentialsApi.list(),
      modelsApi.list(),
    ]);
    set({ actors, cars, clients, instructions, projects, credentials, models, loading: false });
  },
}));
