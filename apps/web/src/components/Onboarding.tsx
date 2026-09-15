import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useApp, type Section, type Tab } from '../state/appStore.js';

/**
 * The welcome, the tours, and the page a locked section shows.
 *
 * Viewers are who this is for: somebody being shown the product, or finding their way
 * round it before they are given more. So the welcome opens by itself the first time a
 * viewer signs in, and each section's tour the first time they open that section.
 * Everybody can open either again — the welcome from the menu, a tour from the tab bar.
 */

export type TourId = Section | 'project';

interface TourStep {
  /** The data-tour mark of what to point at. Without one, or when it is not on the page, the step sits in the middle. */
  target?: string;
  kicker?: string;
  title: string;
  body: ReactNode;
}

interface OnboardingState {
  welcome: boolean;
  tour: TourId | null;
  step: number;
  openWelcome: () => void;
  closeWelcome: () => void;
  start: (id: TourId) => void;
  goStep: (step: number) => void;
  end: () => void;
}

export const useOnboarding = create<OnboardingState>()((set) => ({
  welcome: false,
  tour: null,
  step: 0,
  openWelcome: () => set({ welcome: true, tour: null, step: 0 }),
  closeWelcome: () => set({ welcome: false }),
  start: (id) => set({ tour: id, step: 0, welcome: false }),
  goStep: (step) => set({ step }),
  end: () => set({ tour: null, step: 0 }),
}));

/* ---- what has been seen, per person, on this device ---- */

interface Seen {
  welcome?: boolean;
  tours?: Partial<Record<TourId, boolean>>;
}
const seenKey = (userId: string): string => `ava.onboarding.v1.${userId}`;
function readSeen(userId: string): Seen {
  try {
    return JSON.parse(localStorage.getItem(seenKey(userId)) ?? '{}') as Seen;
  } catch {
    return {};
  }
}
function markSeen(userId: string, patch: Seen): void {
  try {
    const cur = readSeen(userId);
    localStorage.setItem(seenKey(userId), JSON.stringify({ ...cur, ...patch, tours: { ...cur.tours, ...patch.tours } }));
  } catch {
    /* storage unavailable — it shows again next time, which is the lesser harm */
  }
}

export const tourForTab = (tab: Tab | undefined): TourId | null =>
  !tab ? null : tab.kind === 'project' ? 'project' : tab.section;

/* ---- the words ---- */

const THREE_STEPS = [
  { n: '01', title: 'Brief', body: 'Say what the ad is for, and pick the dealer, the presenter and the vehicle.' },
  { n: '02', title: 'Storyboard', body: 'Read the script and see every scene drawn. Change any line before anything is rendered.' },
  { n: '03', title: 'Generate', body: 'One click. Voice, music, captions and branding come back as one finished film.' },
];

const FEATURES: { title: string; body: string }[] = [
  { title: 'A sentence is enough', body: 'Describe the ad in plain words. The script, scenes, shots and on-screen text are written from it.' },
  { title: 'Finished, not a first draft', body: 'Voice, music, captions, logos and the dealer’s end card arrive in one film. Nothing to finish elsewhere.' },
  { title: 'Any length, in under 3 minutes', body: 'Longer films are split into parts, rendered side by side and stitched back without a visible join.' },
  { title: 'Same face, same car, every scene', body: 'The presenter and the vehicle stay true from the first frame to the last.' },
  { title: 'The real showroom, the real car', body: 'Built on the dealership’s own photographs and the exact model and colour from CarDekho’s library.' },
  { title: 'Music that sets the mood', body: 'A score matched to the tone of the film, mixed under the voice automatically.' },
  { title: 'Lip-sync that lands', body: 'Hindi, English and regional languages, pronounced right — dealer and model names included.' },
  { title: 'See it before it is made', body: 'Every scene is drawn as a still and every line can be read before a second of video is rendered.' },
  { title: 'Wrong car? Caught and remade', body: 'Each part is checked against the vehicle’s photographs, and a part that drifts is made again on its own.' },
  { title: 'A dealer set up in one step', body: 'Paste a website or Google listing: logo, phone, address and showroom photos come in, background removed.' },
  { title: 'Cast a presenter from a sentence', body: 'Describe who should be on camera and get a profile sheet — hero shot, expressions and every angle.' },
  { title: 'A full video editor, built in', body: 'Trim, reorder, add text, transitions, filters and sound for any last touch, right in the browser.' },
];

type MockKind = 'kpis' | 'rows' | 'releases' | 'list' | 'split';

/** What a section is for, told to someone who may not open it. */
const LOCKED: Partial<Record<Section, { lede: string; points: string[]; mock: MockKind }>> = {
  instructions: {
    lede: 'The house rules every film is made with.',
    points: [
      'Rules that go into every prompt — framing, brand safety, what a film must never show.',
      'Written once by the team and followed by every film, without anyone repeating them.',
      'Kept in order, so the rules that matter most come first.',
    ],
    mock: 'list',
  },
  languages: {
    lede: 'How every film speaks, and spells, each language.',
    points: [
      'A pronunciation rulebook per language, so Hindi, English and regional scripts sound native.',
      'Lines respelled for the voice before rendering, which is what keeps lip-sync on point.',
      'Locked spellings for dealer names, model names and places — said the same way every time.',
      'Rules for on-screen text, footers and end cards in each script.',
    ],
    mock: 'split',
  },
  users: {
    lede: 'Who can explore, who can create, and who runs the app.',
    points: [
      'Viewers look around, creators make films, admins manage connections, models and roles.',
      'Every paid action is tied to the person who took it.',
      'What each person has spent, and a log of recent activity.',
    ],
    mock: 'rows',
  },
  analytics: {
    lede: 'The business behind every film.',
    points: [
      'Revenue, cost and gross margin — overall, and by dealer, city and state.',
      'Paid packs by default, with trial packs one click away.',
      'Any day, week, month or date range, with reports ready to share.',
    ],
    mock: 'kpis',
  },
  whatsnew: {
    lede: 'Every improvement, as it ships.',
    points: ['Release notes for every version, newest first.', 'New tools, new models and fixes — each explained in a line.'],
    mock: 'releases',
  },
  models: {
    lede: 'The engines behind the films.',
    points: [
      'Connect video models and choose which one each project renders with.',
      'Keys are kept on the server and never reach the browser.',
      'Daily limits and pricing, model by model.',
    ],
    mock: 'split',
  },
};

function ThreeSteps() {
  return (
    <ol className="tour-three">
      {THREE_STEPS.map((s) => (
        <li key={s.n}>
          <span className="slate">{s.n}</span>
          <span>
            <b>{s.title}</b>
            {s.body}
          </span>
        </li>
      ))}
    </ol>
  );
}

const TOURS: Partial<Record<TourId, TourStep[]>> = {
  projects: [
    { kicker: 'Welcome', title: 'A dealer film in 3 steps', body: <ThreeSteps /> },
    {
      target: 'projects-new',
      title: 'Every film starts as a project',
      body: 'One project is one film — its brief, its storyboard and the finished video. Creators start one here.',
    },
    {
      target: 'projects-filters',
      title: 'Find any film in seconds',
      body: 'Search by name, or narrow the list to a dealer, a use case or a presenter.',
    },
    {
      target: 'projects-board',
      title: 'From brief to delivered',
      body: 'Every film moves across the board — open, in progress, in review, delivered. Click a card to open the project and watch its latest cut.',
    },
  ],
  project: [
    { kicker: 'The 3 steps', title: 'How this film was made', body: <ThreeSteps /> },
    {
      target: 'ed-project',
      kicker: 'Step 1 · Brief',
      title: 'Say what the ad is for',
      body: 'The brief, in a sentence or two, with the dealer and the presenter. The app reads it and proposes the rest — the use case, the vehicle, the call to action.',
    },
    {
      target: 'ed-usecase',
      kicker: 'Step 1 · Brief',
      title: 'Mix what the film does',
      body: 'Pick one use case or combine several in a single film. Each asks only for the details it needs.',
    },
    {
      target: 'ed-video',
      kicker: 'Step 1 · Brief',
      title: 'Length, language and voice',
      body: 'Any length and shape, the language it speaks, narration and music, captions, the dealer’s end card and where the logos sit.',
    },
    {
      target: 'ed-refs',
      kicker: 'Step 1 · Brief',
      title: 'The real car at the real showroom',
      body: 'The exact vehicle and colour, the dealership’s own photographs and the presenter’s profile sheet go in as references. That is what keeps every scene consistent.',
    },
    {
      target: 'ed-storyboard',
      kicker: 'Step 2 · Storyboard',
      title: 'See the film before it is made',
      body: 'The script is written in three passes and every scene is drawn as a still, with its timing and on-screen text. Any line can change before a second of video is rendered.',
    },
    {
      target: 'ed-generate',
      kicker: 'Step 3 · Generate',
      title: 'One click to a finished film',
      body: 'Long films are split, rendered side by side and stitched back without a visible join — with lip-sync, music, captions and logos. Usually ready in under 3 minutes.',
    },
    {
      target: 'ed-player',
      kicker: 'Step 3 · Generate',
      title: 'Watch the latest cut',
      body: 'Click a scene on the timeline under the video to jump straight to it.',
    },
    {
      target: 'ed-edit',
      kicker: 'Polish',
      title: 'A video editor, built in',
      body: 'Trim, reorder, add text, transitions, filters and sound for any last touch — in the browser, with no other software.',
    },
  ],
  clients: [
    {
      target: 'clients-list',
      title: 'Every dealer, ready to reuse',
      body: 'A client holds the dealership’s logo, phone, address, showroom photos and colours. Every film made for them picks these up by itself.',
    },
    {
      target: 'clients-new',
      title: 'A new dealer in one step',
      body: 'Paste the dealership’s website or Google listing. The logo, phone, address and showroom photos come in, and the logo’s background is taken off.',
    },
    {
      target: 'clients-filters',
      title: 'Find a dealer',
      body: 'Search by name, or narrow by brand, what they sell, city or state.',
    },
    {
      target: 'clients-detail',
      title: 'On brand, every time',
      body: 'Logos placed left, right or not at all, and a colour look for the captions, footer and end card — chosen per client, with a preview.',
    },
  ],
  cars: [
    {
      target: 'cars-brand',
      title: 'A whole line-up in one click',
      body: 'Sync every current model of a brand from CarDekho or BikeDekho — photographs from every angle, variants and colours.',
    },
    { target: 'cars-one', title: 'Or just the one model', body: 'By name, or from the manufacturer’s own page.' },
    {
      target: 'cars-list',
      title: 'Every photo filed by angle',
      body: 'Each photograph is looked at and filed as front, side, rear or interior, then gathered into reference sheets — so a film shows the car from the side a scene asks for.',
    },
    {
      title: 'The car the customer will buy',
      body: 'Films use the model and colour picked on the project, so the car on screen is the one in the showroom.',
    },
  ],
  actors: [
    {
      target: 'actors-list',
      title: 'Presenters who stay the same',
      body: 'Each actor is one consistent person — the same face, outfit and voice in every scene of every film.',
    },
    {
      target: 'actors-new',
      title: 'Cast from a sentence',
      body: 'Describe the presenter you want. The profile fills itself in and a profile sheet is drawn — a hero shot, five expressions and full views from every side.',
    },
    { target: 'actors-filters', title: 'Find the right face', body: 'Filter by gender, age range and attire.' },
    {
      title: 'Delivery that sounds right',
      body: 'Gender sets the Hindi verb forms, and the voice and styling notes go into every film the actor appears in.',
    },
  ],
};

function stepsFor(id: TourId): TourStep[] {
  const own = TOURS[id];
  if (own) return own;
  const locked = LOCKED[id as Section];
  if (!locked) return [];
  return [
    {
      target: 'lock-card',
      title: locked.lede,
      body: (
        <ul className="tour-points">
          {locked.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ),
    },
  ];
}

/* ---- the welcome ---- */

function Welcome({ viewer }: { viewer: boolean }) {
  const me = useApp((s) => s.me);
  const projects = useApp((s) => s.projects);
  const go = useApp((s) => s.go);
  const closeWelcome = useOnboarding((s) => s.closeWelcome);
  const start = useOnboarding((s) => s.start);
  const box = useRef<HTMLDivElement>(null);

  const close = (): void => {
    if (me) markSeen(me.id, { welcome: true });
    closeWelcome();
  };

  // The tour is shown on a real film where there is one: a project that has a video.
  const showMe = (): void => {
    close();
    const withFilm = projects.filter((p) => p.lastFinalUrl || p.lastJobId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (withFilm) {
      go('projects', withFilm.id);
      setTimeout(() => start('project'), 700);
    } else {
      go('projects', null);
      setTimeout(() => start('projects'), 300);
    }
  };

  useEffect(() => {
    box.current?.focus();
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="welcome-wrap" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome" ref={box} tabIndex={-1}>
        <div className="welcome-screen">
          <div className="welcome-eyebrow">AI Video App · dealer films for CarDekho</div>
          <h1 id="welcome-title">
            One brief in.
            <br />A finished dealer film out.
          </h1>
          <p className="welcome-lede">
            Write what the ad should say. The app writes the script, casts the presenter, puts the real car in the
            real showroom, adds the voice, the music and the dealer’s branding — and hands back a film that is ready
            to send.
          </p>
          <ol className="filmstrip" aria-label="How a film is made">
            {THREE_STEPS.map((s, i) => (
              <li key={s.n} className="frame" style={{ animationDelay: `${220 + i * 160}ms` }}>
                <span className="frame-n">{s.n}</span>
                <b>{s.title}</b>
                <span className="frame-body">{s.body}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="welcome-body">
          <h2>What it does</h2>
          <ul className="welcome-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <b>{f.title}</b>
                <span>{f.body}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="welcome-foot">
          <span className="hint">
            {viewer
              ? 'You have view access: open anything and look around. Making films and changing things are for creators.'
              : 'Open this again any time from Welcome in the menu.'}
          </span>
          <button className="btn ghost" type="button" onClick={close}>
            I’ll explore on my own
          </button>
          <button className="btn primary" type="button" onClick={showMe}>
            Show me how it works
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---- a tour ---- */

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const MARGIN = 12;
const GAP = 14;

/**
 * Scroll the one column the thing sits in until it is in view, and nothing else.
 * scrollIntoView scrolls every ancestor it can — hidden-overflow ones included — and
 * that slides the frame of the app out from under the spotlight.
 */
function bringIntoView(el: HTMLElement): void {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (!/(auto|scroll)/.test(getComputedStyle(p).overflowY) || p.scrollHeight <= p.clientHeight) continue;
    const frame = p.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const offset =
      r.height > p.clientHeight * 0.8 ? r.top - frame.top - 12 : r.top - frame.top - (p.clientHeight - r.height) / 2;
    p.scrollTo({ top: p.scrollTop + offset, behavior: 'smooth' });
    return;
  }
}

const sameBox = (a: Box, b: Box): boolean =>
  Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;

/** Beside the thing if there is room, then below, above, to the left — and in the corner when it fills the window. */
function placeCard(box: Box | null, w: number, h: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!box) return { top: Math.max(MARGIN, (vh - h) / 2), left: Math.max(MARGIN, (vw - w) / 2) };
  const clampLeft = (l: number): number => Math.max(MARGIN, Math.min(l, vw - w - MARGIN));
  const clampTop = (t: number): number => Math.max(MARGIN, Math.min(t, vh - h - MARGIN));
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  if (vw - right >= w + GAP + MARGIN) return { top: clampTop(box.top), left: right + GAP };
  if (vh - bottom >= h + GAP + MARGIN) return { top: bottom + GAP, left: clampLeft(box.left) };
  if (box.top >= h + GAP + MARGIN) return { top: box.top - h - GAP, left: clampLeft(box.left) };
  if (box.left >= w + GAP + MARGIN) return { top: clampTop(box.top), left: box.left - w - GAP };
  return { top: vh - h - MARGIN * 2, left: vw - w - MARGIN * 2 };
}

function TourRunner({ id }: { id: TourId }) {
  const step = useOnboarding((s) => s.step);
  const goStep = useOnboarding((s) => s.goStep);
  const end = useOnboarding((s) => s.end);
  const steps = stepsFor(id);
  const current = steps[step];
  const [box, setBox] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });
  const card = useRef<HTMLDivElement>(null);
  const last = step >= steps.length - 1;

  // Find what the step points at — in the tab being looked at, not a hidden one — bring it
  // into view, and keep the spotlight on it. It is looked for and measured on scroll and
  // resize and every quarter second besides: the thing may still be loading, and a web
  // font arriving moves the page without firing either event.
  useLayoutEffect(() => {
    const target = current?.target;
    if (!target) {
      setBox(null);
      return;
    }
    let scrolled = false;
    const measure = (): void => {
      const el = document.querySelector<HTMLElement>(`.pane:not([hidden]) [data-tour="${target}"]`);
      const r = el?.getBoundingClientRect();
      if (!el || !r || (!r.width && !r.height)) return setBox(null);
      if (!scrolled) {
        scrolled = true;
        bringIntoView(el);
      }
      const top = Math.max(MARGIN, r.top - PAD);
      const bottom = Math.min(window.innerHeight - MARGIN, r.bottom + PAD);
      const next = { top, left: r.left - PAD, width: r.width + PAD * 2, height: Math.max(24, bottom - top) };
      setBox((prev) => (prev && sameBox(prev, next) ? prev : next));
    };
    measure();
    const poll = setInterval(measure, 250);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(poll);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [id, step, current?.target]);

  useLayoutEffect(() => {
    const r = card.current?.getBoundingClientRect();
    if (r && (Math.abs(r.width - cardSize.w) > 1 || Math.abs(r.height - cardSize.h) > 1)) setCardSize({ w: r.width, h: r.height });
  });

  useEffect(() => {
    card.current?.focus();
  }, [step]);

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') end();
      else if (e.key === 'ArrowRight') last ? end() : goStep(step + 1);
      else if (e.key === 'ArrowLeft' && step > 0) goStep(step - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step, last, goStep, end]);

  if (!current) return null;
  const pos = placeCard(box, cardSize.w, cardSize.h);

  return createPortal(
    <div className="tour-layer">
      {box ? (
        <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        style={{ top: pos.top, left: pos.left }}
      >
        <div className="tour-eyebrow">
          <span className="tour-kicker">{current.kicker ?? 'Tour'}</span>
          {steps.length > 1 && (
            <span>
              {step + 1} / {steps.length}
            </span>
          )}
        </div>
        <h3 id="tour-title">{current.title}</h3>
        <div className="tour-body">{current.body}</div>
        {steps.length > 1 && (
          <div className="tour-progress" aria-hidden>
            {steps.map((_, i) => (
              <i key={i} className={i <= step ? 'on' : ''} />
            ))}
          </div>
        )}
        <div className="tour-acts">
          {!last && (
            <button type="button" className="btn ghost small skip" onClick={end}>
              Skip tour
            </button>
          )}
          {step > 0 && (
            <button type="button" className="btn ghost small" onClick={() => goStep(step - 1)}>
              Back
            </button>
          )}
          <button type="button" className="btn primary small" onClick={() => (last ? end() : goStep(step + 1))}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---- where it all hangs ---- */

/** Opens the welcome and the first-visit tours for a viewer, and draws whichever is open. */
export function Onboarding() {
  const userId = useApp((s) => s.me?.id);
  const viewer = useApp((s) => !s.can('creator'));
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const welcome = useOnboarding((s) => s.welcome);
  const tour = useOnboarding((s) => s.tour);
  const openWelcome = useOnboarding((s) => s.openWelcome);
  const start = useOnboarding((s) => s.start);
  const tourId = tourForTab(tab);

  useEffect(() => {
    if (userId && viewer && !readSeen(userId).welcome) openWelcome();
  }, [userId, viewer, openWelcome]);

  useEffect(() => {
    if (!userId || !viewer || welcome || tour || !tourId) return;
    const seen = readSeen(userId);
    if (!seen.welcome || seen.tours?.[tourId]) return;
    const t = setTimeout(() => start(tourId), 900);
    return () => clearTimeout(t);
  }, [userId, viewer, welcome, tour, tourId, start]);

  useEffect(() => {
    if (userId && tour) markSeen(userId, { tours: { [tour]: true } });
  }, [userId, tour]);

  return (
    <>
      {welcome && <Welcome viewer={viewer} />}
      {tour && <TourRunner id={tour} />}
    </>
  );
}

/** The tab bar's way into the tour of whatever is open. */
export function TourButton() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const start = useOnboarding((s) => s.start);
  const id = tourForTab(tab);
  if (!id || !stepsFor(id).length) return null;
  return (
    <button type="button" className="tab-tour" onClick={() => start(id)} title="A short walk through this page">
      <span aria-hidden>✦</span> Tour this page
    </button>
  );
}

/* ---- a section somebody may not open ---- */

/**
 * The section, blurred, behind a note saying it is not available — and what it does.
 *
 * What is blurred is a sketch of the page, never the page: a blur is one line of CSS
 * away from being taken off, so nothing real is drawn underneath it.
 */
export function LockedSection({ section, label }: { section: Section; label: string }) {
  const viewer = useApp((s) => !s.can('creator'));
  const start = useOnboarding((s) => s.start);
  const copy = LOCKED[section];
  return (
    <div className="locked-page">
      <div className="locked-mock" aria-hidden>
        <Mock kind={copy?.mock ?? 'list'} />
      </div>
      <div className="locked-veil">
        <div className="lock-card" data-tour="lock-card" role="note">
          <div className="lock-badge" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <div className="lock-eyebrow">{label}</div>
          <h2>{viewer ? 'This section is not available for viewer access' : 'This section is for admins'}</h2>
          {copy && <p className="lock-msg">{copy.lede}</p>}
          {copy && (
            <div className="lock-what">
              <h3>What happens here</h3>
              <ul>
                {copy.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn small" type="button" onClick={() => start(section)}>
            Tour this section
          </button>
        </div>
      </div>
    </div>
  );
}

function Mock({ kind }: { kind: MockKind }) {
  const lines = (n: number, seed = 0): ReactNode[] =>
    Array.from({ length: n }, (_, i) => (
      <span key={i} className="mock-line" style={{ width: `${52 + ((i * 37 + seed * 17) % 42)}%` }} />
    ));
  if (kind === 'kpis') {
    return (
      <div className="mock-grid">
        <div className="mock-kpis">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mock-card">
              <span className="mock-line" style={{ width: '42%' }} />
              <b className="mock-num" />
            </div>
          ))}
        </div>
        <div className="mock-card">
          <div className="mock-bars">
            {[42, 64, 51, 80, 58, 90, 72, 66, 84, 61, 95, 77].map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <div className="mock-card">{lines(7, 2)}</div>
      </div>
    );
  }
  if (kind === 'rows') {
    return (
      <div className="mock-card">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="mock-row">
            <span className="mock-dot" />
            <span className="mock-stack">{lines(2, i)}</span>
            <span className="mock-chip" />
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'releases') {
    return (
      <div className="mock-card">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="mock-release">
            <span className="mock-line ink" style={{ width: `${34 + ((i * 13) % 30)}%` }} />
            <span className="mock-line" style={{ width: '14%' }} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mock-two">
      <div className="mock-card">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="mock-item">
            {lines(2, i)}
          </div>
        ))}
      </div>
      <div className="mock-card">
        {kind === 'split' && (
          <div className="mock-chips">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="mock-chip" />
            ))}
          </div>
        )}
        {lines(16, 3)}
      </div>
    </div>
  );
}
