// lib/model.ts — the token-radar model: snapshot parsing, the comparable-multiple valuation,
// board construction, farm plans, and the radar payload the dashboard renders.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface RadarModel {
  comp_default: number;
  comp_min: number;
  comp_max: number;
  comp_min_sample: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

/**
 * The valuation constants: comp_* govern the comparable multiple (median market-cap/TVL per
 * category, clamped, with a minimum sample), growth_* the 7-day term, maturity_* the age term,
 * and unknown_age_days the age assumed when no listing date exists.
 */
export const MODEL: RadarModel = {
  comp_default: 0.35,
  comp_min: 0.15,
  comp_max: 6,
  comp_min_sample: 3,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.7,
  maturity_range: 0.6,
  maturity_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-1';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------- parsing

type RawRecord = { [key: string]: unknown };

/** A non-empty string, else null. */
function text(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** A finite number, else null. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/** Milliseconds at UTC midnight for a YYYY-MM-DD string, else null. */
function dayMs(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(date + 'T00:00:00Z');
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Parse and validate a snapshot document, coercing each protocol's fields to null when absent or
 * non-finite; a '-' symbol means no symbol. tvl_usd is the one field the arithmetic cannot survive
 * as null, so a missing TVL is coerced to 0 — such a protocol still prices, at the floor of the model.
 */
export function parseSnapshot(raw: string): Snapshot {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new SnapshotError(`snapshot is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new SnapshotError('snapshot must be a JSON object');
  }
  const o = data as RawRecord;
  const as_of = String(o.as_of);
  if (dayMs(as_of) === null) {
    throw new SnapshotError(`snapshot as_of must be a YYYY-MM-DD date, got ${JSON.stringify(o.as_of)}`);
  }
  const source = text(o.source);
  if (!source) throw new SnapshotError('snapshot source must be a non-empty string');
  const floor_usd = num(o.floor_usd);
  if (floor_usd === null || !Number.isSafeInteger(floor_usd) || floor_usd <= 0) {
    throw new SnapshotError(`snapshot floor_usd must be a positive safe integer, got ${JSON.stringify(o.floor_usd)}`);
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot protocols must be an array');
  if (!Array.isArray(o.watchlist) || !(o.watchlist as unknown[]).every((s) => typeof s === 'string')) {
    throw new SnapshotError('snapshot watchlist must be an array of strings');
  }
  const protocols = (o.protocols as unknown[]).map((p, i): SnapshotProtocol => {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      throw new SnapshotError(`protocol #${i} must be an object`);
    }
    const r = p as RawRecord;
    const slug = text(r.slug);
    if (!slug) throw new SnapshotError(`protocol #${i} is missing a slug`);
    const name = text(r.name);
    if (!name) throw new SnapshotError(`protocol #${i} (${slug}) is missing a name`);
    const symbol = text(r.symbol);
    return {
      slug,
      name,
      category: text(r.category),
      chains: strArray(r.chains),
      tvl_usd: num(r.tvl_usd) ?? 0,
      change_7d: num(r.change_7d),
      mcap_usd: num(r.mcap_usd),
      listed_at: text(r.listed_at),
      gecko_id: text(r.gecko_id),
      symbol: symbol === '-' ? null : symbol,
    };
  });
  return { as_of, source, floor_usd, protocols, watchlist: o.watchlist as string[] };
}

// ---------------------------------------------------------------- model pieces

/** Whole UTC days between the snapshot date and a token's listing date; null when the listing is absent or unparseable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  const end = dayMs(asOf);
  const start = listedAt === null ? null : dayMs(listedAt);
  if (end === null || start === null) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export interface Comparable {
  multiple: number;
  sample: number;
}

/** Median market-cap/TVL per category over live-token protocols, clamped; thin categories fall back to the default multiple. */
export function categoryMultiples(snapshot: Snapshot, model: RadarModel): Map<string, Comparable> {
  const ratios = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || p.category === null) continue;
    const list = ratios.get(p.category);
    if (list) list.push(p.mcap_usd / p.tvl_usd);
    else ratios.set(p.category, [p.mcap_usd / p.tvl_usd]);
  }
  const out = new Map<string, Comparable>();
  for (const [category, list] of ratios) {
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const multiple = sorted.length < model.comp_min_sample
      ? model.comp_default
      : Math.min(model.comp_max, Math.max(model.comp_min, median));
    out.set(category, { multiple, sample: list.length });
  }
  return out;
}

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the early radar may rank: pre-token, not a CEX, and not a version-suffixed spin-off of an existing product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSION_MARKER.test(p.name);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

export interface Valuation {
  implied_value_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  comp_mult: number;
  comp_sample: number | null;
  age: number;
}

/**
 * implied = max(1, round(tvl_usd x comparable x growthMult x maturityMult)). The two multipliers
 * are rounded to 4 decimals BEFORE the product so the board value is reproducible from the row
 * alone: the dashboard recomputes exactly this product and reports that it matches board.json.
 */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: RadarModel, multiples: Map<string, Comparable>): Valuation {
  const growth_pct = p.change_7d === null ? 0 : clamp(p.change_7d, model.growth_floor, model.growth_cap);
  const growth_multiplier = round4(1 + (growth_pct / 100) * model.growth_weight);
  const listed = ageDays(asOf, p.listed_at);
  const age = listed ?? model.unknown_age_days;
  const maturity_multiplier = round4(model.maturity_floor + (clamp(age, 0, model.maturity_days) / model.maturity_days) * model.maturity_range);
  const entry = p.category === null ? undefined : multiples.get(p.category);
  const comp_mult = entry ? entry.multiple : model.comp_default;
  const comp_sample = entry ? entry.sample : null;
  const implied_value_usd = Math.max(1, Math.round(Math.max(0, p.tvl_usd) * comp_mult * growth_multiplier * maturity_multiplier));
  return { implied_value_usd, growth_pct, growth_multiplier, maturity_multiplier, comp_mult, comp_sample, age };
}

// ---------------------------------------------------------------- farm plans

function capitalFor(tvl: number): number {
  if (tvl >= 5e9) return 250;
  if (tvl >= 1e9) return 150;
  if (tvl >= 1e8) return 100;
  return 50;
}

function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category decides the main action; the chain and every cost come from the same record. */
function categoryAction(category: string | null, name: string, chain: string): string {
  const c = (category ?? '').toLowerCase();
  const act = (verb: string): string => `${verb} on ${name} via ${chain}`;
  if (/lending|cdp|borrow/.test(c)) return act('Supply USDC into a lending market');
  if (/perpetual|perp|derivative|margin/.test(c)) return act('Open a small, hedged margin position');
  if (/prediction|forecast/.test(c)) return act('Fund a position on a live prediction market');
  if (/insurance|cover/.test(c)) return act('Buy cover for a top deposit');
  if (/bridge/.test(c)) return act('Bridge USDC across and keep the receipt token');
  if (/stak/.test(c)) return act('Stake the deposited asset');
  if (/vault|curator/.test(c)) return act('Deposit USDC into a managed vault');
  if (/stable|rwa|treasury|real.world/.test(c)) return act('Mint a stablecoin or tokenized RWA share');
  if (/dex|swap|amm|liquidity|yield/.test(c)) return act('Provide a two-sided liquidity deposit');
  return act('Deposit USDC into the main product');
}

/**
 * Six steps, each 'ACTION Cost: <cost>. Time: <time>.' (20..600 characters trimmed). Capital scales
 * with TVL, the hold window with age, gas with the ticket size; nothing outside the record is used.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const gas = capital >= 150 ? 8 : 4;
  const hold = holdFor(age);
  const action = categoryAction(p.category, p.name, chain);
  return [
    `Set up a fresh wallet used only for this farm, fund it from an exchange, and never reuse your main keys. Cost: $0. Time: 15 minutes.`,
    `${action} with $${capital} of principal plus gas for the ticket. Cost: $${capital + gas}. Time: 20 minutes.`,
    `Do one more qualifying action every week, small and boring, so the address stays active. Cost: $2. Time: 10 minutes weekly.`,
    `Leave the position alone for at least ${hold} days; exiting early usually resets accumulated points. Cost: $0. Time: ${hold} days passive.`,
    `Check ${p.name}'s own points or rewards page for the official rules, and never pay anyone to claim. Cost: $0. Time: 10 minutes monthly.`,
    `Keep a farm log with the date, action, transaction, and cost so claims and taxes stay easy. Cost: $0. Time: 5 minutes weekly.`,
  ].map((step) => step.trim());
}

// ---------------------------------------------------------------- board

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comparable_multiple: number;
    comparable_sample: number | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number;
  };
  farm_steps: string[];
}

function bySlugAsc(a: { slug: string }, b: { slug: string }): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/** The watchlist first (every slug that exists), then the early radar; all scored, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, model: RadarModel = MODEL): BoardRow[] {
  const bySlug = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (!bySlug.has(p.slug)) bySlug.set(p.slug, p);

  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const hit = bySlug.get(slug);
    if (hit && !chosen.has(slug)) chosen.set(slug, hit);
  }

  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a, b))
    .slice(0, EARLY_ROWS);

  const multiples = categoryMultiples(snapshot, model);
  const rows = [...chosen.values(), ...early].map((p): BoardRow => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: ageDays(snapshot.as_of, p.listed_at),
      implied_value_usd: v.implied_value_usd,
      model: {
        comparable_multiple: v.comp_mult,
        comparable_sample: v.comp_sample,
        growth_pct: v.growth_pct,
        growth_multiplier: v.growth_multiplier,
        maturity_multiplier: v.maturity_multiplier,
        age_days: v.age,
      },
      farm_steps: farmSteps(p, v.age),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || bySlugAsc(a, b));
  rows.forEach((row, i) => { row.rank = i + 1; });
  return rows;
}

// ---------------------------------------------------------------- live set

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Live-token, non-CEX protocols by market cap; these are facts, not model output. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlugAsc(a, b))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

// ---------------------------------------------------------------- radar payload

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  comparable_multiple: number;
  comparable_sample: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    comparable_multiple: row.model.comparable_multiple,
    comparable_sample: row.model.comparable_sample,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  model: RadarModel;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  watchlist: string[];
}

export function buildRadar(snapshot: Snapshot, model: RadarModel = MODEL): { board: BoardRow[]; radar: Radar } {
  const board = buildBoard(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const live = liveRows(snapshot);
  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    watchlist: snapshot.watchlist,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- the gate

/**
 * The board's own invariants, as one message or null: every watchlist slug present, ranks exactly
 * 1..n, implied values never rising as rank ascends, more than one implied value, 3..12 farm steps
 * of 20..600 characters each, and a positive safe integer implied value per row.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `watchlist slugs missing from the board: ${missing.slice(0, 5).join(', ')}`;
  if (board.some((r, i) => r.rank !== i + 1)) return 'board ranks are not exactly 1..n';
  for (let i = 1; i < board.length; i++) {
    if (board[i].implied_value_usd > board[i - 1].implied_value_usd) {
      return `implied value rises from rank ${board[i - 1].rank} to rank ${board[i].rank}`;
    }
  }
  if (board.length > 1 && new Set(board.map((r) => r.implied_value_usd)).size === 1) {
    return 'every row shares one implied value';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `row ${r.slug} has a non-positive or unsafe implied_value_usd`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps.length} farm steps, expected 3..12`;
    }
    for (const step of r.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${r.slug} has a farm step of ${len} characters, expected 20..600`;
    }
  }
  return null;
}

/** The dashboard's data file: one assignment the page reads before app.js runs. */
export function dataScript(radar: Radar): string {
  return 'window.RADAR=' + JSON.stringify(radar) + '\n';
}
