import { remoteBrouterUrl } from './remoteConfig';
import type { LegSegment, RideMode, RideUse } from '../types/ride';
import { buildElevationProfile } from '../utils/elevationProfile';
import { metresBetween } from '../utils/geo';
import { readCachedLeg, writeCachedLeg } from '../utils/legCache';
import { estimateHikeTime, sacTimeFactor } from '../utils/hikeTime';
import { currentMaxSac } from '../store/preferencesStore';
import {
  SAC_SCALE_ORDER,
  combineSacScale,
  hardSacShare,
  hardestSacScale,
  hardestViaFerrata,
  type SacScale,
} from '../utils/sacScale';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteLeg {
  /** Full geometry for drawing/framing on the map (walk + any ride connector). */
  coordinates: LatLng[];
  /** Walking distance in metres. Excludes any ride — riding isn't hiking. */
  distance: number;
  /** Total elevation gain in metres. Excludes any ride — you don't climb it. */
  ascent: number;
  /** Total elevation loss in metres. Excludes any ride. */
  descent: number;
  /** Estimated time in seconds (walking + ride time when a ride is used). */
  duration: number;
  /** Present when the leg uses a lift/train: the walk-ride-walk pieces, so the
   *  map can draw the walking parts as trail and the ride as a distinct line. */
  segments?: LegSegment[];
  /** The ride used on this leg, if any (for labelling in the Route tab). */
  ride?: RideUse;
  /** SAC hiking scale (T1–T6) of the hardest tagged stretch of WALKED trail —
   *  `undefined` when nothing along it carries a `sac_scale` tag. */
  sacScale?: SacScale;
  /** Hardest `via_ferrata_scale` found along the leg, if any. Present means the
   *  day needs a harness, lanyard and helmet — see `hardestViaFerrata`. */
  viaFerrata?: string;
  /** Height profile as flat [metresAlong, metresAsl, …] — see buildElevationProfile.
   *  Empty/absent when the track carries no elevation. */
  profile?: number[];
}

/** The community server. Fine for a handful of requests; see the note on
 *  `MAX_CONCURRENT_LEGS` for why it can't carry the route generator. */
const PUBLIC_BROUTER_URL = 'https://brouter.de/brouter';

/**
 * Routing server, for development, from a `.env` entry:
 *
 *     EXPO_PUBLIC_BROUTER_URL=http://192.168.1.23:17777/brouter
 *
 * Use the machine's LAN IP, not `localhost` — the app runs on your phone, and
 * `localhost` there means the phone itself. `scripts/setup-brouter.sh` sets the
 * server up; run `npm run brouter` to start it.
 */
const BUILT_IN_BROUTER_URL =
  process.env.EXPO_PUBLIC_BROUTER_URL?.replace(/\/+$/, '') || PUBLIC_BROUTER_URL;

/**
 * ⚠️ A FUNCTION, NOT A CONSTANT, and that is the whole point.
 *
 * This used to be `const BROUTER_URL = process.env…`, read once at BUILD time
 * and frozen into the shipped app. Moving the routing server — or having its
 * host disappear — then broke route planning for every installed copy, fixable
 * only by an App Store release that users then had to install. For an app
 * whose purpose is planning walks, that is the single most fragile thing in it.
 *
 * `remoteBrouterUrl()` comes from a JSON file on the project's own site, so the
 * address can be changed with a `git push` and every copy picks it up on its
 * next launch. The build-time value remains the fallback, which is what keeps
 * `npm start` against a laptop working exactly as before.
 */
function primaryBase(): string {
  return remoteBrouterUrl() ?? BUILT_IN_BROUTER_URL;
}

/** True when we're leaning on the shared community server rather than our own.
 *  Evaluated per call, since the primary can now change while the app runs. */
function usingPublicServer(): boolean {
  return primaryBase() === PUBLIC_BROUTER_URL;
}

/**
 * Max requests in flight at once, and how we recover when BRouter says no.
 *
 * ⚠️ WHY THIS EXISTS. The route generator is a beam search: it routes every
 * candidate for a day IN PARALLEL, which for a 5-day trip is ~70 requests fired
 * essentially at once — and the Plan tab then runs several biased searches for
 * the alternatives. brouter.de answers that burst with `403 Please, retry
 * later!`, and once the allowance is spent even a single follow-up request is
 * rejected instantly. Measured on 2026-08-17: 34 of 63 leg requests 403'd, and
 * the best-effort retry got 7 of 7 rejected in 0.0 s — which surfaced to the
 * user as "couldn't link 5 days ending at a village from there at all, even
 * ignoring your limits". The search was fine; it simply had no legs to work
 * with.
 *
 * ⚠️ THE GATE DOES NOT AFFECT ROUTING ACCURACY. Every leg is routed identically
 * whatever the concurrency; the gate only changes how fast they're issued. It is
 * throttling that wrecks accuracy — a 403'd leg looks to the generator exactly
 * like a hut it cannot reach, which is how a perfectly good 5-day route came
 * back as "couldn't link 5 days at all".
 *
 * So: 4 against the public server (harm reduction on a volunteer-run service —
 * measured, 8 concurrent gets 100% rejected), and 16 against our own, where the
 * only limit is the box we're paying for. Self-hosted is both faster AND more
 * accurate, because nothing is being dropped.
 */
/**
 * A self-hosted server that stops answering must NOT take routing down with it.
 *
 * ⚠️ WHY: a Cloudflare quick tunnel in front of a local BRouter died three times
 * in one day (HTTP 000, then 530 "origin unreachable"). Every leg then failed and
 * the map drew straight red placeholder lines with no explanation — the app was
 * hard-depending on the least reliable link in the chain. Now a primary that
 * can't be reached is marked down and traffic falls back to the public server:
 * slower and rate-limited, but routes still appear.
 *
 * The mark is time-boxed so the primary is retried on its own, without a restart.
 */
let primaryDownUntil = 0;
const PRIMARY_RETRY_AFTER_MS = 60_000;

/** Which server this request should use, honouring any active failover. */
function activeBase(): string {
  if (usingPublicServer()) return PUBLIC_BROUTER_URL;
  return Date.now() < primaryDownUntil ? PUBLIC_BROUTER_URL : primaryBase();
}
/** True when we're currently talking to the shared community server. */
const onPublic = () => activeBase() === PUBLIC_BROUTER_URL;

const CONFIGURED_CONCURRENCY = Number(
  process.env.EXPO_PUBLIC_BROUTER_CONCURRENCY || 0,
);
/** Read per acquisition — the cap must drop to 4 the moment we fail over onto
 *  the public server, or we'd burst it exactly as we did before the gate. */
function maxConcurrentLegs(): number {
  if (CONFIGURED_CONCURRENCY > 0) return CONFIGURED_CONCURRENCY;
  return onPublic() ? 4 : 16;
}
/** 403 here means "slow down", not "never" — so it's worth waiting out. */
const RETRY_LATER_ATTEMPTS = 3;
const RETRY_LATER_BACKOFF_MS = 1200;

/**
 * How long to wait for one leg before giving up on it.
 *
 * ⚠️ This is a SEARCH-SPEED control, not a network setting. The route generator
 * runs day by day — every candidate leg for a day must resolve before the next
 * day starts — so a single slow leg stalls that whole day.
 *
 * Some pairs are pathologically slow: BRouter grinds for its own internal
 * 60-second limit on huts with no walkable connection before admitting defeat.
 * Blümlisalp → Rosenlaui, separated by glaciers, takes exactly 60.0 s. Raising
 * the server's heap to 4 GB and its threads to 32 changed nothing, and neither
 * did concurrency (a 5-day search took 63.4 / 61.3 / 61.1 s at 8 / 16 / 48
 * parallel) — because it is the SLOWEST LEG PER DAY that gates the day, not
 * throughput.
 *
 * Measured on the same 5-day search, varying only this value:
 *
 *     12 s → 61.0 s      8 s → 9.6 s      5 s → 6.2 s      3 s → 4.1 s
 *
 * Every one produced the IDENTICAL route, 5/5 days, zero compromises, and the
 * same 12 abandoned legs. Waiting longer never rescued a single leg — it only
 * waited.
 *
 * End-to-end (balanced + both alternatives, alternatives in parallel):
 *
 *     6 s → 32.9 s      3 s → 18.0 s      2 s → 13.0 s
 *
 * — again identical routes throughout. 3 s is the setting: every leg worth
 * keeping resolved in well under 1 s locally, and the Cloudflare tunnel adds
 * only ~350 ms, so this leaves ample headroom for a slower phone network while
 * keeping a full generation under ~20 s.
 */
const LEG_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_BROUTER_LEG_TIMEOUT_MS || 3000);

/**
 * Marker prefix meaning "we never got an answer from the router" — as opposed to
 * "the router answered: there is no path". `isRouterUnavailable` reads it, and
 * `planRoute` uses it to report a service problem instead of claiming no route
 * exists. See the note where it's thrown.
 */
const ROUTER_UNAVAILABLE = 'ROUTER_UNAVAILABLE';

/** True when this error means the routing service couldn't be reached or timed
 *  out — NOT that the two points are genuinely unconnected. */
export function isRouterUnavailable(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  // A timeout/abort is also "no answer": the leg may well be routable.
  return msg.includes(ROUTER_UNAVAILABLE) || name === 'AbortError' || msg.includes('Network request failed');
}

let inFlight = 0;
const waiting: (() => void)[] = [];

/** Acquire a slot, run `fn`, always release — even on throw. */
async function withLegSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= maxConcurrentLegs()) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}
/**
 * One profile per SAC ceiling — `hiking-t1` … `hiking-t6` — all derived from
 * stock hiking-beta by scripts/make-profiles.mjs, which documents every
 * difference (SAC floor, blocked proposed/construction, dearer cycleways, via
 * ferratas gated to T6).
 *
 * ⚠️ Both STOCK hiking profiles forbid any way tagged above SAC T3. That single
 * line — not missing map data — is why the GR20 and the Berliner Höhenweg were
 * once unroutable: their trails are in OSM (the Zillertal corridor has 11 ways
 * at T4, 7 at T5, 1 at T6, and the GR20's "Passerelle de Spasimata" is mapped by
 * name), but the profile refused to enter them, so the router went round the
 * mountain. Carozzu→Ascu-Stagnu measured 47.9 km for a 5.3 km stage.
 *
 * ⚠️ A ceiling only ever HIDES ground; it never makes it safe. Capping at T3 by
 * default meant the Adlerweg's stage 11 was reported as 32.3 km around instead
 * of 13.9 km over — an invented walk in place of the real one. So the ceiling is
 * the walker's own setting (`preferencesStore.maxSac`, default T6) rather than
 * something the app decides for them, and every leg carries a SAC badge so a
 * hard day is visible rather than silently routed around.
 */
const PROFILE_FOR_SAC = (i: number) => `hiking-t${i}`;

/**
 * Which walking profile to ask for — the walker's SAC ceiling, unless we're on
 * the public server.
 *
 * ⚠️ `hiking-t1` … `hiking-t6` are OURS. They are generated into a local BRouter
 * install by scripts/make-profiles.mjs and exist nowhere else, so brouter.de
 * answers HTTP 500 for all of them. Naming them unconditionally silently broke
 * the whole failover path the moment the tunnel to the local server dropped:
 * every leg failed, and the map drew straight dashed placeholder lines between
 * huts a few kilometres apart. Verified — brouter.de: hiking-beta 200, ours 500.
 *
 * On the public server we therefore ask for stock `hiking-beta`, which is what
 * ours derive from. The route is then slightly different — no SAC floor, cheaper
 * cycleways, via ferratas not blocked, and stock's own T3 ceiling regardless of
 * what the walker chose — but a slightly different route beats no route at all.
 */
function walkingProfile(maxSac: SacScale): string {
  if (onPublic()) return PUBLIC_FALLBACK_PROFILE;
  const i = SAC_SCALE_ORDER.indexOf(maxSac);
  // An unrecognised value would build a profile name BRouter doesn't have, and
  // every leg would 500. Fall back to the top of the scale instead.
  return PROFILE_FOR_SAC(i >= 0 ? i + 1 : SAC_SCALE_ORDER.length);
}

/** The best stock profile brouter.de actually serves. Ours derive from it. */
const PUBLIC_FALLBACK_PROFILE = 'hiking-beta';

/**
 * ⚠️ THE SCENIC PROFILE IS NO LONGER UPLOADED, AND THAT WAS A REAL BUG.
 *
 * It used to live here as a 25-line literal, POSTed to `${BROUTER_URL}/profile`
 * once per session, and routed via the returned `custom_…` id. That upload NEVER
 * WORKED against our server: `btools.server.RouteServer` answers HTTP 200 with a
 * body of `HTTP/1.1 500 Internal Server Error`, so `res.json()` threw, the
 * caller's `.catch` swallowed it, and scenic fell back to the ordinary walking
 * profile — the exact profile the non-scenic branch already used. Both branches
 * were identical. The toggle changed the React Query cache key and nothing else,
 * so it refetched and drew the same line, for the life of the feature.
 * (Confirmed it was the endpoint, not the profile text: uploading the stock
 * hiking-beta.brf unchanged fails the same way.)
 *
 * Scenic is now a real file per ceiling — `hiking-scenic-t1` … `-t6` — derived
 * in scripts/make-profiles.mjs from the same base as the walking profiles. That
 * matters beyond just working: it inherits the SAC machinery, so the walker's
 * difficulty ceiling still applies on a scenic route instead of being bypassed
 * by a hand-written profile that had no concept of it.
 */
function scenicProfile(maxSac: SacScale): string {
  // Same public-server caveat as `walkingProfile`: ours don't exist there.
  if (onPublic()) return PUBLIC_FALLBACK_PROFILE;
  const i = SAC_SCALE_ORDER.indexOf(maxSac);
  return `hiking-scenic-t${i >= 0 ? i + 1 : SAC_SCALE_ORDER.length}`;
}

interface BrouterGeoJSON {
  features?: {
    geometry: { coordinates: [number, number, number?][] };
    // `messages` is a CSV-style table: a header row, then one row per way
    // segment (WayTags, Distance, …). It's how we spot ferries below.
    properties: Record<string, string | number> & { messages?: string[][] };
  }[];
}

/** Identify ourselves to the public routing/OSM services, per their usage policy. */
const USER_AGENT = 'AlpineHutsApp/0.1 (hut-to-hut hiking route planner)';

/**
 * Metres of this route spent on a `route=ferry` way.
 *
 * BRouter's hiking profile will happily put you on a boat: a ferry across a lake
 * is short and direct, so it slips past the detour guard in `fetchLeg` and comes
 * back looking like a perfectly normal trail. Verified on Brienzersee —
 * `hiking-beta` returned 3.4 km of ferry for a 1.9 km crossing. We read
 * BRouter's own per-segment WayTags to detect it.
 */
function ferryMeters(messages: string[][] | undefined): number {
  if (!messages || messages.length < 2) return 0;
  const [header, ...rows] = messages;
  const wayIdx = header.indexOf('WayTags');
  const distIdx = header.indexOf('Distance');
  if (wayIdx < 0 || distIdx < 0) return 0;
  let total = 0;
  for (const row of rows) {
    if (/(^|\s)route=ferry(\s|$)/.test(row[wayIdx] ?? '')) {
      total += Number(row[distIdx]) || 0;
    }
  }
  return total;
}

/**
 * Metres of this route spent on a fast, high-traffic road.
 *
 * ⚠️ This CANNOT be a profile rule. A BRouter profile scores each way on its own
 * tags and has no running total, so it can express "roads are expensive" but not
 * "no more than a kilometre of road". Blocking the class outright isn't the
 * answer either — a short stretch of main road is often the only bridge over a
 * river or the only line through a gorge, and blocking it makes the whole leg
 * unroutable rather than merely ugly.
 *
 * So: allowed, heavily penalised in the profile (5–10× distance), and capped
 * here. Past the cap we stop claiming a walking route exists — presenting a
 * day that spends kilometres on a trunk road as a hike is the failure mode
 * worth avoiding.
 *
 * `_link` ways are counted too: slip roads are the same traffic.
 */
const FAST_ROAD_RE = /(^|\s)highway=(motorway|trunk|primary)(_link)?(\s|$)/;

function fastRoadMeters(messages: string[][] | undefined): number {
  if (!messages || messages.length < 2) return 0;
  const [header, ...rows] = messages;
  const wayIdx = header.indexOf('WayTags');
  const distIdx = header.indexOf('Distance');
  if (wayIdx < 0 || distIdx < 0) return 0;
  let total = 0;
  for (const row of rows) {
    if (FAST_ROAD_RE.test(row[wayIdx] ?? '')) total += Number(row[distIdx]) || 0;
  }
  return total;
}

/** Beyond this much fast road, it isn't a walking route any more. */
const MAX_FAST_ROAD_M = 1000;

function num(v: string | number | undefined): number {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

/** Great-circle distance in metres. */
function haversineMeters(a: LatLng, b: LatLng): number {
  return metresBetween(a.latitude, a.longitude, b.latitude, b.longitude);
}

/**
 * Compute the walking route between two points along real trails using
 * BRouter's foot-hiking profile. Returns the trail geometry plus distance and
 * elevation gain/loss. Throws when no route can be found so callers can fall
 * back (e.g. to a straight line) and surface the error.
 */
/** Abort after `ms`, or when the parent signal aborts. */
function withTimeout(ms: number, parent?: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const relay = () => {
    clearTimeout(timer);
    ctrl.abort();
  };
  if (parent) {
    if (parent.aborted) relay();
    else parent.addEventListener('abort', relay);
  }
  return ctrl.signal;
}

/**
 * Pairs already proven unwalkable this session, so we never pay for them twice.
 *
 * WHY: the Plan tab runs SEVERAL searches for one request — balanced, then a
 * "shorter" and a "longer" bias for the alternatives. Successful legs are shared
 * between them through react-query's cache, but FAILURES were not: every search
 * re-attempted the same impossible pairs and waited the full timeout on each.
 * With ~12 hopeless legs per search that's ~12 × LEG_TIMEOUT_MS of pure waiting,
 * repeated per search — the bulk of why generating alternatives felt as slow as
 * the first attempt.
 *
 * ⚠️ Only DEFINITIVE failures go in here: BRouter answering "no path" (island,
 * water, no trail), and timeouts — which measurement showed are deterministic,
 * the same pairs exceeding the limit on every run regardless of its value. A
 * `ROUTER_UNAVAILABLE` failure is NEVER cached: those are transient, and
 * remembering them would turn one dropped tunnel into a session where huts stay
 * permanently "unreachable".
 */
const unroutable = new Map<string, string>();

function legCacheKey(
  from: LatLng,
  to: LatLng,
  profile: string,
  via?: { lat: number; lon: number }[],
): string {
  const p = (n: number) => n.toFixed(5);
  // ⚠️ `via` MUST be in the key. Without it a leg routed with waypoints and the
  // same leg routed without them share one negative-cache entry, so a failure
  // on one silently condemns the other.
  const v = (via ?? []).map((x) => `${p(x.lat)},${p(x.lon)}`).join('|');
  return `${p(from.latitude)},${p(from.longitude)}|${p(to.latitude)},${p(to.longitude)}|${profile}${v ? '|via:' + v : ''}`;
}

export async function fetchLeg(
  from: LatLng,
  to: LatLng,
  signal?: AbortSignal,
  scenic = false,
  /** Routing-only waypoints, passed through in order. See `Hut.via`. */
  via?: { lat: number; lon: number }[],
  /**
   * Hardest SAC grade the router may use. Defaults to the walker's own setting;
   * pass it explicitly only to measure a specific ceiling (the check scripts do).
   */
  maxSac: SacScale = currentMaxSac(),
): Promise<RouteLeg> {
  const lonlats = [
    `${from.longitude},${from.latitude}`,
    ...(via ?? []).map((v) => `${v.lon},${v.lat}`),
    `${to.longitude},${to.latitude}`,
  ].join('|');
  const profile = scenic ? scenicProfile(maxSac) : walkingProfile(maxSac);
  const cacheKey = legCacheKey(from, to, profile, via);
  const known = unroutable.get(cacheKey);
  if (known) throw new Error(known);

  /**
   * ⚠️ BEFORE THE REQUEST, because the huts do not move. The path between two
   * refuges is the same walk it was last month, so a leg computed once is a
   * fact rather than a guess with a shelf life. Planning one trip asks for ~63
   * legs and the Plan tab runs several searches per request; react-query shares
   * those within a session, but closing the app used to throw all of it away.
   */
  const cached = await readCachedLeg(cacheKey);
  if (cached) return cached;

  const url = `${activeBase()}?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;

  // Per-leg timeout so a slow BRouter response can't hang the Route tab or the
  // route generator — it fails and the caller falls back / skips the candidate.
  // Gated + backed off: a 403 from BRouter is "you're going too fast", so it's
  // worth waiting out rather than reporting the leg as unroutable — which the
  // generator would read as "this hut can't be reached". See MAX_CONCURRENT_LEGS.
  let text = '';
  let status = 0;
  for (let attempt = 1; attempt <= RETRY_LATER_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await withLegSlot(() =>
        fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: withTimeout(LEG_TIMEOUT_MS, signal),
        }),
      );
    } catch (err) {
      // ⚠️ A refused/failed connection THROWS — it never returns a status — so
      // the failover check below would never see it. That's why pointing at a
      // dead server produced "fetch failed" instead of falling back. A timeout
      // is deliberately NOT treated as the server being down: with a 3 s leg
      // budget that's often just a hard leg.
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (aborted || signal?.aborted) throw err;
      status = 0;
      text = err instanceof Error ? err.message : String(err);
      break;
    }
    text = await res.text();
    status = res.status;
    if (res.ok) break;
    const throttled = res.status === 403 || res.status === 429;
    if (!throttled || attempt === RETRY_LATER_ATTEMPTS) break;
    await new Promise((r) => setTimeout(r, RETRY_LATER_BACKOFF_MS * attempt));
    if (signal?.aborted) break;
  }
  if (status < 200 || status >= 300) {
    // ⚠️ Distinguish "the router is unreachable/overloaded" from "these two huts
    // genuinely aren't connected by a trail". They are NOT the same thing, and
    // conflating them is how the app twice told the user "no route exists" when
    // the truth was that the routing server was down or throttling. A 4xx that
    // isn't 403 is BRouter answering (island detected, no path, bad request);
    // anything else means we never got a real answer.
    const unreachable = status === 0 || status === 403 || status === 429 || status >= 500;
    // Primary unreachable → mark it down and try the public server once. Only a
    // 5xx/0 counts: a 403/429 is throttling, and the public server is where
    // that comes FROM, so failing over on it would make things worse.
    const primaryFailed =
      !usingPublicServer() &&
      !onPublic() &&
      (status === 0 || status >= 500);
    if (primaryFailed) {
      primaryDownUntil = Date.now() + PRIMARY_RETRY_AFTER_MS;
      // ⚠️ MUST forward `via` and `maxSac`. This retry used to call
      // `fetchLeg(from, to, signal, scenic)` and silently drop both, so the
      // moment the primary hiccupped, every leg with waypoints was re-asked as a
      // DIFFERENT question: the plain A→B line, with no waypoints at all. Two
      // ways that bites. A leg that only routes through its waypoints — the
      // Besseggen ridge, where the two huts face each other across a lake and
      // the direct line lies on the water — comes back "unroutable" although the
      // trail is there. Worse, a leg that does route without them quietly draws
      // the valley the waypoints existed to avoid, and nothing anywhere says so.
      // `maxSac` matters for the same reason on T4–T6 ground.
      return fetchLeg(from, to, signal, scenic, via, maxSac);
    }
    const msg = `${unreachable ? ROUTER_UNAVAILABLE : 'Routing failed'} (${status}): ${text.slice(0, 120)}`;
    // Definitive 'no path here' answers are worth remembering; transient
    // service failures are not (see `unroutable`).
    if (!unreachable) unroutable.set(cacheKey, msg);
    throw new Error(msg);
  }

  let json: BrouterGeoJSON;
  try {
    json = JSON.parse(text);
  } catch {
    // BRouter returns a plain-text message when it can't route (e.g. a point
    // isn't near any path).
    { const m = `No trail route found: ${text.slice(0, 120)}`; unroutable.set(cacheKey, m); throw new Error(m); }
  }

  const feature = json.features?.[0];
  if (!feature || feature.geometry.coordinates.length < 2) {
    { const m = 'No trail route found between these huts'; unroutable.set(cacheKey, m); throw new Error(m); }
  }

  const coords = feature.geometry.coordinates;
  const coordinates: LatLng[] = coords.map(([lon, lat]) => ({
    latitude: lat,
    longitude: lon,
  }));

  const props = feature.properties;

  // This is a walking app — reject legs that would put you on a boat.
  if (ferryMeters(props.messages) > 0) {
    throw new Error(
      'No walking route — this leg would cross water by ferry (e.g. across a lake).',
    );
  }

  // Same treatment as the ferry check above: the router answered, but not with
  // something anyone would call a walk.
  const roadM = fastRoadMeters(props.messages);
  if (roadM > MAX_FAST_ROAD_M) {
    throw new Error(
      `No walking route — this leg would spend ${(roadM / 1000).toFixed(1)} km on ` +
        `a main road with fast traffic. There may be a path, but it isn’t mapped ` +
        `as one here.`,
    );
  }

  const distance = num(props['track-length']);

  // Guard against nonsense routes: when there's no trail the profile will take,
  // the router returns a huge detour (tens of km) rather than failing, and
  // showing that as a distance and a duration would be actively misleading.
  //
  // The 4× limit is measured, not guessed. Across 148 legs of the classic
  // routes the ratio is 1.64 median, 2.52 at p90 and 3.56 at p95, then breaks
  // sharply: the next values are 4.1, 4.6, 5.7, 7.8, 10.9 and 15.4. Every leg
  // above 4× is a known-bad one (the GR20's Cirque de la Solitude section, the
  // Berliner Höhenweg's Schönbichler Horn); everything below is a real day's
  // walk. Raising it to 3.5× would start catching legitimate col crossings.
  //
  // ⚠️ The message must NOT claim to know why. It used to say the huts were
  // "likely separated by glaciated or alpine terrain", which is a guess and is
  // wrong for the Berliner Höhenweg — there is a well-trodden trail there, the
  // profile just won't route it. Stating a cause we haven't established sends
  // people looking in the wrong place.
  const straight = haversineMeters(from, to);
  if (straight > 300 && distance > straight * 4) {
    const ratio = (distance / straight).toFixed(1);
    throw new Error(
      `No usable route found: the best line is ${ratio}× the direct distance ` +
        `(${(distance / 1000).toFixed(1)} km for ${(straight / 1000).toFixed(1)} km apart), ` +
        `so it is a detour rather than the trail. There may still be a path — ` +
        `it may be missing from the map data, or too exposed for the hiking profile.`,
    );
  }
  const ascent = num(props['filtered ascend']);

  // BRouter gives ascent but not descent; derive it from the net elevation
  // change so gain/loss stay mutually consistent.
  const startEle = coords[0][2] ?? 0;
  const endEle = coords[coords.length - 1][2] ?? 0;
  const descent = Math.max(0, ascent - (endEle - startEle));

  const sacScale = hardestSacScale(props.messages);

  // Time comes from the full elevation profile, then scales with HOW MUCH of
  // the leg is T4+ ground — not with its hardest grade. See sacTimeFactor.
  const duration = Math.round(
    estimateHikeTime(coords) * sacTimeFactor(hardSacShare(props.messages)),
  );

  const viaFerrata = hardestViaFerrata(props.messages);

  // NB: named elevationProfile, not profile — fetchLeg already has a `profile`
  // holding the BRouter PROFILE NAME, and shadowing it silently put a string
  // into this field.
  const elevationProfile = buildElevationProfile(coords);

  const leg: RouteLeg = {
    coordinates,
    distance,
    ascent,
    descent,
    duration,
    sacScale,
    viaFerrata,
    ...(elevationProfile.length ? { profile: elevationProfile } : {}),
  };

  // Keep it for next time. Deliberately not awaited: the walker is waiting on
  // this leg, and a disk write must not be in front of it. A failed write is a
  // slower app, never a broken one — see legCache.ts.
  void writeCachedLeg(cacheKey, leg);

  return leg;
}

// ── Rides (lifts / mountain trains) ─────────────────────────────────────────

/** Rough ride time in seconds: horizontal span at a mode-typical speed, plus a
 *  fixed boarding/wait allowance. It only feeds the day's "est. time", so an
 *  approximation is fine. */
function rideDuration(mode: RideMode, span: number): number {
  const speed = mode === 'train' ? 8 : mode === 'funicular' ? 4 : 5; // m/s
  return Math.round(span / speed) + 300;
}

/** A zero-length leg at a single point — used when a station effectively
 *  coincides with the hut, so there's nothing to walk (and BRouter would reject
 *  a from==to request). */
function emptyLeg(at: LatLng): RouteLeg {
  return { coordinates: [at], distance: 0, ascent: 0, descent: 0, duration: 0 };
}

/** Below this walking distance to/from a station, skip the walk (and its BRouter
 *  call): the hut is essentially at the station. */
const STATION_SNAP_M = 60;

/**
 * Stitch two walking legs and the ride between them into one composite day leg.
 * The ride contributes **no** hiking distance and **no** ascent/descent (that's
 * the whole point — you skip the climb); it only adds ride time and the dashed
 * connector on the map. `segments` lets the map style each piece; `coordinates`
 * is the concatenation for framing.
 */
export function combineRideLeg(
  walk1: RouteLeg,
  walk2: RouteLeg,
  ride: RideUse,
): RouteLeg {
  const span = haversineMeters(ride.enter, ride.exit);
  const rideCoords = [ride.enter, ride.exit];
  const segments: LegSegment[] = [];
  if (walk1.coordinates.length > 1)
    segments.push({ mode: 'walk', coordinates: walk1.coordinates });
  segments.push({ mode: ride.mode, coordinates: rideCoords, name: ride.name });
  if (walk2.coordinates.length > 1)
    segments.push({ mode: 'walk', coordinates: walk2.coordinates });

  return {
    coordinates: [...walk1.coordinates, ...rideCoords, ...walk2.coordinates],
    distance: walk1.distance + walk2.distance,
    ascent: walk1.ascent + walk2.ascent,
    descent: walk1.descent + walk2.descent,
    duration: walk1.duration + walk2.duration + rideDuration(ride.mode, span),
    segments,
    ride,
    // The ride itself has no walking difficulty — just the harder of the two
    // walk approaches either side of it.
    sacScale: combineSacScale(walk1.sacScale, walk2.sacScale),
    // ⚠️ Stitch the two walks' profiles or a leg that uses a lift has NO height
    // chart at all — the two halves each carry their own, measured from their
    // own zero, so the second has to be shifted along by the first's distance.
    // The ride is skipped rather than drawn: you don't climb it, and joining
    // the two ends would draw a line implying you walked it.
    profile: joinProfiles(walk1.profile, walk2.profile, walk1.distance),
  };
}

/**
 * Concatenate two legs' height profiles, offsetting the second by `offsetM`.
 *
 * Returns undefined when neither half has one, so the chart shows its "no height
 * data" state rather than a half-drawn line.
 */
function joinProfiles(
  a: number[] | undefined,
  b: number[] | undefined,
  offsetM: number,
): number[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  const out: number[] = [];
  if (a?.length) out.push(...a);
  // ⚠️ Offset by where the FIRST PROFILE ACTUALLY ENDS, not by `walk1.distance`.
  // They differ by a metre or two (the profile is resampled and rounded), and
  // the chart detects the ride by finding two samples at the SAME distance —
  // so an off-by-one here would turn the lift into a very steep slope instead
  // of the vertical it should be.
  const joinAt = a?.length ? a[a.length - 2] : Math.round(offsetM);
  if (b?.length) {
    for (let i = 0; i < b.length; i += 2) {
      out.push(Math.round(b[i]) + joinAt, b[i + 1]);
    }
  }
  return out;
}

/**
 * Route a day that uses a ride: walk from `from` to the boarding station, ride
 * (free), then walk from the alighting station to `to`. Either walk is skipped
 * when the hut is essentially at the station. Used by the Map/Route tabs to
 * redraw exactly the geometry the generator planned.
 */
export async function fetchLegWithRide(
  from: LatLng,
  to: LatLng,
  ride: RideUse,
  signal?: AbortSignal,
  scenic = false,
  /** Same ceiling as a plain leg — the walking halves either side of the ride
   *  are ordinary walking and must obey the walker's setting. */
  maxSac: SacScale = currentMaxSac(),
): Promise<RouteLeg> {
  const [walk1, walk2] = await Promise.all([
    haversineMeters(from, ride.enter) < STATION_SNAP_M
      ? Promise.resolve(emptyLeg(ride.enter))
      : fetchLeg(from, ride.enter, signal, scenic, undefined, maxSac),
    haversineMeters(ride.exit, to) < STATION_SNAP_M
      ? Promise.resolve(emptyLeg(ride.exit))
      : fetchLeg(ride.exit, to, signal, scenic, undefined, maxSac),
  ]);
  return combineRideLeg(walk1, walk2, ride);
}
