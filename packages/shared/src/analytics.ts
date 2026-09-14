/**
 * The business side of the app: what each campaign brought in, what making it
 * cost, and what that says about the product.
 *
 * Revenue is typed onto the project. Cost is what every generation run for it was
 * billed — failed runs and retakes included, because that is money spent getting
 * the campaign made. Everything here is a pure function over lists the app already
 * holds (projects, clients and runs), so every figure on the screen is worked out
 * in one place and can be tested; the screen only draws them.
 */
import type { ClientProfile, PackType, Project } from './library.js';
import { CATEGORY_BY_ID } from './categories.js';

/** One generation run, reduced to what Analytics reads. Hidden runs never get this far. */
export interface RunFact {
  jobId: string;
  projectId?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  kind?: 'generate' | 'retake' | 'restitch' | 'enhance' | 'upscale' | 'edit';
  approved?: boolean;
  costInr: number;
  totalSeconds?: number;
  modelId?: string;
  modelName?: string;
  userEmail?: string;
  userName?: string;
}

export const packOf = (p: Pick<Project, 'packType'>): PackType => p.packType ?? 'paid';

/** A paid pack with no revenue on it — the one thing that stops it being generated. */
export function revenueMissing(p: Pick<Project, 'packType' | 'campaignRevenueInr'>): boolean {
  return packOf(p) === 'paid' && !((p.campaignRevenueInr ?? 0) > 0);
}

/** Rupees as people type them: "25000", "25,000", "₹ 25,000". Blank or unreadable is undefined. */
export function parseRupees(text: string): number | undefined {
  const cleaned = text.replace(/[₹,\s]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** A paid attempt at the film itself, as opposed to re-joining or re-grading one already made. */
const isAttempt = (r: RunFact): boolean => !r.kind || r.kind === 'generate' || r.kind === 'retake';
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const CATEGORY_LABELS = CATEGORY_BY_ID as Record<string, { label: string } | undefined>;

export interface CampaignFact {
  id: string;
  name: string;
  createdAt: number;
  pack: PackType;
  /** Null when none has been entered. */
  revenueInr: number | null;
  clientId?: string;
  dealer: string;
  city: string;
  state: string;
  brand: string;
  /** The first use case picked — the one the film leads with. */
  useCase: string;
  runs: RunFact[];
  /** Every generation and retake, failed and stopped ones included. */
  attempts: number;
  failedAttempts: number;
  costInr: number;
  /** Spent on attempts other than the one that first delivered a video: the failures, and the retries after it. */
  reworkInr: number;
  delivered: boolean;
  approved: boolean;
  /** Delivered by its first attempt, with no other attempt made. */
  firstTimeRight: boolean;
  deliveredAt?: number;
  /** From the first attempt starting to the first video finishing. */
  turnaroundMs?: number;
  secondsGenerated: number;
}

export function campaignFacts(projects: Project[], clients: ClientProfile[], runs: RunFact[]): CampaignFact[] {
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const byProject = new Map<string, RunFact[]>();
  for (const r of runs) {
    if (!r.projectId) continue;
    const list = byProject.get(r.projectId) ?? [];
    list.push(r);
    byProject.set(r.projectId, list);
  }
  return projects.map((p) => {
    const client = p.clientId ? clientById.get(p.clientId) : undefined;
    const mine = [...(byProject.get(p.id) ?? [])].sort((a, b) => a.createdAt - b.createdAt);
    const attempts = mine.filter(isAttempt);
    const first = attempts[0];
    const firstDone = attempts.find((r) => r.status === 'done');
    const lead = p.useCases?.[0];
    return {
      id: p.id,
      name: p.name || 'Untitled project',
      createdAt: p.createdAt || first?.createdAt || 0,
      pack: packOf(p),
      revenueInr: (p.campaignRevenueInr ?? 0) > 0 ? p.campaignRevenueInr! : null,
      clientId: client?.id,
      dealer: client ? client.displayName?.trim() || client.name : 'No client',
      city: client?.city?.trim() || 'City not set',
      state: client?.state?.trim() || 'State not set',
      brand: client?.brand?.trim() || 'Brand not set',
      useCase: lead ? (CATEGORY_LABELS[lead]?.label ?? lead) : 'No use case',
      runs: mine,
      attempts: attempts.length,
      failedAttempts: attempts.filter((r) => r.status === 'failed').length,
      costInr: sum(mine.map((r) => r.costInr || 0)),
      reworkInr: sum(attempts.map((r) => r.costInr || 0)) - (firstDone?.costInr ?? 0),
      delivered: Boolean(firstDone),
      approved: mine.some((r) => r.approved),
      firstTimeRight: Boolean(firstDone) && attempts.length === 1,
      deliveredAt: firstDone ? (firstDone.finishedAt ?? firstDone.createdAt) : undefined,
      // Only where the finish was recorded: older runs have none, and reading their
      // start as their finish pulled the average towards zero.
      turnaroundMs:
        firstDone?.finishedAt && first
          ? Math.max(0, firstDone.finishedAt - (first.startedAt ?? first.createdAt))
          : undefined,
      secondsGenerated: sum(attempts.filter((r) => r.status === 'done').map((r) => r.totalSeconds ?? 0)),
    };
  });
}

/* ---- narrowing it down ---- */

export type PackFilter = 'paid' | 'trial' | 'all';

export interface AnalyticsFilter {
  pack: PackFilter;
  /** Campaigns created at or after this moment… */
  from?: number;
  /** …and before this one. */
  to?: number;
  state?: string;
  city?: string;
  clientId?: string;
  useCase?: string;
}

export function filterCampaigns(rows: CampaignFact[], f: AnalyticsFilter): CampaignFact[] {
  return rows.filter(
    (c) =>
      (f.pack === 'all' || c.pack === f.pack) &&
      (f.from === undefined || c.createdAt >= f.from) &&
      (f.to === undefined || c.createdAt < f.to) &&
      (!f.state || c.state === f.state) &&
      (!f.city || c.city === f.city) &&
      (!f.clientId || c.clientId === f.clientId) &&
      (!f.useCase || c.useCase === f.useCase),
  );
}

/* ---- the numbers ---- */

export interface AnalyticsTotals {
  campaigns: number;
  revenueInr: number;
  costInr: number;
  marginInr: number;
  /** Gross margin as a share of revenue, 0–100. Null with no revenue to take it from. */
  marginPct: number | null;
  attempts: number;
  failedAttempts: number;
  /** Failed attempts as a share of all attempts, 0–100. */
  failurePct: number | null;
  delivered: number;
  approved: number;
  firstTimeRight: number;
  /** Campaigns delivered by their first attempt, as a share of those delivered. */
  ftrPct: number | null;
  reworkInr: number;
  /** Paid packs with no revenue entered — the margin reads low until they have one. */
  missingRevenue: number;
  secondsGenerated: number;
  /** Over the campaigns that have revenue entered. */
  avgRevenueInr: number | null;
  /** Over the campaigns that have been attempted at all. */
  avgCostInr: number | null;
  attemptsPerCampaign: number | null;
  costPerDeliveredInr: number | null;
  avgTurnaroundMs: number | null;
}

export function analyticsTotals(rows: CampaignFact[]): AnalyticsTotals {
  const revenue = sum(rows.map((c) => c.revenueInr ?? 0));
  const cost = sum(rows.map((c) => c.costInr));
  const attempts = sum(rows.map((c) => c.attempts));
  const failed = sum(rows.map((c) => c.failedAttempts));
  const made = rows.filter((c) => c.attempts > 0).length;
  const delivered = rows.filter((c) => c.delivered).length;
  const ftr = rows.filter((c) => c.firstTimeRight).length;
  const withRevenue = rows.filter((c) => c.revenueInr !== null).length;
  const turnarounds = rows.flatMap((c) => (c.turnaroundMs === undefined ? [] : [c.turnaroundMs]));
  const per = (a: number, b: number): number | null => (b > 0 ? a / b : null);
  return {
    campaigns: rows.length,
    revenueInr: revenue,
    costInr: cost,
    marginInr: revenue - cost,
    marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
    attempts,
    failedAttempts: failed,
    failurePct: attempts ? (failed / attempts) * 100 : null,
    delivered,
    approved: rows.filter((c) => c.approved).length,
    firstTimeRight: ftr,
    ftrPct: delivered ? (ftr / delivered) * 100 : null,
    reworkInr: sum(rows.map((c) => c.reworkInr)),
    missingRevenue: rows.filter((c) => c.pack === 'paid' && c.revenueInr === null).length,
    secondsGenerated: sum(rows.map((c) => c.secondsGenerated)),
    avgRevenueInr: per(revenue, withRevenue),
    avgCostInr: per(cost, made),
    attemptsPerCampaign: per(attempts, made),
    costPerDeliveredInr: per(cost, delivered),
    avgTurnaroundMs: turnarounds.length ? sum(turnarounds) / turnarounds.length : null,
  };
}

export interface AnalyticsGroup {
  key: string;
  label: string;
  totals: AnalyticsTotals;
}

export type AnalyticsDimension = 'state' | 'city' | 'dealer' | 'brand' | 'useCase';

export const ANALYTICS_DIMENSIONS: Record<
  AnalyticsDimension,
  { label: string; of: (c: CampaignFact) => { key: string; label: string } }
> = {
  state: { label: 'State', of: (c) => ({ key: c.state, label: c.state }) },
  city: { label: 'City', of: (c) => ({ key: `${c.city}|${c.state}`, label: `${c.city}, ${c.state}` }) },
  dealer: { label: 'Dealer', of: (c) => ({ key: c.clientId ?? '—', label: c.dealer }) },
  brand: { label: 'Brand', of: (c) => ({ key: c.brand, label: c.brand }) },
  useCase: { label: 'Use case', of: (c) => ({ key: c.useCase, label: c.useCase }) },
};

/** Campaigns gathered by dealer, city, state, brand or use case — biggest earners first. */
export function groupCampaigns(rows: CampaignFact[], dimension: AnalyticsDimension): AnalyticsGroup[] {
  const groups = new Map<string, { label: string; rows: CampaignFact[] }>();
  for (const c of rows) {
    const { key, label } = ANALYTICS_DIMENSIONS[dimension].of(c);
    const g = groups.get(key) ?? { label, rows: [] };
    g.rows.push(c);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, totals: analyticsTotals(g.rows) }))
    .sort(
      (a, b) =>
        b.totals.revenueInr - a.totals.revenueInr ||
        b.totals.campaigns - a.totals.campaigns ||
        a.label.localeCompare(b.label),
    );
}

/** How many attempts campaigns took to make — the shape behind first-time right. */
export function attemptsDistribution(rows: CampaignFact[]): { label: string; campaigns: number }[] {
  const buckets = [
    { label: 'Not made yet', campaigns: 0 },
    { label: '1 attempt', campaigns: 0 },
    { label: '2 attempts', campaigns: 0 },
    { label: '3 attempts', campaigns: 0 },
    { label: '4 or more', campaigns: 0 },
  ];
  for (const c of rows) buckets[Math.min(4, c.attempts)]!.campaigns++;
  return buckets;
}

/* ---- by model and by person: the runs behind the campaigns ---- */

export interface ModelRow {
  key: string;
  label: string;
  runs: number;
  done: number;
  failed: number;
  cancelled: number;
  /** Done as a share of the runs that finished one way or another. */
  successPct: number | null;
  costInr: number;
  shareOfCostPct: number | null;
  seconds: number;
  inrPerSecond: number | null;
  avgRenderMs: number | null;
}

export function modelReport(rows: CampaignFact[]): ModelRow[] {
  const runs = rows.flatMap((c) => c.runs.filter(isAttempt));
  const total = sum(runs.map((r) => r.costInr || 0));
  const groups = new Map<string, RunFact[]>();
  // By name: the same model has been saved under more than one id, and to the people
  // reading this it is one model.
  for (const r of runs) {
    const key = r.modelName || r.modelId || 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const done = rs.filter((r) => r.status === 'done');
      const failed = rs.filter((r) => r.status === 'failed').length;
      const cancelled = rs.filter((r) => r.status === 'cancelled').length;
      const cost = sum(rs.map((r) => r.costInr || 0));
      const seconds = sum(done.map((r) => r.totalSeconds ?? 0));
      const renders = done.flatMap((r) => (r.startedAt && r.finishedAt ? [r.finishedAt - r.startedAt] : []));
      const finished = done.length + failed + cancelled;
      return {
        key,
        label: rs.find((r) => r.modelName)?.modelName || key,
        runs: rs.length,
        done: done.length,
        failed,
        cancelled,
        successPct: finished ? (done.length / finished) * 100 : null,
        costInr: cost,
        shareOfCostPct: total > 0 ? (cost / total) * 100 : null,
        seconds,
        inrPerSecond: seconds > 0 ? cost / seconds : null,
        avgRenderMs: renders.length ? sum(renders) / renders.length : null,
      };
    })
    .sort((a, b) => b.costInr - a.costInr || b.runs - a.runs);
}

export interface PersonRow {
  key: string;
  label: string;
  runs: number;
  campaigns: number;
  done: number;
  failed: number;
  retakes: number;
  successPct: number | null;
  costInr: number;
}

export function teamReport(rows: CampaignFact[]): PersonRow[] {
  const groups = new Map<string, { label: string; runs: RunFact[]; campaigns: Set<string> }>();
  for (const c of rows) {
    for (const r of c.runs.filter(isAttempt)) {
      const key = r.userEmail || r.userName || 'unknown';
      const g = groups.get(key) ?? { label: r.userName || r.userEmail || 'Not recorded', runs: [], campaigns: new Set<string>() };
      g.runs.push(r);
      g.campaigns.add(c.id);
      groups.set(key, g);
    }
  }
  // One person can hold two accounts under one name; the address tells them apart.
  const names = [...groups.values()].map((g) => g.label);
  return [...groups.entries()]
    .map(([key, g]) => {
      if (key !== 'unknown' && names.filter((n) => n === g.label).length > 1 && key !== g.label) g.label = `${g.label} (${key})`;
      const done = g.runs.filter((r) => r.status === 'done').length;
      const failed = g.runs.filter((r) => r.status === 'failed').length;
      const cancelled = g.runs.filter((r) => r.status === 'cancelled').length;
      return {
        key,
        label: g.label,
        runs: g.runs.length,
        campaigns: g.campaigns.size,
        done,
        failed,
        retakes: g.runs.filter((r) => r.kind === 'retake').length,
        successPct: done + failed + cancelled ? (done / (done + failed + cancelled)) * 100 : null,
        costInr: sum(g.runs.map((r) => r.costInr || 0)),
      };
    })
    .sort((a, b) => b.costInr - a.costInr || b.runs - a.runs);
}

/* ---- time ---- */

export type DatePreset = 'today' | 'week' | 'month' | 'last-month' | '30d' | '90d' | 'year' | 'all';

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

const startOfDay = (t: number): number => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** Calendar days, not 24-hour steps, so a clock change never shifts a boundary. */
const addDays = (t: number, n: number): number => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
/** Weeks start on Monday. */
const startOfWeek = (t: number): number => {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};
const startOfMonth = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};
const addMonths = (t: number, n: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
};

/** A preset as a range: `from` inclusive, `to` exclusive, in the viewer's own time zone. */
export function presetRange(preset: DatePreset, now = Date.now()): { from?: number; to?: number } {
  const today = startOfDay(now);
  switch (preset) {
    case 'today':
      return { from: today, to: addDays(today, 1) };
    case 'week': {
      const w = startOfWeek(now);
      return { from: w, to: addDays(w, 7) };
    }
    case 'month':
      return { from: startOfMonth(now), to: addMonths(now, 1) };
    case 'last-month':
      return { from: addMonths(now, -1), to: startOfMonth(now) };
    case '30d':
      return { from: addDays(today, -29), to: addDays(today, 1) };
    case '90d':
      return { from: addDays(today, -89), to: addDays(today, 1) };
    case 'year': {
      const y = new Date(now).getFullYear();
      return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() };
    }
    default:
      return {};
  }
}

export type TrendUnit = 'day' | 'week' | 'month';

export interface TrendBucket {
  start: number;
  end: number;
  label: string;
  totals: AnalyticsTotals;
}

const bucketOf = (t: number, unit: TrendUnit): number =>
  unit === 'day' ? startOfDay(t) : unit === 'week' ? startOfWeek(t) : startOfMonth(t);
const nextBucket = (t: number, unit: TrendUnit): number =>
  unit === 'day' ? addDays(t, 1) : unit === 'week' ? addDays(t, 7) : addMonths(t, 1);

/**
 * Campaigns by the day, week or month they were created, every bucket in the range
 * present even when empty — a gap is information. Stops at the bucket holding
 * today, so "this year" is not drawn out to December, and at 370 buckets.
 */
export function trendBuckets(
  rows: CampaignFact[],
  unit: TrendUnit,
  range: { from?: number; to?: number } = {},
  now = Date.now(),
): TrendBucket[] {
  const times = rows.map((c) => c.createdAt).filter((t) => t > 0);
  if (!times.length && range.from === undefined) return [];
  const first = bucketOf(range.from ?? Math.min(...times), unit);
  const last = Math.min(range.to ?? Number.POSITIVE_INFINITY, nextBucket(bucketOf(now, unit), unit), times.length ? Math.max(nextBucket(bucketOf(Math.max(...times), unit), unit), range.to ?? 0) : range.to ?? 0);
  const out: TrendBucket[] = [];
  for (let b = first; b < last && out.length < 370; b = nextBucket(b, unit)) {
    const end = nextBucket(b, unit);
    const d = new Date(b);
    const label =
      unit === 'month'
        ? d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        : `${unit === 'week' ? 'w/c ' : ''}${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
    out.push({ start: b, end, label, totals: analyticsTotals(rows.filter((c) => c.createdAt >= b && c.createdAt < end)) });
  }
  return out;
}
