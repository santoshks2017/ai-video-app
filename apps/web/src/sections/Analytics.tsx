import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ANALYTICS_DIMENSIONS,
  DATE_PRESETS,
  analyticsTotals,
  attemptsDistribution,
  campaignFacts,
  filterCampaigns,
  formatInr,
  groupCampaigns,
  miscReport,
  modelReport,
  parseRupees,
  presetRange,
  teamReport,
  trendBuckets,
  unassignedRuns,
  type AnalyticsDimension,
  type AnalyticsGroup,
  type AnalyticsTotals,
  type CampaignFact,
  type DatePreset,
  type MiscRow,
  type ModelRow,
  type PackFilter,
  type PackType,
  type PersonRow,
  type RunFact,
  type TrendBucket,
  type TrendUnit,
  type UsageFact,
} from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Panel, Banner, Field } from '../components/ui.js';
import { get, post, isApiError } from '../lib/client.js';

/**
 * Analytics — admin only.
 *
 * What each campaign brought in, what it cost to make and what that left, by
 * dealer, city, state, brand and use case; and behind the money, how the making
 * went: attempts, first-time right, the models and the people. Every figure is
 * worked out by the shared analytics functions; this file only draws them.
 */

/** What repricing every run from its own record came to — before anything is written, and after. */
interface RepriceResult {
  applied: boolean;
  runs: number;
  changed: number;
  beforeInr: number;
  afterInr: number;
  projectsSet: number;
  peopleSet: number;
  byModel: { model: string; runs: number; beforeInr: number; afterInr: number }[];
}

type Report = 'overview' | 'campaigns' | 'geography' | 'usecases' | 'quality' | 'models' | 'team' | 'misc';

const REPORTS: [Report, string][] = [
  ['overview', 'Overview'],
  ['campaigns', 'Campaigns'],
  ['geography', 'Geography'],
  ['usecases', 'Use cases'],
  ['quality', 'Quality'],
  ['models', 'Models'],
  ['team', 'Team'],
  ['misc', 'Misc cost'],
];

const PACKS: [PackFilter, string][] = [
  ['paid', 'Paid only'],
  ['all', 'All packs'],
  ['trial', 'Trial only'],
];

/* ---- formatting ---- */

const inr = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : formatInr(Math.round(n)));
/** Rupees to the paisa below ₹100: most calls to Google cost less than one. */
const inrFine = (n: number): string => (Math.abs(n) < 100 ? `₹${n.toFixed(2)}` : inr(n));
const pct = (n: number | null | undefined, digits = 1): string =>
  n === null || n === undefined ? '—' : `${n.toFixed(digits)}%`;
const num = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toFixed(1);
const r1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

function compactInr(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `${sign}₹${Math.round(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

function span(ms: number | null): string {
  if (ms === null) return '—';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const day = (t: number): string =>
  t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const isoDay = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fromIso = (s: string): number | undefined => {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : undefined;
};
const nextDay = (t: number): number => {
  const d = new Date(t);
  d.setDate(d.getDate() + 1);
  return d.getTime();
};

const statusOf = (c: CampaignFact): string =>
  c.approved ? 'Approved' : c.delivered ? 'Delivered' : c.attempts ? 'Not delivered' : 'Not made';

function downloadCsv(name: string, header: string[], rows: (string | number)[][]): void {
  const cell = (v: string | number): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---- pieces ---- */

const Money = ({ n }: { n: number | null }) => <span className={n !== null && n < 0 ? 'neg' : undefined}>{inr(n)}</span>;

interface Col<T> {
  label: string;
  num?: boolean;
  /** What the column sorts by. */
  value: (r: T) => number | string | null;
  /** What goes in the CSV, when that is not the sort value — a date as a date. */
  csv?: (r: T) => string | number;
  show?: (r: T) => ReactNode;
  foot?: ReactNode;
}

function DataTable<T>({
  rows,
  cols,
  rowKey,
  csvName,
  empty,
}: {
  rows: T[];
  cols: Col<T>[];
  rowKey: (r: T) => string;
  csvName: string;
  empty?: string;
}) {
  const [sort, setSort] = useState<{ i: number; desc: boolean } | null>(null);
  const col = sort ? cols[sort.i] : undefined;
  const sorted =
    sort && col
      ? [...rows].sort((a, b) => {
          const x = col.value(a);
          const y = col.value(b);
          if (x === y) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
          return sort.desc ? -c : c;
        })
      : rows;
  return (
    <>
      <div className="an-toolbar">
        <span className="hint">
          {rows.length} row{rows.length === 1 ? '' : 's'}
          {rows.length > 1 ? ' · click a heading to sort' : ''}
        </span>
        <button
          className="btn ghost small"
          type="button"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              csvName,
              cols.map((c) => c.label),
              sorted.map((r) => cols.map((c) => (c.csv ? c.csv(r) : (c.value(r) ?? '')))),
            )
          }
        >
          Download CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="hint">{empty ?? 'Nothing in this view.'}</div>
      ) : (
        <div className="an-table-wrap">
          <table className="an-table">
            <thead>
              <tr>
                {cols.map((c, i) => (
                  <th
                    key={c.label}
                    className={c.num ? 'num' : undefined}
                    aria-sort={sort?.i === i ? (sort.desc ? 'descending' : 'ascending') : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => setSort((s) => (s && s.i === i ? { i, desc: !s.desc } : { i, desc: Boolean(c.num) }))}
                    >
                      {c.label}
                      {sort?.i === i ? (sort.desc ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={rowKey(r)}>
                  {cols.map((c) => (
                    <td key={c.label} className={c.num ? 'num' : undefined}>
                      {c.show ? c.show(r) : (c.value(r) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {cols.some((c) => c.foot !== undefined) && (
              <tfoot>
                <tr>
                  {cols.map((c) => (
                    <td key={c.label} className={c.num ? 'num' : undefined}>
                      {c.foot ?? ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className={`an-tile${tone ? ` ${tone}` : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

const niceCeil = (v: number): number => {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};

function TrendChart({ buckets }: { buckets: TrendBucket[] }) {
  if (!buckets.length) return <div className="hint">No campaigns in this period.</div>;
  const W = 800;
  const H = 230;
  const L = 58;
  const B = 26;
  const T = 10;
  const top = niceCeil(Math.max(1, ...buckets.map((b) => Math.max(b.totals.revenueInr, b.totals.costInr))));
  const slot = (W - L) / buckets.length;
  const bw = Math.max(1.5, Math.min(18, slot * 0.36));
  const y = (v: number): number => T + (H - T - B) * (1 - Math.max(0, v) / top);
  const every = Math.ceil(buckets.length / 10);
  return (
    <svg className="an-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue and cost by period">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W} y1={y(top * f)} y2={y(top * f)} className="an-grid" />
          <text x={L - 8} y={y(top * f) + 3} className="an-axis" textAnchor="end">
            {compactInr(top * f)}
          </text>
        </g>
      ))}
      {buckets.map((b, i) => {
        const x = L + i * slot + slot / 2;
        return (
          <g key={b.start} className="an-slot">
            <title>
              {`${b.label} — ${b.totals.campaigns} campaign${b.totals.campaigns === 1 ? '' : 's'} · revenue ${inr(b.totals.revenueInr)} · cost ${inr(b.totals.costInr)} · margin ${pct(b.totals.marginPct)}`}
            </title>
            <rect x={L + i * slot} y={T} width={slot} height={H - T - B} className="an-hit" />
            <rect x={x - bw - 1} y={y(b.totals.revenueInr)} width={bw} height={H - B - y(b.totals.revenueInr)} rx={1.5} className="an-rev" />
            <rect x={x + 1} y={y(b.totals.costInr)} width={bw} height={H - B - y(b.totals.costInr)} rx={1.5} className="an-cost" />
            {i % every === 0 && (
              <text x={x} y={H - 8} className="an-axis" textAnchor="middle">
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function groupCols(dimLabel: string, total: AnalyticsTotals): Col<AnalyticsGroup>[] {
  const share = (g: AnalyticsGroup): number | null =>
    total.revenueInr ? r1((g.totals.revenueInr / total.revenueInr) * 100) : null;
  return [
    { label: dimLabel, value: (g) => g.label, foot: 'All' },
    { label: 'Campaigns', num: true, value: (g) => g.totals.campaigns, foot: num(total.campaigns) },
    { label: 'Delivered', num: true, value: (g) => g.totals.delivered, foot: num(total.delivered) },
    { label: 'Attempts', num: true, value: (g) => g.totals.attempts, foot: num(total.attempts) },
    { label: 'Per campaign', num: true, value: (g) => r1(g.totals.attemptsPerCampaign), show: (g) => num(r1(g.totals.attemptsPerCampaign)), foot: num(r1(total.attemptsPerCampaign)) },
    { label: 'First time right', num: true, value: (g) => r1(g.totals.ftrPct), show: (g) => pct(g.totals.ftrPct, 0), foot: pct(total.ftrPct, 0) },
    { label: 'Revenue', num: true, value: (g) => g.totals.revenueInr, show: (g) => inr(g.totals.revenueInr), foot: inr(total.revenueInr) },
    { label: 'Share of revenue', num: true, value: share, show: (g) => pct(share(g), 0), foot: total.revenueInr ? '100%' : '—' },
    { label: 'Cost', num: true, value: (g) => Math.round(g.totals.costInr), show: (g) => inr(g.totals.costInr), foot: inr(total.costInr) },
    { label: 'Gross margin', num: true, value: (g) => Math.round(g.totals.marginInr), show: (g) => <Money n={g.totals.marginInr} />, foot: <Money n={total.marginInr} /> },
    { label: 'Margin %', num: true, value: (g) => r1(g.totals.marginPct), show: (g) => pct(g.totals.marginPct), foot: pct(total.marginPct) },
  ];
}

/**
 * The campaign's revenue, typed in place. Saved when you leave the box or press
 * Enter, onto the project itself; Escape puts back what was there.
 */
function RevenueInput({
  value,
  missing,
  busy,
  name,
  onCommit,
}: {
  value: number | null;
  missing: boolean;
  busy: boolean;
  name: string;
  onCommit: (revenue: number) => void;
}) {
  const shown = value ? value.toLocaleString('en-IN') : '';
  const [text, setText] = useState(shown);
  const commit = (): void => {
    const n = parseRupees(text);
    if (n === undefined && text.trim()) {
      setText(shown);
      return;
    }
    if ((n ?? 0) === (value ?? 0)) {
      setText(shown);
      return;
    }
    onCommit(n ?? 0);
  };
  return (
    <span className={`an-rev-input${missing ? ' needs' : ''}`}>
      <span aria-hidden>₹</span>
      <input
        inputMode="numeric"
        value={text}
        disabled={busy}
        placeholder={missing ? 'Add' : '0'}
        aria-label={`Revenue for ${name}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setText(shown);
        }}
      />
    </span>
  );
}

/* ---- the section ---- */

export function AnalyticsSection() {
  const isAdmin = useApp((s) => s.can('admin'));
  const projects = useApp((s) => s.projects);
  const clients = useApp((s) => s.clients);
  const refresh = useApp((s) => s.refresh);
  const go = useApp((s) => s.go);

  const [runs, setRuns] = useState<RunFact[] | null>(null);
  const [usage, setUsage] = useState<UsageFact[] | null>(null);
  /** Hidden runs are testing and work on the product: left out unless asked for. */
  const [withHidden, setWithHidden] = useState(false);
  const [reprice, setReprice] = useState<RepriceResult | null>(null);
  const [repriceBusy, setRepriceBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [note, setNote] = useState('');
  const [report, setReport] = useState<Report>('overview');
  const [pack, setPack] = useState<PackFilter>('paid');
  const [preset, setPreset] = useState<DatePreset | 'custom'>('all');
  const [customFrom, setCustomFrom] = useState(() => isoDay(Date.now() - 29 * 86_400_000));
  const [customTo, setCustomTo] = useState(() => isoDay(Date.now()));
  const [stateF, setStateF] = useState('');
  const [cityF, setCityF] = useState('');
  const [dealerF, setDealerF] = useState('');
  const [useCaseF, setUseCaseF] = useState('');
  const [unitChoice, setUnitChoice] = useState<TrendUnit | null>(null);
  const [geoDim, setGeoDim] = useState<AnalyticsDimension>('state');
  const [onlyMissing, setOnlyMissing] = useState(false);
  // What was just changed here, shown at once rather than after the round trip.
  const [packOverride, setPackOverride] = useState<Record<string, PackType>>({});
  const [revenueOverride, setRevenueOverride] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoadErr('');
    const [r, u] = await Promise.all([
      get<{ items: RunFact[] }>('/api/analytics/runs'),
      get<{ items: UsageFact[] }>('/api/analytics/usage'),
    ]);
    if (isApiError(r)) setLoadErr(r.message);
    else setRuns(r.items ?? []);
    if (!isApiError(u)) setUsage(u.items ?? []);
  };
  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin]);

  const shownRuns = useMemo(() => (runs ? runs.filter((r) => withHidden || !r.hidden) : null), [runs, withHidden]);
  const facts = useMemo(
    () =>
      shownRuns
        ? campaignFacts(
            projects.map((p) => ({
              ...p,
              ...(packOverride[p.id] ? { packType: packOverride[p.id] } : {}),
              ...(revenueOverride[p.id] !== undefined ? { campaignRevenueInr: revenueOverride[p.id] } : {}),
            })),
            clients,
            shownRuns,
          )
        : [],
    [projects, clients, shownRuns, packOverride, revenueOverride],
  );

  const range = useMemo(() => {
    if (preset !== 'custom') return presetRange(preset);
    const from = fromIso(customFrom);
    const to = fromIso(customTo);
    return { from, to: to === undefined ? undefined : nextDay(to) };
  }, [preset, customFrom, customTo]);

  // The choices in each dropdown narrow with the ones before it.
  const inPack = facts.filter((c) => pack === 'all' || c.pack === pack);
  const uniq = (xs: string[]): string[] => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const states = uniq(inPack.map((c) => c.state));
  const cities = uniq(inPack.filter((c) => !stateF || c.state === stateF).map((c) => c.city));
  const dealers = [
    ...new Map(
      inPack
        .filter((c) => c.clientId && (!stateF || c.state === stateF) && (!cityF || c.city === cityF))
        .map((c) => [c.clientId!, c.dealer]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const useCases = uniq(inPack.map((c) => c.useCase));

  const filtered = filterCampaigns(facts, {
    pack,
    ...range,
    state: stateF || undefined,
    city: cityF || undefined,
    clientId: dealerF || undefined,
    useCase: useCaseF || undefined,
  });
  const totals = analyticsTotals(filtered);

  const spanDays =
    range.from !== undefined && range.to !== undefined
      ? (range.to - range.from) / 86_400_000
      : filtered.length
        ? (Math.max(...filtered.map((c) => c.createdAt)) - Math.min(...filtered.map((c) => c.createdAt))) / 86_400_000
        : 0;
  const unit: TrendUnit = unitChoice ?? (spanDays <= 45 ? 'day' : spanDays <= 200 ? 'week' : 'month');

  const filtersOn = Boolean(stateF || cityF || dealerF || useCaseF || preset !== 'all' || pack !== 'paid' || withHidden);
  const clearFilters = (): void => {
    setPack('paid');
    setWithHidden(false);
    setPreset('all');
    setStateF('');
    setCityF('');
    setDealerF('');
    setUseCaseF('');
  };

  /** Preview repricing every run, or — once the preview has been read — write it. */
  const runReprice = async (apply: boolean): Promise<void> => {
    if (
      apply &&
      !window.confirm(
        'Write the repriced figures onto every run that changes? Each run keeps its old figure beside the new one, and every project’s and person’s totals are set again from their runs.',
      )
    )
      return;
    setRepriceBusy(true);
    const r = await post<RepriceResult>('/api/analytics/reprice', { apply });
    setRepriceBusy(false);
    if (isApiError(r)) {
      setNote(`Could not reprice the runs: ${r.message}`);
      return;
    }
    setReprice(r);
    if (apply) await Promise.all([load(), refresh()]);
  };

  const changePack = async (id: string, to: PackType): Promise<void> => {
    setBusyId(id);
    setPackOverride((o) => ({ ...o, [id]: to }));
    const r = await api.projects.patch(id, { packType: to, updatedAt: Date.now() });
    if (isApiError(r)) {
      setPackOverride((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
      setNote(`Could not change the pack: ${r.message}`);
    } else {
      const name = projects.find((p) => p.id === id)?.name ?? 'The campaign';
      setNote(
        to === 'trial'
          ? `${name} is a trial pack now, and is left out of paid-only figures.`
          : `${name} is a paid pack now, and counts in paid-only figures.`,
      );
      await refresh();
    }
    setBusyId(null);
  };

  const changeRevenue = async (id: string, revenue: number): Promise<void> => {
    setBusyId(id);
    setRevenueOverride((o) => ({ ...o, [id]: revenue }));
    const r = await api.projects.patch(id, { campaignRevenueInr: revenue, updatedAt: Date.now() });
    const name = projects.find((p) => p.id === id)?.name ?? 'The campaign';
    if (isApiError(r)) {
      setRevenueOverride((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
      setNote(`Could not save the revenue for ${name}: ${r.message}`);
    } else {
      setNote(revenue ? `${name}: revenue saved as ${inr(revenue)}, on the project too.` : `${name}: revenue cleared.`);
      await refresh();
    }
    setBusyId(null);
  };

  if (!isAdmin) {
    return (
      <Panel title="Analytics">
        <Banner kind="warn">Analytics is for admins.</Banner>
      </Panel>
    );
  }

  const periodLabel =
    preset === 'all'
      ? 'created at any time'
      : range.from !== undefined && range.to !== undefined
        ? `created ${day(range.from)} – ${day(range.to - 1)}`
        : 'created in the chosen range';

  /* ---- reports ---- */

  /** Revenue less cost. A trial earns nothing, so its margin is what it cost; a paid pack waits for its revenue. */
  const marginOf = (c: CampaignFact): number | null =>
    c.revenueInr !== null ? c.revenueInr - c.costInr : c.pack === 'trial' ? -c.costInr : null;

  const campaignCols: Col<CampaignFact>[] = [
    {
      label: 'Campaign',
      value: (c) => c.name,
      show: (c) => (
        <button type="button" className="an-link" onClick={() => go('projects', c.id)} title="Open this project">
          {c.name}
        </button>
      ),
      foot: `${filtered.length} campaign${filtered.length === 1 ? '' : 's'}`,
    },
    { label: 'Dealer', value: (c) => c.dealer },
    { label: 'City', value: (c) => c.city },
    { label: 'State', value: (c) => c.state },
    { label: 'Use case', value: (c) => c.useCase },
    { label: 'Created', value: (c) => c.createdAt, csv: (c) => isoDay(c.createdAt), show: (c) => day(c.createdAt) },
    {
      label: 'Pack',
      value: (c) => c.pack,
      show: (c) => (
        <div className="seg an-pack" role="group" aria-label={`Pack for ${c.name}`}>
          {(['paid', 'trial'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={c.pack === k ? 'on' : ''}
              disabled={busyId === c.id}
              onClick={() => c.pack !== k && void changePack(c.id, k)}
            >
              {k === 'paid' ? 'Paid' : 'Trial'}
            </button>
          ))}
        </div>
      ),
    },
    {
      label: 'Revenue',
      num: true,
      value: (c) => c.revenueInr,
      show: (c) => (
        <RevenueInput
          key={`${c.id}:${c.revenueInr ?? ''}`}
          value={c.revenueInr}
          missing={c.pack === 'paid' && c.revenueInr === null}
          busy={busyId === c.id}
          name={c.name}
          onCommit={(n) => void changeRevenue(c.id, n)}
        />
      ),
      foot: inr(totals.revenueInr),
    },
    {
      label: 'Attempts',
      num: true,
      value: (c) => c.attempts,
      show: (c) => (c.failedAttempts ? `${c.attempts} (${c.failedAttempts} failed)` : num(c.attempts)),
      foot: num(totals.attempts),
    },
    { label: 'Cost', num: true, value: (c) => Math.round(c.costInr), show: (c) => inr(c.costInr), foot: inr(totals.costInr) },
    {
      label: 'Gross margin',
      num: true,
      value: (c) => {
        const m = marginOf(c);
        return m === null ? null : Math.round(m);
      },
      show: (c) =>
        marginOf(c) === null ? (
          <span className="hint" title="Enter the revenue to see the margin">—</span>
        ) : (
          <Money n={marginOf(c)} />
        ),
      foot: <Money n={totals.marginInr} />,
    },
    {
      label: 'Margin %',
      num: true,
      value: (c) => (c.revenueInr ? r1(((c.revenueInr - c.costInr) / c.revenueInr) * 100) : null),
      show: (c) => pct(c.revenueInr ? ((c.revenueInr - c.costInr) / c.revenueInr) * 100 : null),
      foot: pct(totals.marginPct),
    },
    {
      label: 'Status',
      value: statusOf,
      show: (c) => <span className={`an-status s-${statusOf(c).toLowerCase().replace(/\s+/g, '-')}`}>{statusOf(c)}</span>,
    },
  ];

  const topList = (dimension: AnalyticsDimension, title: string) => {
    const groups = groupCampaigns(filtered, dimension).slice(0, 6);
    return (
      <Panel title={title}>
        {groups.length === 0 ? (
          <div className="hint">Nothing in this view.</div>
        ) : (
          <table className="an-table compact">
            <thead>
              <tr>
                <th>{ANALYTICS_DIMENSIONS[dimension].label}</th>
                <th className="num">Campaigns</th>
                <th className="num">Revenue</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td>
                  <td className="num">{num(g.totals.campaigns)}</td>
                  <td className="num">{inr(g.totals.revenueInr)}</td>
                  <td className="num">{pct(g.totals.marginPct, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    );
  };

  const missingBanner = totals.missingRevenue > 0 && (
    <Banner kind="warn">
      {totals.missingRevenue} paid campaign{totals.missingRevenue === 1 ? ' has' : 's have'} no revenue entered, so
      revenue and margin read low.{' '}
      <button
        type="button"
        className="an-inline"
        onClick={() => {
          setOnlyMissing(true);
          setReport('campaigns');
        }}
      >
        Show {totals.missingRevenue === 1 ? 'it' : 'them'}
      </button>
    </Banner>
  );

  const overview = (
    <>
      <div className="an-ledger" aria-label="Gross margin">
        <div className="term">
          <b>{inr(totals.revenueInr)}</b>
          <span>Revenue</span>
        </div>
        <div className="op" aria-hidden>
          −
        </div>
        <div className="term">
          <b>{inr(totals.costInr)}</b>
          <span>Cost to make</span>
        </div>
        <div className="op" aria-hidden>
          =
        </div>
        <div className={`term margin${totals.marginInr < 0 ? ' neg' : ''}`}>
          <b>{inr(totals.marginInr)}</b>
          <span>Gross margin · {pct(totals.marginPct)}</span>
        </div>
      </div>
      {missingBanner}
      <div className="an-tiles">
        <Tile label="Campaigns" value={num(totals.campaigns)} sub={`${totals.delivered} delivered · ${totals.approved} approved`} />
        <Tile label="Attempts" value={num(totals.attempts)} sub={`${num(r1(totals.attemptsPerCampaign))} per campaign made`} />
        <Tile
          label="First time right"
          value={pct(totals.ftrPct, 0)}
          sub={`${totals.firstTimeRight} of ${totals.delivered} delivered on the first attempt`}
          tone={totals.ftrPct === null ? undefined : totals.ftrPct >= 90 ? 'good' : 'bad'}
        />
        <Tile label="Spent on retries & failures" value={inr(totals.reworkInr)} sub={`${pct(totals.costInr ? (totals.reworkInr / totals.costInr) * 100 : null, 0)} of the cost`} />
        <Tile label="Revenue per campaign" value={inr(totals.avgRevenueInr)} sub="where revenue is entered" />
        <Tile label="Cost per campaign" value={inr(totals.avgCostInr)} sub="where anything was made" />
        <Tile label="Cost per delivered video" value={inr(totals.costPerDeliveredInr)} sub={`${Math.round(totals.secondsGenerated / 60)} min of video made`} />
        <Tile label="Time to first video" value={span(totals.avgTurnaroundMs)} sub="first attempt to first finished video" />
      </div>
      <Panel
        title="Revenue and cost over time"
        note="Each campaign sits in the period it was created, with everything spent making it — however long that took."
        actions={
          <div className="seg quiet">
            {(['day', 'week', 'month'] as const).map((u) => (
              <button key={u} type="button" className={unit === u ? 'on' : ''} onClick={() => setUnitChoice(u)}>
                {u === 'day' ? 'Daily' : u === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        }
      >
        <TrendChart buckets={trendBuckets(filtered, unit, range)} />
        <div className="an-legend">
          <span>
            <i className="rev" />
            Revenue
          </span>
          <span>
            <i className="cost" />
            Cost to make
          </span>
        </div>
      </Panel>
      <div className="an-two">
        {topList('dealer', 'Top dealers')}
        {topList('state', 'Top states')}
      </div>
    </>
  );

  const campaignRows = onlyMissing ? filtered.filter((c) => c.pack === 'paid' && c.revenueInr === null) : filtered;
  const campaigns = (
    <Panel
      title="Campaigns"
      step={`${campaignRows.length}`}
      note="Type a campaign’s revenue or switch it between Paid and Trial here — both are saved onto the project. A trial pack is left out of paid-only figures. Gross margin is revenue less cost; margin % is (revenue − cost) ÷ revenue. Attempts count every generation and retake, failed ones included; cost is what those runs were billed."
    >
      {note && <Banner kind={note.startsWith('Could not') ? 'bad' : 'ok'}>{note}</Banner>}
      <label className="an-check">
        <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        Only paid campaigns with no revenue entered
      </label>
      <DataTable
        rows={campaignRows}
        cols={campaignCols}
        rowKey={(c) => c.id}
        csvName="campaigns"
        empty={onlyMissing ? 'Every paid campaign in this view has its revenue.' : 'No campaigns in this view.'}
      />
    </Panel>
  );

  const geoDims: AnalyticsDimension[] = ['state', 'city', 'dealer', 'brand'];
  const geography = (
    <Panel
      title={`By ${ANALYTICS_DIMENSIONS[geoDim].label.toLowerCase()}`}
      actions={
        <div className="seg quiet">
          {geoDims.map((d) => (
            <button key={d} type="button" className={geoDim === d ? 'on' : ''} onClick={() => setGeoDim(d)}>
              {ANALYTICS_DIMENSIONS[d].label}
            </button>
          ))}
        </div>
      }
    >
      <DataTable
        rows={groupCampaigns(filtered, geoDim)}
        cols={groupCols(ANALYTICS_DIMENSIONS[geoDim].label, totals)}
        rowKey={(g) => g.key}
        csvName={`by-${geoDim}`}
      />
    </Panel>
  );

  const usecases = (
    <Panel title="By use case" note="A campaign is counted under the first use case picked — the one its film leads with — so the rows add up to the total.">
      <DataTable rows={groupCampaigns(filtered, 'useCase')} cols={groupCols('Use case', totals)} rowKey={(g) => g.key} csvName="by-use-case" />
    </Panel>
  );

  const dist = attemptsDistribution(filtered);
  const distMax = Math.max(1, ...dist.map((d) => d.campaigns));
  const retried = filtered.filter((c) => c.attempts > 1);
  const quality = (
    <>
      <div className="an-tiles">
        <Tile
          label="First time right"
          value={pct(totals.ftrPct, 0)}
          sub="target 90% — generation is paid per attempt"
          tone={totals.ftrPct === null ? undefined : totals.ftrPct >= 90 ? 'good' : 'bad'}
        />
        <Tile label="Attempts per campaign" value={num(r1(totals.attemptsPerCampaign))} sub={`${totals.attempts} attempts in all`} />
        <Tile label="Failure rate" value={pct(totals.failurePct, 0)} sub={`${totals.failedAttempts} attempts failed`} />
        <Tile label="Spent on retries & failures" value={inr(totals.reworkInr)} sub={`${pct(totals.costInr ? (totals.reworkInr / totals.costInr) * 100 : null, 0)} of the cost`} />
        <Tile label="Approved by the dealer" value={num(totals.approved)} sub={`of ${totals.delivered} delivered`} />
        <Tile label="Time to first video" value={span(totals.avgTurnaroundMs)} sub="first attempt to first finished video" />
      </div>
      <div className="an-two">
        <Panel title="Attempts it took">
          <div className="an-bars">
            {dist.map((d) => (
              <div className="an-bar" key={d.label}>
                <span>{d.label}</span>
                <div>
                  <i style={{ width: `${(d.campaigns / distMax) * 100}%` }} />
                </div>
                <b>{d.campaigns}</b>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="What the retries cost" note="Every attempt other than the one that first delivered a video: the failures before it and the retakes after it.">
          <table className="an-table compact">
            <tbody>
              <tr>
                <td>Campaigns needing more than one attempt</td>
                <td className="num">{num(retried.length)}</td>
              </tr>
              <tr>
                <td>Extra attempts they took</td>
                <td className="num">{num(retried.reduce((a, c) => a + c.attempts - 1, 0))}</td>
              </tr>
              <tr>
                <td>Spent on those extra attempts</td>
                <td className="num">{inr(totals.reworkInr)}</td>
              </tr>
              <tr>
                <td>Margin it would have added</td>
                <td className="num">{pct(totals.revenueInr ? (totals.reworkInr / totals.revenueInr) * 100 : null)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title="Campaigns that took more than one attempt">
        <DataTable
          rows={retried}
          cols={[
            campaignCols[0]!,
            campaignCols[1]!,
            campaignCols[4]!,
            { label: 'Attempts', num: true, value: (c) => c.attempts },
            { label: 'Failed', num: true, value: (c) => c.failedAttempts },
            { label: 'Cost', num: true, value: (c) => Math.round(c.costInr), show: (c) => inr(c.costInr) },
            { label: 'On retries', num: true, value: (c) => Math.round(c.reworkInr), show: (c) => inr(c.reworkInr) },
            campaignCols[12]!,
          ]}
          rowKey={(c) => c.id}
          csvName="retried-campaigns"
          empty="Every campaign in this view was made in one attempt, or not yet made."
        />
      </Panel>
    </>
  );

  const modelCols: Col<ModelRow>[] = [
    { label: 'Model', value: (m) => m.label },
    { label: 'Attempts', num: true, value: (m) => m.runs },
    { label: 'Done', num: true, value: (m) => m.done },
    { label: 'Failed', num: true, value: (m) => m.failed },
    { label: 'Stopped', num: true, value: (m) => m.cancelled },
    { label: 'Success', num: true, value: (m) => r1(m.successPct), show: (m) => pct(m.successPct, 0) },
    { label: 'Cost', num: true, value: (m) => Math.round(m.costInr), show: (m) => inr(m.costInr) },
    { label: 'Share of cost', num: true, value: (m) => r1(m.shareOfCostPct), show: (m) => pct(m.shareOfCostPct, 0) },
    { label: 'Video made', num: true, value: (m) => m.seconds, show: (m) => `${Math.round(m.seconds)}s` },
    { label: '₹ per second', num: true, value: (m) => r1(m.inrPerSecond), show: (m) => (m.inrPerSecond === null ? '—' : `₹${m.inrPerSecond.toFixed(1)}`) },
    { label: 'Render time', num: true, value: (m) => m.avgRenderMs, show: (m) => span(m.avgRenderMs) },
  ];
  const models = (
    <Panel title="By model" note="The campaigns in this view, by the model each attempt was made on. Success is done out of the attempts that finished one way or another.">
      <DataTable rows={modelReport(filtered)} cols={modelCols} rowKey={(m) => m.key} csvName="by-model" empty="No attempts in this view." />
    </Panel>
  );

  const personCols: Col<PersonRow>[] = [
    { label: 'Person', value: (p) => p.label },
    { label: 'Campaigns', num: true, value: (p) => p.campaigns },
    { label: 'Attempts', num: true, value: (p) => p.runs },
    { label: 'Done', num: true, value: (p) => p.done },
    { label: 'Failed', num: true, value: (p) => p.failed },
    { label: 'Retakes', num: true, value: (p) => p.retakes },
    { label: 'Success', num: true, value: (p) => r1(p.successPct), show: (p) => pct(p.successPct, 0) },
    { label: 'Cost', num: true, value: (p) => Math.round(p.costInr), show: (p) => inr(p.costInr) },
    { label: 'Per attempt', num: true, value: (p) => (p.runs ? Math.round(p.costInr / p.runs) : null), show: (p) => inr(p.runs ? p.costInr / p.runs : null) },
  ];
  const team = (
    <Panel title="By person" note="Who ran the attempts behind the campaigns in this view, and what they cost.">
      <DataTable rows={teamReport(filtered)} cols={personCols} rowKey={(p) => p.key} csvName="by-person" empty="No attempts in this view." />
    </Panel>
  );

  const misc = miscReport(usage ?? [], shownRuns ? unassignedRuns(projects, shownRuns) : [], range);
  const miscCols: Col<MiscRow>[] = [
    { label: 'Where', value: (r) => r.label, foot: `${misc.rows.length} source${misc.rows.length === 1 ? '' : 's'}` },
    { label: 'Calls', num: true, value: (r) => r.calls, show: (r) => num(r.calls), foot: num(misc.calls) },
    { label: 'Cost', num: true, value: (r) => r.costInr, show: (r) => inrFine(r.costInr), foot: inrFine(misc.totalInr) },
  ];
  const miscBody = (
    <Panel
      title="Misc cost"
      step={inrFine(misc.totalInr)}
      note={
        <>
          Spent on Google outside any campaign, in the period chosen: reading briefs, writing scripts, drawing
          storyboard scenes and actor sheets, importing clients and vehicles, filing photographs, checking the
          vehicle in each part, and music — each call costed from the tokens it used — and videos that belong to no
          project. None of it is in a campaign’s cost or margin, and the pack, place and use-case filters do not
          apply. Calls are counted from 15 September 2026, when they began to be recorded.
        </>
      }
    >
      <DataTable
        rows={misc.rows}
        cols={miscCols}
        rowKey={(r) => r.key}
        csvName="misc-cost"
        empty="Nothing spent outside a campaign in this period."
      />
    </Panel>
  );

  const body: Record<Report, ReactNode> = { overview, campaigns, geography, usecases, quality, models, team, misc: miscBody };

  return (
    <>
      <Panel
        title="Analytics"
        step={runs ? `${totals.campaigns} campaign${totals.campaigns === 1 ? '' : 's'}` : undefined}
        note={
          <>
            Revenue is what is entered on each project. Cost is what every generation run for it was billed, at
            the resolution it rendered — failed runs, retakes and parts made again for the wrong vehicle included.
            Runs an admin has hidden are testing and work on the product, and are left out unless Hidden runs is
            set to Counted. Everything else spent on Google is under Misc cost, in no campaign. Dates are when a
            campaign was created.
          </>
        }
        actions={
          <>
            <button
              className="btn ghost small"
              type="button"
              disabled={repriceBusy}
              title="Work every run's cost out again from what it rendered, at today's prices — shown first, written only if you apply it"
              onClick={() => void runReprice(false)}
            >
              {repriceBusy && !reprice ? 'Reading every run…' : 'Reprice past runs'}
            </button>
            <button className="btn ghost small" type="button" onClick={() => void Promise.all([load(), refresh()])}>
              Refresh
            </button>
          </>
        }
      >
        <div className="an-filters">
          <Field label="Packs">
            <div className="seg">
              {PACKS.map(([k, label]) => (
                <button key={k} type="button" className={pack === k ? 'on' : ''} onClick={() => setPack(k)}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Hidden runs">
            <div className="seg">
              <button type="button" className={withHidden ? '' : 'on'} onClick={() => setWithHidden(false)}>
                Left out
              </button>
              <button type="button" className={withHidden ? 'on' : ''} onClick={() => setWithHidden(true)}>
                Counted
              </button>
            </div>
          </Field>
          <Field label="Period">
            <select value={preset} onChange={(e) => setPreset(e.target.value as DatePreset | 'custom')}>
              {DATE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Date range…</option>
            </select>
          </Field>
          {preset === 'custom' && (
            <>
              <Field label="From">
                <input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
              </Field>
            </>
          )}
          <Field label="State">
            <select
              value={stateF}
              onChange={(e) => {
                setStateF(e.target.value);
                setCityF('');
                setDealerF('');
              }}
            >
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="City">
            <select
              value={cityF}
              onChange={(e) => {
                setCityF(e.target.value);
                setDealerF('');
              }}
            >
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Dealer">
            <select value={dealerF} onChange={(e) => setDealerF(e.target.value)}>
              <option value="">All dealers</option>
              {dealers.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Use case">
            <select value={useCaseF} onChange={(e) => setUseCaseF(e.target.value)}>
              <option value="">All use cases</option>
              {useCases.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </Field>
          {filtersOn && (
            <button className="btn ghost small an-clear" type="button" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <div className="an-summary">
          {runs
            ? `${totals.campaigns} campaign${totals.campaigns === 1 ? '' : 's'} · ${PACKS.find(([k]) => k === pack)![1].toLowerCase()} · ${periodLabel}`
            : loadErr
              ? ''
              : 'Reading every run…'}
        </div>
        <div className="seg an-reports" role="tablist" aria-label="Reports">
          {REPORTS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={report === id}
              className={report === id ? 'on' : ''}
              onClick={() => setReport(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </Panel>
      {loadErr && <Banner kind="bad">Could not read the runs: {loadErr}</Banner>}
      {reprice && (
        <Panel
          title={reprice.applied ? 'Past runs repriced' : 'Repricing past runs — preview'}
          step={`${reprice.changed} of ${reprice.runs} runs ${reprice.applied ? 'changed' : 'change'}`}
          note="Every run worked out again from its own record: the resolution it rendered at, the seconds its model bills, parts made again for the wrong vehicle, and what Omni was sent. Nothing is written until Apply; applied, each run keeps its old figure beside the new one."
          actions={
            <>
              {!reprice.applied && reprice.changed > 0 && (
                <button className="btn primary small" type="button" disabled={repriceBusy} onClick={() => void runReprice(true)}>
                  {repriceBusy ? 'Writing…' : 'Apply'}
                </button>
              )}
              <button className="btn ghost small" type="button" onClick={() => setReprice(null)}>
                Close
              </button>
            </>
          }
        >
          <div className="an-summary">
            Runs that are counted: {inr(reprice.beforeInr)} before, {inr(reprice.afterInr)} after
            {reprice.applied ? ` · ${reprice.projectsSet} project and ${reprice.peopleSet} person totals set again` : ''}.
          </div>
          <table className="an-table compact">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Runs</th>
                <th className="num">Before</th>
                <th className="num">After</th>
              </tr>
            </thead>
            <tbody>
              {reprice.byModel.map((m) => (
                <tr key={m.model}>
                  <td>{m.model}</td>
                  <td className="num">{num(m.runs)}</td>
                  <td className="num">{inr(m.beforeInr)}</td>
                  <td className="num">{inr(m.afterInr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {runs && body[report]}
    </>
  );
}
