import type { LatLng } from './brouter';
import { speedAtSlope } from '../utils/hikeTime';

/**
 * Everything needed to walk one day from the screen alone: which waymarked
 * routes to follow, and the named points you pass, in order.
 *
 * ⚠️ NONE of this comes from the routing engine. BRouter's way tags say only
 * whether a path belongs to a walking network (`route_hiking_lwn` / `nwn`) — its
 * lookup table collapses each route relation to a boolean, discarding the `ref`
 * and name that are the very things printed on a signpost. And it returns no
 * POIs at all. So both halves are asked of OSM directly, in one request.
 */

/** A signposted route covering (part of) the day. */
export interface WaymarkedRoute {
  id: string;
  /** The number on the signpost ("1", "36") — many local routes have none. */
  ref?: string;
  name?: string;
  /** iwn / nwn / rwn / lwn — international…local. */
  network?: string;
}

/** A named point you pass, with how far into the day it is. */
export interface LegWaypoint {
  id: string;
  name: string;
  /** Metres from the start of the day. */
  atMeters: number;
  /** Where it actually is — so the day's map can show it, not just the list. */
  lat: number;
  lon: number;
  elevation?: number;
  kind: 'guidepost' | 'pass' | 'hut' | 'place' | 'viewpoint';
  /** Estimated minutes of walking from the start, including the break
   *  allowance — same model as the leg's own time. */
  minutes?: number;
}

export interface LegGuide {
  routes: WaymarkedRoute[];
  waypoints: LegWaypoint[];
}

const OVERPASS = 'https://overpass-api.de/api/interpreter';
/** Metres from the line a POI may sit and still count as "on the way". Wide
 *  enough for a signpost set back from the path, tight enough to exclude the
 *  parallel valley trail. */
const ON_ROUTE_M = 45;
/** Points along the line used to find the ways (and so the route relations). */
const ROUTE_SAMPLES = 10;
/** Degrees of padding on the bounding box used for POIs. */
const BBOX_PAD = 0.004;

const BREAK_FACTOR = 1 + 5 / 30;
/** Most-official routes to show; more than this is noise at a signpost. */
const MAX_ROUTES = 4;
/** A waypoint this close to either end IS the start/finish — see the note in
 *  fetchLegGuide about MapKit suppressing overlapping annotations. */
const ENDPOINT_CLEARANCE_M = 80;

function metresBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dy = (aLat - bLat) * 111_320;
  const dx = (aLon - bLon) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

function classify(t: Record<string, string>): LegWaypoint['kind'] | null {
  if (t.mountain_pass === 'yes' || t.natural === 'saddle') return 'pass';
  if (t.tourism === 'alpine_hut' || t.tourism === 'wilderness_hut') return 'hut';
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.information === 'guidepost') return 'guidepost';
  if (t.place) return 'place';
  return null;
}

/**
 * Fetch the day's guide. Throws on network failure — the caller must say "needs
 * a connection" rather than render an empty list, which would wrongly imply the
 * day is unwaymarked and passes nothing.
 */
export async function fetchLegGuide(
  coords: LatLng[],
  /** The day's start/finish altitudes, used to anchor the running times to the
   *  START of the day. Without them the clock began at the first waypoint —
   *  Bundalp→Blüemlisalphütte showed its 3.3 km pass as the zero point and the
   *  hut 8 minutes later, which reads as nonsense. */
  ends: { startEle?: number; endEle?: number } = {},
  signal?: AbortSignal,
): Promise<LegGuide> {
  if (coords.length < 2) return { routes: [], waypoints: [] };

  const lats = coords.map((c) => c.latitude);
  const lons = coords.map((c) => c.longitude);
  const bbox = [
    Math.min(...lats) - BBOX_PAD,
    Math.min(...lons) - BBOX_PAD,
    Math.max(...lats) + BBOX_PAD,
    Math.max(...lons) + BBOX_PAD,
  ]
    .map((n) => n.toFixed(5))
    .join(',');

  const step = (coords.length - 1) / (ROUTE_SAMPLES - 1);
  const near = Array.from({ length: ROUTE_SAMPLES }, (_, i) => coords[Math.round(i * step)])
    .map(
      (c) =>
        `way(around:25,${c.latitude.toFixed(5)},${c.longitude.toFixed(5)})[highway];`,
    )
    .join('');

  // One request, two answers: POI nodes in the bbox, and the hiking relations
  // the route's own ways belong to. `out;` (not `out tags;`) on the nodes —
  // `out tags` omits coordinates, which silently drops every waypoint.
  const query =
    `[out:json][timeout:60];` +
    `(node(${bbox})[information=guidepost];` +
    `node(${bbox})[natural=saddle];` +
    `node(${bbox})[mountain_pass=yes];` +
    `node(${bbox})[place~"^(hamlet|village|isolated_dwelling)$"];` +
    `node(${bbox})[tourism~"^(alpine_hut|wilderness_hut|viewpoint)$"];);out;` +
    `(${near})->.w;rel(bw.w)[route=hiking];out tags;`;

  const res = await fetch(`${OVERPASS}?data=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'alpine-huts/1.0 (hut-to-hut planner)' },
    signal,
  });
  if (!res.ok) throw new Error(`Trail guide lookup failed (${res.status})`);
  const data = (await res.json()) as {
    elements?: {
      type: string;
      id: number;
      lat?: number;
      lon?: number;
      tags?: Record<string, string>;
    }[];
  };

  // Cumulative distance along the day, so a POI can be placed on it.
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(
      cum[i - 1] +
        metresBetween(
          coords[i - 1].latitude,
          coords[i - 1].longitude,
          coords[i].latitude,
          coords[i].longitude,
        ),
    );
  }

  const routes: WaymarkedRoute[] = [];
  const seenRoute = new Set<string>();
  const waypoints: LegWaypoint[] = [];

  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === 'relation') {
      if (!t.ref && !t.name) continue; // nothing a walker could follow
      const key = `${t.ref ?? ''}|${t.name ?? ''}`;
      if (seenRoute.has(key)) continue;
      seenRoute.add(key);
      routes.push({ id: String(el.id), ref: t.ref, name: t.name, network: t.network });
      continue;
    }
    if (el.lat == null || el.lon == null) continue;
    const kind = classify(t);
    if (!kind) continue;
    // An unnamed guidepost tells you nothing you can't already see. Passes and
    // huts are worth listing regardless — they're landmarks.
    if (!t.name && kind !== 'pass' && kind !== 'hut') continue;

    let best = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < coords.length; i++) {
      const d = metresBetween(el.lat, el.lon, coords[i].latitude, coords[i].longitude);
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    }
    if (best > ON_ROUTE_M) continue;
    waypoints.push({
      id: `${el.type}/${el.id}`,
      name: t.name ?? (kind === 'pass' ? 'Pass' : 'Hut'),
      atMeters: cum[bestIdx],
      lat: el.lat,
      lon: el.lon,
      elevation: t.ele ? Number(t.ele) : undefined,
      kind,
    });
  }

  waypoints.sort((a, b) => a.atMeters - b.atMeters);

  // ⚠️ Drop anything sitting on the start or the finish. Those two already have
  // their own named row and their own map pin, so a coincident waypoint is a
  // duplicate in the list AND an overlapping annotation on the map — and MapKit
  // resolves overlaps by SUPPRESSING one of the pair, with the winner changing
  // as you zoom. That's what made the day's start/end pins blink out.
  const total = cum[cum.length - 1];
  const atEnds = (w: LegWaypoint) =>
    w.atMeters < ENDPOINT_CLEARANCE_M || total - w.atMeters < ENDPOINT_CLEARANCE_M;
  const inner = waypoints.filter((w) => !atEnds(w));

  // Collapse duplicates: a pass usually carries a saddle node AND a guidepost
  // with the same name a few metres apart, which would read as two stops.
  const merged: LegWaypoint[] = [];
  for (const w of inner) {
    const prev = merged[merged.length - 1];
    if (prev && prev.name === w.name && w.atMeters - prev.atMeters < 150) {
      // Prefer the more informative classification, and keep any elevation.
      if (prev.kind === 'guidepost' && w.kind !== 'guidepost') prev.kind = w.kind;
      prev.elevation = prev.elevation ?? w.elevation;
      continue;
    }
    merged.push(w);
  }

  addTimings(merged, cum[cum.length - 1], ends);

  const rank: Record<string, number> = { iwn: 0, nwn: 1, rwn: 2, lwn: 3 };
  routes.sort((a, b) => (rank[a.network ?? ''] ?? 9) - (rank[b.network ?? ''] ?? 9));

  // Keep the most official few. A day can touch a dozen local path relations;
  // listing them all buries the one sign you actually look for.
  return { routes: routes.slice(0, MAX_ROUTES), waypoints: merged };
}

/**
 * Running time to each waypoint, using the SAME gradient model as the leg's own
 * estimate so the numbers agree with the day total shown above them.
 *
 * Elevation comes from the waypoints' own `ele` tags; gaps are linearly
 * interpolated between the ones we do know. Waypoints before the first known
 * elevation get no time rather than a fabricated one.
 */
function addTimings(
  points: LegWaypoint[],
  totalMeters: number,
  ends: { startEle?: number; endEle?: number },
): void {
  // Virtual endpoints so every time is measured from the day's start.
  const seq: { atMeters: number; elevation?: number; target?: LegWaypoint }[] = [
    { atMeters: 0, elevation: ends.startEle },
    ...points.map((p) => ({ atMeters: p.atMeters, elevation: p.elevation, target: p })),
    { atMeters: totalMeters, elevation: ends.endEle },
  ];
  const known = seq
    .map((p, i) => ({ i, e: p.elevation }))
    .filter((p): p is { i: number; e: number } => p.e != null);
  if (known.length < 2) return;
  const points_ = seq;

  const eleAt = (i: number): number | undefined => {
    const p = points_[i];
    if (p.elevation != null) return p.elevation;
    const before = [...known].reverse().find((k) => k.i < i);
    const after = known.find((k) => k.i > i);
    if (!before || !after) return undefined;
    const span = points_[after.i].atMeters - points_[before.i].atMeters;
    if (span <= 0) return before.e;
    const f = (p.atMeters - points_[before.i].atMeters) / span;
    return before.e + (after.e - before.e) * f;
  };

  let minutes = 0;
  for (let i = 1; i < points_.length; i++) {
    const dx = points_[i].atMeters - points_[i - 1].atMeters;
    const a = eleAt(i - 1);
    const b = eleAt(i);
    if (dx <= 0 || a == null || b == null) continue;
    const speed = speedAtSlope((b - a) / dx);
    minutes += (dx / 1000 / speed) * 60 * BREAK_FACTOR;
    if (points_[i].target) points_[i].target!.minutes = Math.round(minutes);
  }
}
