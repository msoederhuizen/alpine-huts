import { combineRideLeg, isRouterUnavailable, type LatLng, type RouteLeg } from '../api/brouter';
import type { Hut } from '../types/hut';
import type { Ride, RideUse } from '../types/ride';
import { kmBetween, metresBetween } from './geo';
import { isWithinSacLimit, type SacScale } from './sacScale';

export interface PlanInput {
  start: Hut;
  days: number;
  /** Acceptable range for a day's distance (km). */
  kmMin: number;
  kmMax: number;
  /** Acceptable range for a day's climbing (metres). */
  ascentMin: number;
  ascentMax: number;
  /** Acceptable range for a day's descent (metres). */
  descentMin: number;
  descentMax: number;
  roundtrip: boolean;
  /** Which way to lean when a day can't stay within range: 'balanced' (default)
   *  leans slightly toward undershoot; 'under'/'over' lean strongly either way.
   *  Used to generate the three alternative routes shown when the balanced
   *  route has to compromise. */
  bias?: 'balanced' | 'under' | 'over';
  /** When true, the per-day hard wall is dropped as a last resort so a route can
   *  always be built (however far outside the limits) — used for the "show me
   *  the closest options anyway" path after a strict search found nothing. */
  bestEffort?: boolean;
  /**
   * Hardest trail grade the walker will accept (SAC T1–T6). A leg whose hardest
   * known section exceeds this is NEVER used — not even under `bestEffort`, and
   * not as a flagged compromise. Difficulty isn't a preference you trade against
   * distance; T5 scrambling doesn't become acceptable because the day is
   * otherwise a good length.
   *
   * Undefined = no limit. See `isWithinSacLimit` for the important caveat that
   * untagged sections count as acceptable.
   */
  maxSac?: SacScale;
  /**
   * Allow a day to END IN A VILLAGE rather than only at a hut/guesthouse.
   *
   * Off by default, which is rule 5: villages were usable only as a one-way
   * trip's final stop. That is a real constraint on the search — the candidate
   * slate for each day is capped, and in areas where huts are sparse there may
   * be no hut at all at a plausible day's walk, so the day has to compromise or
   * the whole route fails. Turning this on adds villages to every day's slate,
   * which is usually the difference between "no full match" and a clean one.
   *
   * Villages are added ALONGSIDE the hut candidates, never instead of them —
   * see `beamTasks`. There are far more villages than huts, so a merged pool
   * ranked purely by distance would crowd the huts out and quietly turn a
   * hut-to-hut traverse into a valley tour.
   */
  allowVillages?: boolean;
}

/** A day whose targets had to be relaxed, with human-readable reasons. */
export interface DayCompromise {
  /** 1-based day number. */
  day: number;
  /** e.g. "18.2 km, over your 15 km max", "1250 m ascent, over your 1000 m max". */
  issues: string[];
}

export interface PlanOutcome {
  /** Ordered stops, starting at `start` and (for roundtrip) ending back there. */
  huts: Hut[];
  requestedDays: number;
  /** May be fewer than requested if it stopped early (see `stoppedReason`). */
  plannedDays: number;
  /** True if the trip actually finished at a village. */
  endsAtVillage: boolean;
  /** Per-day list of criteria that had to be relaxed (empty if all were met). */
  compromises: DayCompromise[];
  /** Why fewer days than requested were planned.
   *  - `unreachable`: the router answered, but nothing was routable/acceptable.
   *  - `router-unavailable`: we never got answers — the routing service was
   *    down, throttling or timing out. NOT the same thing, and the UI must not
   *    tell people 'no route exists' in this case. */
  stoppedReason?: 'unreachable' | 'router-unavailable';
  /** Trip totals, for showing/comparing whole-route stats (e.g. in the
   *  alternative-routes picker). */
  totalDistance: number;
  totalAscent: number;
  totalDescent: number;
  // ── Bias-neutral quality, so the three biased alternatives can be ranked
  //    fairly against each other (all computed from hard checks / neutral
  //    scoring, NOT the search bias). Lower is better on each.
  /** # days outside your distance/elevation ranges. */
  offTargetDays: number;
  /** # days that re-walk already-covered trail (one-way trips). */
  retraceDays: number;
  /** How BADLY those days retrace — Σ (overlap ÷ leg distance) across the
   *  retracing days (0 = none, higher = more/worse overlap). Ranked right after
   *  `retraceDays`: given two routes with the same day-COUNT of retracing, the
   *  one with less severe overlap wins — retracing 6% of a day is treated as
   *  clearly better than retracing 90%, rather than tying and falling through
   *  to the distance/elevation fit. One-way only (always 0 for roundtrips). */
  retraceSeverity: number;
  /** # days that end back in a region already visited (one-way trips). */
  revisitDays: number;
  /** Total deviation from your ranges, scored with the *neutral* (balanced)
   *  weighting so it's comparable regardless of which bias produced the route. */
  fitScore: number;
  /** Ride (lift/train) used on each leg, aligned to the legs of `huts` (index i
   *  = huts[i]→huts[i+1]); `null` where a leg is walked. Empty when the route
   *  uses no rides. */
  legRides: (RideUse | null)[];
}

/** Fetch (and cache) the routed leg between two stops. Injected so the caller
 *  can share react-query's leg cache with the Route tab. */
export type GetLeg = (from: Hut, to: Hut) => Promise<RouteLeg>;

// Ascent/descent are only known after routing, so a day's candidates are picked
// by straight-line distance and then bounds-checked. Route a decent-sized set so
// the tolerance band rarely comes up empty just because the few sampled huts
// happened to be too steep when gentler ones existed nearby.
const CANDIDATES_PER_DAY = 6;
/** The village-ending day routes more candidates: straight-line proximity is a
 *  poor proxy for trail distance, so evaluate every village that could fit. */
const VILLAGE_CANDIDATES = 6;
/** Partial routes kept at each day of the beam search. Higher = better global
 *  routes but more (≈ ×BEAM_WIDTH) BRouter calls. Bumped 3→4: with only 3, a
 *  branch that avoids a backtrack tomorrow could be pruned TODAY for scoring
 *  marginally worse on today's fit alone (the search has no lookahead) — a
 *  wider beam keeps more diverse branches alive long enough for that to
 *  resolve itself. See `revisitsRegion`/backtrack-risk sorting below for the
 *  other half of that fix. */
const BEAM_WIDTH = 4;

function haversineKm(a: Hut, b: Hut): number {
  return kmBetween(a.lat, a.lon, b.lat, b.lon);
}

// ── One-way anti-backtracking ────────────────────────────────────────────────
// To stop a one-way trip from walking the same trail twice, we remember every
// ~50 m cell of trail already walked and measure how much of a candidate leg
// falls on those cells. Cells ignore direction, so an out-and-back counts too.
const CELL_M = 50;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((46.5 * Math.PI) / 180); // region latitude
const LAT_CELL = CELL_M / M_PER_DEG_LAT;
const LON_CELL = CELL_M / M_PER_DEG_LON;
/** How much of a day's trail may coincide with trail already walked before that
 *  day counts as *retracing*. A small tolerance is needed because legs out of a
 *  hut legitimately share the first stretch of path / a junction. */
const RETRACE_TOLERANCE = 0.05;
/** Score penalty per unit of a leg's reused fraction, blended into `errorSum` —
 *  large (bigger than any single ascent/distance/descent weight below) so even
 *  a little retracing loses to any fresh-trail option on the internal fit
 *  objective too, not just via `retraceDays`/`retraceSeverity` in the ranking. */
const OVERLAP_WEIGHT = 60;

function cellKey(lat: number, lon: number): string {
  return `${Math.round(lat / LAT_CELL)}:${Math.round(lon / LON_CELL)}`;
}

function segMeters(a: LatLng, b: LatLng): number {
  return metresBetween(a.latitude, a.longitude, b.latitude, b.longitude);
}

/** Grid cells a segment passes through, sampled every ~half-cell so coverage
 *  stays continuous even where the trail's points are sparse. */
function* cellsAlong(a: LatLng, b: LatLng): Generator<string> {
  const steps = Math.max(1, Math.ceil(segMeters(a, b) / (CELL_M / 2)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    yield cellKey(
      a.latitude + (b.latitude - a.latitude) * t,
      a.longitude + (b.longitude - a.longitude) * t,
    );
  }
}

/** The walking polylines of a leg — its walk segments if it uses a ride (so the
 *  ride connector isn't counted as trail), else the whole leg. */
function walkPaths(leg: RouteLeg): LatLng[][] {
  if (leg.segments)
    return leg.segments
      .filter((s) => s.mode === 'walk')
      .map((s) => s.coordinates);
  return [leg.coordinates];
}

/** Record a leg's walked trail into the walked-cell set (rides don't count). */
function markWalked(leg: RouteLeg, walked: Set<string>): void {
  for (const c of walkPaths(leg)) {
    for (let i = 0; i < c.length - 1; i++) {
      for (const key of cellsAlong(c[i], c[i + 1])) walked.add(key);
    }
  }
}

/** Metres of a leg's walking that fall on already-walked trail. */
function overlapMeters(leg: RouteLeg, walked: Set<string>): number {
  if (walked.size === 0) return 0;
  let overlap = 0;
  for (const c of walkPaths(leg)) {
    for (let i = 0; i < c.length - 1; i++) {
      const len = segMeters(c[i], c[i + 1]);
      if (len === 0) continue;
      let hit = 0;
      let total = 0;
      for (const key of cellsAlong(c[i], c[i + 1])) {
        total++;
        if (walked.has(key)) hit++;
      }
      overlap += len * (hit / total);
    }
  }
  return overlap;
}

/**
 * Rule 6 — criterion priority and direction, encoded as per-criterion weights.
 * Priority: ASCENT > DISTANCE > DESCENT. Within each: in-range = 0 (best), then
 * undershoot (below), then overshoot (above; least preferred). The weights make
 * the full ordering hold:
 *   ascent-over(30) ≫ ascent-under(10) > distance-over(9) > distance-under(3) >
 *   descent-over(3) > descent-under(1).
 */
const CRIT_WEIGHTS = {
  ascent: { over: 40, under: 20 },
  distance: { over: 8, under: 3 },
  descent: { over: 2, under: 1 },
};

/** Penalty for a value outside [min, max] (0 when inside), normalised by `norm`
 *  and weighted per direction (overshoot vs undershoot). */
function critPenalty(
  value: number,
  min: number,
  max: number,
  norm: number,
  w: { over: number; under: number },
): number {
  if (value < min) return (w.under * (min - value)) / norm;
  if (value > max) return (w.over * (value - max)) / norm;
  return 0;
}

/** Rule-6 fit penalty for a leg (0 = all three criteria in range). Ascent
 *  deviations dominate, then distance, then descent; overshoot beats undershoot.
 *  Minimising the SUM of this across the whole trip is the 'fit' objective. */
function legScore(leg: RouteLeg, input: PlanInput): number {
  const km = leg.distance / 1000;
  return (
    critPenalty(
      leg.ascent,
      input.ascentMin,
      input.ascentMax,
      Math.max(150, (input.ascentMin + input.ascentMax) / 2),
      CRIT_WEIGHTS.ascent,
    ) +
    critPenalty(
      km,
      input.kmMin,
      input.kmMax,
      Math.max(2, (input.kmMin + input.kmMax) / 2),
      CRIT_WEIGHTS.distance,
    ) +
    critPenalty(
      leg.descent,
      input.descentMin,
      input.descentMax,
      Math.max(150, (input.descentMin + input.descentMax) / 2),
      CRIT_WEIGHTS.descent,
    )
  );
}

/**
 * Route generator — a **beam search** over the whole trip, built around the
 * user's rules:
 *  1. Optimise the WHOLE trail (sum of per-day fit), not leg-by-leg.
 *  2. Always exactly `days` days.               3. Always start at `start`.
 *  4. One-way always ends at a village.         5. Only the requested hut types
 *     (villages are pre-removed from `huts` by the caller; the last stop is the
 *     only village) — UNLESS `input.allowVillages`, which lets any day finish in
 *     a village too.
 *  6. Fit priority ASCENT > DISTANCE > DESCENT; within each, in-range best, then
 *     under, then over (see `legScore`).
 *  7. Per-day hard bounds: ≤20% over each max, ≤30% under each min (`withinBounds`).
 * It keeps the BEAM_WIDTH best partial routes each day, expands them, and keeps
 * those with the lowest whole-trail fit penalty. Rule 7 is relaxed for a day
 * only when nothing else is routable (to preserve rules 2 & 4), and such days
 * are flagged. A good suggestion, not a guaranteed global optimum.
 *
 * Returns every surviving beam as a ranked `PlanOutcome[]` (best fit first, deduped
 * by hut sequence) — not just the winner. The search already keeps BEAM_WIDTH
 * diverse branches alive throughout, so the runner-ups are genuinely distinct
 * routes explored at no extra cost; the caller (the Plan screen) uses them to
 * always have real alternatives to offer, on top of its own separately-biased
 * searches.
 */
export async function planRoute(
  input: PlanInput,
  huts: Hut[],
  villages: Hut[],
  getLeg: GetLeg,
  onProgress: (day: number, total: number) => void,
  signal?: AbortSignal,
  /** Lifts / mountain trains the generator may route a day through (empty =
   *  walking only). A ride costs no ascent and no hiking distance, so it lets a
   *  day reach a hut that would be too much climbing — or too far — on foot. */
  rides: Ride[] = [],
): Promise<PlanOutcome[]> {
  const {
    start,
    days,
    kmMin,
    kmMax,
    ascentMin,
    ascentMax,
    descentMin,
    descentMax,
    roundtrip,
    allowVillages,
  } = input;
  const oneWay = !roundtrip;

  // The bias sets the whole search *objective*, not just a tiebreaker — that's
  // the only way the alternatives come out genuinely different. 'fit' minimises
  // the rule-6 fit penalty (the recommended route); 'short' minimises total
  // distance (the shorter option); 'long' maximises it.
  const bias = input.bias ?? 'balanced';
  const objective: 'fit' | 'short' | 'long' =
    bias === 'under' ? 'short' : bias === 'over' ? 'long' : 'fit';

  // Rule 7 as a TWO-TIER bound (a flat hard wall at exactly 20% cut off too
  // much — one unavoidably steep day killed the whole trip):
  //  • TOLERANCE — the user's allowed margin (≤20% over each max, ≤30% under each
  //    min). Days here are always preferred.
  //  • WALL — a hard ceiling a bit beyond (≤40% over, ≤50% under). A leg past the
  //    wall is NEVER used, so no egregious 60%-over days. Between tolerance and
  //    wall, a day is allowed only as a last resort (no in-tolerance option) and
  //    is flagged.
  const inb = (
    v: number,
    min: number,
    max: number,
    overMult: number,
    underMult: number,
  ) => v >= min * underMult && v <= max * overMult;
  // ⚠️ Difficulty is an ABSOLUTE gate, not part of the tolerance/wall trade-off.
  // Distance and climb are negotiable — a day can run 20% long and still be
  // offered as a flagged compromise. A grade above what the walker said they'll
  // handle is not negotiable in the same way, so this is ANDed into both bounds
  // and is not relaxed by `bestEffort`.
  const gradeOk = (leg: RouteLeg): boolean =>
    isWithinSacLimit(leg.sacScale, input.maxSac);
  const withinTolerance = (leg: RouteLeg): boolean =>
    gradeOk(leg) &&
    inb(leg.distance / 1000, kmMin, kmMax, 1.2, 0.7) &&
    inb(leg.ascent, ascentMin, ascentMax, 1.2, 0.7) &&
    inb(leg.descent, descentMin, descentMax, 1.2, 0.7);
  const withinWall = (leg: RouteLeg): boolean =>
    gradeOk(leg) &&
    inb(leg.distance / 1000, kmMin, kmMax, 1.4, 0.5) &&
    inb(leg.ascent, ascentMin, ascentMax, 1.4, 0.5) &&
    inb(leg.descent, descentMin, descentMax, 1.4, 0.5);

  // ── Beam search over the whole trip ─────────────────────────────────────────
  // Greedy day-by-day picks the locally-best next stop, so an early choice can
  // force bad later days and small errors pile up on every day. Instead we keep
  // the BEAM_WIDTH best *partial* routes each day, expand them all, and finally
  // choose the whole route with the best global fit — happy to get one day wrong
  // if that keeps the rest on target.
  interface Beam {
    route: Hut[];
    visited: Set<string>;
    walked: Set<string>; // walked ~50 m cells, for one-way overlap
    totalDist: number;
    totalAscent: number;
    totalDescent: number;
    overlapDist: number;
    /** # days that re-walk trail already covered. Ranked ABOVE `violations`:
     *  the user would rather walk further/steeper than repeat a trail. */
    retraceDays: number;
    /** Σ overlap fraction across retracing days — see `PlanOutcome.retraceSeverity`. */
    retraceSeverity: number;
    /** # days that end within REGION_KM of an earlier stop (one-way). */
    revisitDays: number;
    violations: number; // # days outside the distance/elevation criteria (display)
    errorSum: number; // Σ rule-6 fit penalty (+ overlap) — the 'fit' objective
    neutralScore: number; // Σ pure rule-6 fit — for cross-route comparison
    compromises: DayCompromise[];
    rides: (RideUse | null)[]; // ride used per leg (null = walked)
  }

  // Straight-line pre-filter for candidates (BRouter efficiency — the real bound
  // is the rule-7 `withinBounds` check after routing). Band spans the rule-7
  // distance window (÷~1.4 for the trail↔crow-flies ratio); the bias shifts the
  // target `centre` so 'short' aims low and 'long' aims high within it.
  const midKm = (kmMin + kmMax) / 2;
  const minSl = kmMin * 0.45;
  const maxSl = kmMax * 1.2;
  const centre =
    objective === 'short' ? minSl : objective === 'long' ? maxSl : midKm * 0.7;

  // ── Rides (lifts / mountain trains) ──────────────────────────────────────
  const ridesOn = rides.length > 0;
  /** How far beyond a day's walking range a hut can sit and still be reachable
   *  once a ride covers the gap. */
  const RIDE_EXTRA_KM = 8;
  /** Straight-line km a ride must save to be worth taking (else just walk). */
  const RIDE_MIN_SHORTCUT = 1;

  /** A throwaway waypoint at a ride station, so `getLeg` can route (and cache)
   *  the walk to/from it. Never enters the route itself. */
  const stationHut = (p: LatLng): Hut => ({
    id: `station/${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`,
    name: 'station',
    lat: p.latitude,
    lon: p.longitude,
    type: 'village',
    bookingUrl: '',
    tags: {},
  });

  /** A zero-length walk, when a station effectively coincides with the hut. */
  const emptyWalk = (p: LatLng): RouteLeg => ({
    coordinates: [p],
    distance: 0,
    ascent: 0,
    descent: 0,
    duration: 0,
  });

  /**
   * The best ride to bridge `from`→`to`, or null. Picks the orientation and ride
   * that leave the *least* walking (most trail skipped) while keeping each walk
   * within a day's reach and actually shortcutting the crow-flies distance.
   * Straight-line only — cheap enough to run for every candidate before routing.
   */
  const pickRide = (
    from: Hut,
    to: Hut,
  ): { ride: Ride; enter: LatLng; exit: LatLng } | null => {
    const directSL = kmBetween(from.lat, from.lon, to.lat, to.lon);
    let best:
      | { walkSL: number; ride: Ride; enter: LatLng; exit: LatLng }
      | null = null;
    for (const r of rides) {
      for (const [enter, exit] of [
        [r.a, r.b],
        [r.b, r.a],
      ] as const) {
        const w1 = kmBetween(from.lat, from.lon, enter.latitude, enter.longitude);
        const w2 = kmBetween(exit.latitude, exit.longitude, to.lat, to.lon);
        const walkSL = w1 + w2;
        if (w1 > maxSl || w2 > maxSl || walkSL > maxSl) continue;
        if (directSL - walkSL < RIDE_MIN_SHORTCUT) continue;
        if (!best || walkSL < best.walkSL)
          best = { walkSL, ride: r, enter, exit };
      }
    }
    return best ? { ride: best.ride, enter: best.enter, exit: best.exit } : null;
  };

  /** Route a ride-assisted day: walk to the boarding station, ride (free), walk
   *  to the hut. Resolves to null if either walk can't be routed. */
  const routeRide = async (
    from: Hut,
    to: Hut,
    pick: { ride: Ride; enter: LatLng; exit: LatLng },
  ): Promise<RouteLeg | null> => {
    const { ride, enter, exit } = pick;
    const w1p =
      kmBetween(from.lat, from.lon, enter.latitude, enter.longitude) < 0.06
        ? Promise.resolve(emptyWalk(enter))
        : getLeg(from, stationHut(enter));
    const w2p =
      kmBetween(exit.latitude, exit.longitude, to.lat, to.lon) < 0.06
        ? Promise.resolve(emptyWalk(exit))
        : getLeg(stationHut(exit), to);
    try {
      const [walk1, walk2] = await Promise.all([w1p, w2p]);
      return combineRideLeg(walk1, walk2, {
        id: ride.id,
        name: ride.name,
        ref: ride.ref,
        mode: ride.mode,
        enter,
        exit,
      });
    } catch {
      return null;
    }
  };

  /** Huts / villages just beyond a day's walking range, reachable only via a
   *  ride — this is how rides "expand the route range". One-way: candidates
   *  near an already-visited stop are deprioritised (see `hutCandidates`). */
  const extendedCandidates = (
    pool: Hut[],
    from: Hut,
    visited: Set<string>,
    limit: number,
    priorStops: Hut[],
  ): Hut[] =>
    pool
      .filter((h) => !visited.has(h.id))
      .map((h) => ({
        h,
        sl: haversineKm(from, h),
        backtrackRisk: revisitsRegion(h, priorStops) ? 1 : 0,
      }))
      .filter(({ sl }) => sl > maxSl && sl <= maxSl + RIDE_EXTRA_KM)
      .sort((a, b) => a.backtrackRisk - b.backtrackRisk || a.sl - b.sl)
      .slice(0, limit)
      .map(({ h }) => h);

  const withinCriteria = (leg: RouteLeg): boolean => {
    const km = leg.distance / 1000;
    return (
      km >= kmMin &&
      km <= kmMax &&
      leg.ascent <= ascentMax &&
      leg.descent <= descentMax
    );
  };

  /** Does this day re-walk a meaningful stretch of trail already covered? */
  const retraces = (leg: RouteLeg, overlap: number): boolean =>
    oneWay && leg.distance > 0 && overlap / leg.distance > RETRACE_TOLERANCE;

  // One-way: how close (km) a new stop may sit to any earlier stop before it
  // counts as lingering in a region already visited. Catches lift up-and-back
  // days that keep returning to the same village instead of moving across the
  // range — a one-way trip should traverse new terrain (roundtrips are exempt).
  const REGION_KM = 4;
  const revisitsRegion = (hut: Hut, route: Hut[]): boolean =>
    oneWay && route.some((prev) => haversineKm(prev, hut) < REGION_KM);

  // Human-readable reasons a day missed the criteria (empty if it met them).
  // Compares to the user's supplied max/min — no margin/percentage wording.
  const dayIssues = (leg: RouteLeg, overlap: number): string[] => {
    const km = leg.distance / 1000;
    const out: string[] = [];
    if (km > kmMax) out.push(`${km.toFixed(1)} km — over your ${kmMax} km max`);
    else if (km < kmMin)
      out.push(`${km.toFixed(1)} km — under your ${kmMin} km min`);
    if (leg.ascent > ascentMax)
      out.push(`${Math.round(leg.ascent)} m ascent — over your ${ascentMax} m max`);
    if (leg.descent > descentMax)
      out.push(
        `${Math.round(leg.descent)} m descent — over your ${descentMax} m max`,
      );
    if (retraces(leg, overlap))
      out.push(
        `re-walks ~${Math.round((overlap / leg.distance) * 100)}% of trail you've already covered`,
      );
    return out;
  };

  // Candidate huts a day away from `from` (nearest the target + nearest
  // overall). One-way: a hut within REGION_KM of an ALREADY-VISITED stop is
  // deprioritised (not excluded) — this is the actual fix for "it backtracks
  // even though a non-backtracking option existed": the day's candidate slate
  // is capped at CANDIDATES_PER_DAY, and it used to fill purely by proximity
  // to `centre`, so a backtrack-prone hut could take a slot ahead of a
  // genuinely fresh-direction one that was only slightly farther — meaning the
  // good option was never even ROUTED that day, so no amount of downstream
  // retrace-ranking could recover it. Sorting backtrack-risk first fills the
  // limited slate with fresh options whenever there's a choice; a risky hut is
  // still included as a fallback if there aren't enough fresh ones nearby.
  //
  // Takes the POOL as a parameter so villages can be offered on the same terms
  // as huts when `allowVillages` is on — they need this target-distance ranking,
  // not `villageCandidates`' nearest-first ranking, which exists for picking a
  // trip's finish rather than a day's stop.
  const candidatesFrom = (
    pool: Hut[],
    from: Hut,
    visited: Set<string>,
    priorStops: Hut[],
    limit: number,
  ): Hut[] => {
    const inBand = pool
      .filter((h) => !visited.has(h.id))
      .map((h) => ({
        h,
        sl: haversineKm(from, h),
        backtrackRisk: revisitsRegion(h, priorStops) ? 1 : 0,
      }))
      .filter(({ sl }) => sl >= minSl && sl <= maxSl);
    const picks = [...inBand]
      .sort(
        (a, b) =>
          a.backtrackRisk - b.backtrackRisk ||
          Math.abs(a.sl - centre) - Math.abs(b.sl - centre),
      )
      .slice(0, limit);
    if (inBand.length) {
      const nearest = inBand.reduce((a, b) => (b.sl < a.sl ? b : a));
      if (!picks.some((p) => p.h.id === nearest.h.id)) picks.push(nearest);
    }
    return picks.map(({ h }) => h);
  };

  const hutCandidates = (
    from: Hut,
    visited: Set<string>,
    priorStops: Hut[],
  ): Hut[] =>
    candidatesFrom(huts, from, visited, priorStops, CANDIDATES_PER_DAY);

  /** A day's village options when `allowVillages` is on — ADDED to the hut
   *  slate, never replacing it (see the note on `PlanInput.allowVillages`). */
  const midTripVillageCandidates = (
    from: Hut,
    visited: Set<string>,
    priorStops: Hut[],
  ): Hut[] =>
    allowVillages
      ? candidatesFrom(villages, from, visited, priorStops, VILLAGE_CANDIDATES)
      : [];

  // Villages within a day's straight-line reach (`maxSl`, widened for 'long')
  // + the nearest as a guaranteed finish. Same backtrack-risk deprioritisation
  // as `hutCandidates`.
  const villageCandidates = (
    from: Hut,
    visited: Set<string>,
    priorStops: Hut[],
  ): Hut[] => {
    const inBand = villages
      .filter((h) => !visited.has(h.id))
      .map((h) => ({
        h,
        sl: haversineKm(from, h),
        backtrackRisk: revisitsRegion(h, priorStops) ? 1 : 0,
      }));
    const picks = inBand
      .filter(({ sl }) => sl <= maxSl)
      .sort((a, b) => a.backtrackRisk - b.backtrackRisk || a.sl - b.sl)
      .slice(0, VILLAGE_CANDIDATES)
      .map(({ h }) => h);
    if (inBand.length) {
      const nearest = inBand.reduce((a, b) => (b.sl < a.sl ? b : a));
      if (!picks.some((p) => p.id === nearest.h.id)) picks.push(nearest.h);
    }
    return picks;
  };

  // `rideOnly` candidates sit beyond walking range and are only reachable via a
  // ride, so their direct-walk leg is skipped (it would always fail the wall).
  type Task = { beam: Beam; from: Hut; hut: Hut; rideOnly: boolean };

  // The stops a beam may extend to on a given day.
  // - Roundtrip's last day: back to `start`.
  // - One-way's last day: villages ONLY (rule 4 — always finish at a village).
  // - Every other day: huts of the requested accommodation types, PLUS a bounded
  //   set of villages when `allowVillages` is on (rule 5; villages are filtered
  //   out of `huts` by the caller, so the two pools never overlap).
  // With rides enabled, each day also gets a few candidates just beyond walking
  // range (reachable only by riding part of the way).
  const beamTasks = (
    beam: Beam,
    isLast: boolean,
    mandatory: boolean,
    /** Include the ride-only candidates (huts beyond walking range)? Deferred
     *  until we know walking can't do the day — see the two-phase note below. */
    includeRides: boolean,
  ): Task[] => {
    const from = beam.route[beam.route.length - 1];
    const inBand = mandatory
      ? [start]
      : oneWay && isLast
        ? villageCandidates(from, beam.visited, beam.route)
        : [
            ...hutCandidates(from, beam.visited, beam.route),
            ...midTripVillageCandidates(from, beam.visited, beam.route),
          ];
    const tasks: Task[] = inBand.map((hut) => ({
      beam,
      from,
      hut,
      rideOnly: false,
    }));
    if (ridesOn && includeRides && !mandatory) {
      const extended =
        oneWay && isLast
          ? extendedCandidates(
              villages,
              from,
              beam.visited,
              VILLAGE_CANDIDATES,
              beam.route,
            )
          : [
              ...extendedCandidates(
                huts,
                from,
                beam.visited,
                CANDIDATES_PER_DAY,
                beam.route,
              ),
              // Ride-reachable villages too, on the same opt-in terms.
              ...(allowVillages
                ? extendedCandidates(
                    villages,
                    from,
                    beam.visited,
                    VILLAGE_CANDIDATES,
                    beam.route,
                  )
                : []),
            ];
      for (const hut of extended)
        if (!tasks.some((t) => t.hut.id === hut.id))
          tasks.push({ beam, from, hut, rideOnly: true });
    }
    return tasks;
  };

  // Objective-driven ranking keys (lower = better). 'fit' minimises the rule-6
  // fit penalty summed over the WHOLE trail (rule 1); 'short'/'long' drive total
  // distance down/up (bounded by rule 7). Secondary keeps each sensible.
  const objectivePrimary = (b: Beam): number =>
    objective === 'short'
      ? b.totalDist
      : objective === 'long'
        ? -b.totalDist
        : b.errorSum;
  const objectiveSecondary = (b: Beam): number =>
    objective === 'fit' ? b.neutralScore : b.errorSum;

  // A routed candidate leg: the beam it extends, the hut it reaches, the leg
  // (walked or composite), and the ride used (null when walked).
  type Routed = { beam: Beam; hut: Hut; leg: RouteLeg; rideUse: RideUse | null };

  let beams: Beam[] = [
    {
      route: [start],
      visited: new Set([start.id]),
      walked: new Set(),
      totalDist: 0,
      totalAscent: 0,
      totalDescent: 0,
      overlapDist: 0,
      retraceDays: 0,
      retraceSeverity: 0,
      revisitDays: 0,
      violations: 0,
      errorSum: 0,
      neutralScore: 0,
      compromises: [],
      rides: [],
    },
  ];
  let stoppedReason: PlanOutcome['stoppedReason'];

  for (let day = 1; day <= days; day++) {
    if (signal?.aborted) break;
    onProgress(day, days);

    const isLast = day === days;
    const mandatory = roundtrip && isLast; // must return to start

    // Route every candidate leg for the day in one parallel batch. Rides are a
    // range-EXTENSION mechanism, not a preference: a ride-assisted leg is only
    // ever attempted for `rideOnly` candidates (huts already beyond normal
    // walking range) — never for a hut that's already within easy walking
    // reach, so a lift can never "win" over a perfectly workable walk to the
    // same nearby hut just because its numbers happen to fit slightly better.
    // ── Two-phase day ────────────────────────────────────────────────────────
    // Phase 1 routes only what you can WALK to. Ride work — both the ride-only
    // candidates beyond walking range and the rescue re-routes — is deferred to
    // phase 2 and skipped entirely when walking already satisfies the day.
    //
    // Rides can only ever WIN when no walk meets the criteria (see `walkOnly`
    // below), so on a day walking handles, every ride leg routed was computed
    // and discarded. That doubled a lifts-enabled search — 119 legs → 240,
    // 6.2 s → 13.4 s on a 5-day trip — for results that could never be used.
    const tasks = beams.flatMap((beam) => beamTasks(beam, isLast, mandatory, false));
    // How many of this day's legs came back with NO ANSWER (service down,
    // throttled, timed out) rather than a real 'no path here'. Drives the
    // distinction in `stoppedReason` below.
    let noAnswer = 0;
    const legPromises: Promise<Routed | null>[] = [];
    for (const t of tasks) {
      if (!t.rideOnly) {
        legPromises.push(
          getLeg(t.from, t.hut).then(
            (leg): Routed => ({ beam: t.beam, hut: t.hut, leg, rideUse: null }),
            (err) => { if (isRouterUnavailable(err)) noAnswer++; return null; },
          ),
        );
      } else if (ridesOn) {
        const pick = pickRide(t.from, t.hut);
        if (pick)
          legPromises.push(
            routeRide(t.from, t.hut, pick).then((leg): Routed | null =>
              leg
                ? { beam: t.beam, hut: t.hut, leg, rideUse: leg.ride ?? null }
                : null,
            ),
          );
      }
    }
    const routed = await Promise.all(legPromises);
    if (signal?.aborted) break;
    const ok = routed.filter((r): r is Routed => r !== null);

    /**
     * RIDE RESCUE PASS — the ride is offered as a fix for a day that doesn't
     * otherwise work.
     *
     * Rides used to be attempted ONLY for `rideOnly` candidates: huts already
     * beyond walking range. That misses the case people actually want a lift
     * for — a hut that is perfectly close but sits 1 400 m above you, where the
     * walk busts the ascent limit and the gondola is exactly what makes the day
     * fit. Such a hut is an ordinary in-range candidate, so a ride was never
     * even considered for it.
     *
     * So: re-route with a ride ONLY those candidates whose plain walk missed the
     * day's targets, and keep the result ONLY if the ride actually brings it
     * inside them. A candidate whose walk already fits is never re-routed — so a
     * lift can never outcompete a workable walk, and a good day costs no extra
     * requests.
     */
    // ⚠️ Skip the whole pass when WALKING already works today.
    //
    // A ride only ever survives selection if no walk meets the criteria (see the
    // `walkOnly` rule below). So on a day where some walk already fits, every
    // rescue we route is computed and then thrown away — pure waste, and it was
    // DOUBLING the work of a lifts-enabled search: 119 legs → 240, 6.2 s → 13.4 s
    // measured on a 5-day trip, almost all of it discarded. Checking first costs
    // nothing and leaves the rescue running exactly where it can change the
    // outcome.
    const walkAlreadyFits = ok.some((r) => !r.rideUse && withinCriteria(r.leg));

    // Phase 2a — the out-of-walking-range candidates a ride makes reachable.
    if (ridesOn && !walkAlreadyFits) {
      const rideTasks = beams
        .flatMap((beam) => beamTasks(beam, isLast, mandatory, true))
        .filter((t) => t.rideOnly);
      const extra = await Promise.all(
        rideTasks.map((t) => {
          const pick = pickRide(t.from, t.hut);
          if (!pick) return Promise.resolve(null);
          return routeRide(t.from, t.hut, pick).then(
            (leg): Routed | null =>
              leg ? { beam: t.beam, hut: t.hut, leg, rideUse: leg.ride ?? null } : null,
            (err) => { if (isRouterUnavailable(err)) noAnswer++; return null; },
          );
        }),
      );
      if (signal?.aborted) break;
      for (const r of extra) if (r) ok.push(r);
    }

    // Phase 2b — re-route the near-misses with a lift.
    if (ridesOn && !walkAlreadyFits) {
      const rescues: Promise<Routed | null>[] = [];
      for (const r of ok) {
        if (r.rideUse || withinCriteria(r.leg)) continue;
        const from = r.beam.route[r.beam.route.length - 1];
        const pick = pickRide(from, r.hut);
        if (!pick) continue;
        rescues.push(
          routeRide(from, r.hut, pick).then(
            (leg): Routed | null =>
              leg
                ? { beam: r.beam, hut: r.hut, leg, rideUse: leg.ride ?? null }
                : null,
            (err) => { if (isRouterUnavailable(err)) noAnswer++; return null; },
          ),
        );
      }
      if (rescues.length > 0) {
        const extra = await Promise.all(rescues);
        if (signal?.aborted) break;
        for (const r of extra) {
          // Must genuinely rescue the day — a ride that still misses the
          // targets is just a lift ticket for no benefit.
          if (r && withinCriteria(r.leg)) ok.push(r);
        }
      }
    }
    // Rule 7, two-tier: never expand past the WALL. Among those, strongly prefer
    // the TOLERANCE band and only fall through to the stretch (tolerance→wall)
    // when no in-tolerance candidate exists this day. If nothing even reaches the
    // wall, the trip can't be built and the caller reports "no route".
    const wall = ok.filter((r) => withinWall(r.leg));
    // Strict: never go past the wall (empty wall → stop → "no route"). Best-
    // effort: fall through to any routable candidate so a route can still be
    // built, however far outside the limits (the flagged "closest option").
    // ⚠️ The best-effort fallback still respects the grade limit — `ok` is every
    // routable candidate, so without this filter "show me the closest option
    // anyway" could hand back a T5 scramble to someone who said T3. Length and
    // climb may be stretched to salvage a trip; difficulty may not.
    const base = wall.length
      ? wall
      : input.bestEffort
        ? ok.filter((r) => gradeOk(r.leg))
        : [];
    if (base.length === 0) {
      // ⚠️ If most of this day's legs never got an answer, the trip is not
      // impossible — we simply couldn't ask. Saying 'no route exists' there is
      // what made a dead tunnel and a throttled server both look like
      // 'this walk cannot be done'.
      stoppedReason = noAnswer >= Math.max(1, Math.ceil(tasks.length / 2))
        ? 'router-unavailable'
        : 'unreachable';
      break;
    }
    const preferred = base.filter((r) => withinTolerance(r.leg));
    let pool = preferred.length ? preferred : base;
    // Prefer walking — but only when walking actually WORKS.
    //
    // ⚠️ This test used to be `walkOnly.length` — i.e. keep walk-only candidates
    // whenever ANY survived the tier, discarding every ride. A day typically has
    // dozens of routable walks, so that condition was true essentially always
    // and no ride could ever be chosen. Enabling "use lifts & mountain trains"
    // therefore did nothing at all, which is the opposite of the original bug
    // (where a lift was used on every route) and just as wrong.
    //
    // The right bar is whether a walk MEETS THE DAY'S CRITERIA. If one does,
    // walking wins and rides are dropped. If none does, the ride-assisted legs
    // — which reached here only by passing the rescue test above — compete on
    // merit. That is exactly "use the lift when it's what makes the day fit".
    const walkOnly = pool.filter((r) => !r.rideUse);
    pool = walkOnly.some((r) => withinCriteria(r.leg)) ? walkOnly : pool;

    // Expand each routed candidate into a new partial route.
    const expansions: Beam[] = pool.map(({ beam, hut, leg, rideUse }) => {
      const overlap = oneWay ? overlapMeters(leg, beam.walked) : 0;
      const isRetrace = retraces(leg, overlap);
      const overlapFrac = leg.distance > 0 ? overlap / leg.distance : 0;
      const meets = withinCriteria(leg);
      const fit = legScore(leg, input);
      const penalty = fit + (oneWay ? OVERLAP_WEIGHT * overlapFrac : 0);
      const issues = dayIssues(leg, overlap);
      const walked = oneWay ? new Set(beam.walked) : beam.walked;
      if (oneWay) markWalked(leg, walked);
      const visited = new Set(beam.visited);
      visited.add(hut.id);
      const revisit = revisitsRegion(hut, beam.route);
      return {
        route: [...beam.route, hut],
        visited,
        walked,
        totalDist: beam.totalDist + leg.distance,
        totalAscent: beam.totalAscent + leg.ascent,
        totalDescent: beam.totalDescent + leg.descent,
        overlapDist: beam.overlapDist + overlap,
        retraceDays: beam.retraceDays + (isRetrace ? 1 : 0),
        retraceSeverity: beam.retraceSeverity + (isRetrace ? overlapFrac : 0),
        revisitDays: beam.revisitDays + (revisit ? 1 : 0),
        violations: beam.violations + (meets ? 0 : 1),
        errorSum: beam.errorSum + penalty,
        neutralScore: beam.neutralScore + fit, // pure rule-6 fit, for cross-route ranking
        compromises: issues.length
          ? [...beam.compromises, { day, issues }]
          : beam.compromises,
        rides: [...beam.rides, rideUse],
      };
    });

    // Rank partial routes. Repeating trail (retrace) ranks first, and how BADLY
    // it retraces ranks right after it — a route that shares 90% of a day's
    // trail with an earlier day is worse than one sharing 6%, even if they tie
    // on day-COUNT, and both are worse than any distance/elevation miss for a
    // one-way trip. Doubling back into an already-visited region ranks next.
    // Then the objective: 'fit' minimises the rule-6 penalty; 'short'/'long'
    // push total distance down/up.
    expansions.sort(
      (a, b) =>
        a.retraceDays - b.retraceDays ||
        a.retraceSeverity - b.retraceSeverity ||
        a.revisitDays - b.revisitDays ||
        objectivePrimary(a) - objectivePrimary(b) ||
        objectiveSecondary(a) - objectiveSecondary(b),
    );
    beams = expansions.slice(0, BEAM_WIDTH);
  }

  // Rank every surviving beam: for one-way, ending at a village leads; then the
  // same retrace → retrace-severity → revisit → objective ordering used for
  // pruning throughout. The beam already carries BEAM_WIDTH diverse branches
  // (not just the single best), so returning all of them — not just the
  // winner — gives the caller genuinely distinct alternatives "for free",
  // without extra BRouter calls, whenever the search actually explored more
  // than one viable route.
  const endsVillage = (b: Beam) =>
    b.route[b.route.length - 1].type === 'village';
  const compareBeam = (a: Beam, b: Beam): number => {
    const aBad = oneWay && !endsVillage(a) ? 1 : 0;
    const bBad = oneWay && !endsVillage(b) ? 1 : 0;
    return (
      aBad - bBad ||
      a.retraceDays - b.retraceDays ||
      a.retraceSeverity - b.retraceSeverity ||
      a.revisitDays - b.revisitDays ||
      objectivePrimary(a) - objectivePrimary(b) ||
      objectiveSecondary(a) - objectiveSecondary(b)
    );
  };
  const ranked = [...beams].sort(compareBeam);

  const toOutcome = (b: Beam): PlanOutcome => ({
    huts: b.route,
    requestedDays: days,
    plannedDays: b.route.length - 1,
    endsAtVillage: endsVillage(b),
    compromises: b.compromises,
    stoppedReason,
    totalDistance: b.totalDist,
    totalAscent: b.totalAscent,
    totalDescent: b.totalDescent,
    offTargetDays: b.violations,
    retraceDays: b.retraceDays,
    retraceSeverity: b.retraceSeverity,
    revisitDays: b.revisitDays,
    fitScore: b.neutralScore,
    // Collapse an all-walking route to [] so trips without rides stay simple.
    legRides: b.rides.some(Boolean) ? b.rides : [],
  });

  // De-dupe identical hut sequences (distinct beams can converge onto the same
  // route) so every returned outcome is genuinely different.
  const seen = new Set<string>();
  const outcomes: PlanOutcome[] = [];
  for (const b of ranked) {
    const sig = b.route.map((h) => h.id).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    outcomes.push(toOutcome(b));
  }
  return outcomes;
}
