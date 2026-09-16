import type { BBox } from '../constants/region';
import type { Ride, RideMode } from '../types/ride';
import type { LatLng } from './brouter';
import { fetchElevations } from './elevation';

/**
 * Fetches the mechanised transport a hiker can use to skip part of a trail:
 * aerial lifts (cable cars, gondolas, chairlifts), funiculars, and scenic
 * mountain railways. Each becomes a `Ride` edge between two stations. The
 * generator (`planRoute`) may route a day *through* one of these — you walk to a
 * station, ride (free ascent, no hiking distance), and walk on — which is what
 * lets a low-ascent day reach an otherwise-too-high hut.
 *
 * Data sources (all keyless Overpass, same policy as `overpass.ts`):
 *  • aerialways  — `aerialway=cable_car|gondola|mixed_lift|chair_lift` ways.
 *  • funiculars  — `railway=funicular` ways.
 *  • mountain trains — `route=train` relations, minus valley mainline (dropped by
 *    `service=long_distance` and an elevation gate), turned into station edges.
 */

// GLOBAL mirrors only — see the same note in `overpass.ts`: the Swiss-only
// overpass.osm.ch silently returns empty for non-CH regions.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const USER_AGENT = 'AlpineHutsApp/0.1 (hut-to-hut hiking route planner)';

/** A railway line is only counted as a *mountain* (scenic) train if one of its
 *  stations reaches this height — keeps Wengernalpbahn (2064 m), Schynige Platte
 *  (1987 m), Jungfraubahn (3481 m) and BLM (1653 m) while dropping the valley
 *  mainline: the BOB (~1034 m), the BLS Lötschberg line (~1220 m) and the low
 *  Matterhorn-Gotthard branches (~1254 m) all fall below it. */
const TRAIN_ELE_MIN = 1400;

interface GeomNode {
  lat: number;
  lon: number;
}
interface OverpassWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: GeomNode[];
}
interface RelMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role?: string;
  lat?: number;
  lon?: number;
}
interface OverpassRelation {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members?: RelMember[];
}
type OverpassElement = OverpassWay | OverpassRelation | { type: string };

/** Abort after `ms`, or when the parent signal aborts, whichever comes first. */
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

/** POST an Overpass query, trying each mirror until one answers. */
async function overpassGeom(
  query: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<OverpassElement[]> {
  const body = `data=${encodeURIComponent(query)}`;
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body,
        signal: withTimeout(timeoutMs, signal),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status} at ${endpoint}`);
      return ((await res.json()) as { elements: OverpassElement[] }).elements;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new Error('Overpass unreachable');
}

function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const key4 = (p: LatLng) =>
  `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;

function aerialwayMode(tags: Record<string, string>): RideMode | null {
  switch (tags.aerialway) {
    case 'gondola':
    case 'mixed_lift':
      return 'gondola';
    case 'cable_car':
      return 'cable_car';
    case 'chair_lift':
      return 'chair_lift';
    default:
      return null;
  }
}

/**
 * Turn a set of aerialway/funicular ways into one ride edge per named lift. A
 * lift is often mapped as several segments (Grindelwald→Holenstein→Männlichen);
 * grouping by name and taking the two *farthest-apart* endpoints reconstructs
 * the whole base→top ride.
 */
function liftEdges(
  ways: OverpassWay[],
  mode: (tags: Record<string, string>) => RideMode | null,
  opts: { minSpan: number; dropName?: RegExp },
): Ride[] {
  const groups = new Map<
    string,
    { name: string; mode: RideMode; pts: LatLng[] }
  >();
  for (const w of ways) {
    const tags = w.tags ?? {};
    const name = (tags.name || tags['name:de'] || '').trim();
    if (!name || (opts.dropName && opts.dropName.test(name))) continue;
    const m = mode(tags);
    const g = w.geometry;
    if (!m || !g || g.length < 2) continue;
    const first = { latitude: g[0].lat, longitude: g[0].lon };
    const last = { latitude: g[g.length - 1].lat, longitude: g[g.length - 1].lon };
    const k = `${m}|${name}`;
    const grp = groups.get(k) ?? { name, mode: m, pts: [] };
    grp.pts.push(first, last);
    groups.set(k, grp);
  }

  const out: Ride[] = [];
  for (const [k, grp] of groups) {
    let best = { d: 0, a: grp.pts[0], b: grp.pts[0] };
    for (let i = 0; i < grp.pts.length; i++) {
      for (let j = i + 1; j < grp.pts.length; j++) {
        const d = haversineM(grp.pts[i], grp.pts[j]);
        if (d > best.d) best = { d, a: grp.pts[i], b: grp.pts[j] };
      }
    }
    if (best.d < opts.minSpan) continue;
    out.push({ id: `lift/${k}`, name: grp.name, mode: grp.mode, a: best.a, b: best.b });
  }
  return out;
}

/** OSM tags `operator` with the line's own abbreviation for several Bernese
 *  Oberland mountain railways rather than a spelled-out name — expand the ones
 *  a hiker would actually recognise, so the ride reads as a real, findable line
 *  rather than a cryptic code. */
const OPERATOR_NAMES: Record<string, string> = {
  WAB: 'Wengernalpbahn',
  JB: 'Jungfraubahn',
  BLM: 'Bergbahn Lauterbrunnen–Mürren',
};

/** `tags.name` is built from the real service designator, e.g.
 *  "R 311: Kleine Scheidegg => Lauterbrunnen" or "Zug 68: …" — this captures
 *  that designator ("R 311" / "Zug 68") exactly as posted on the station board. */
const LINE_PREFIX_RE = /^([A-Za-z]+\s*\d+[a-z]?):\s*/;

/** Friendly label for a train line: prefer the operator (e.g. "Wengernalpbahn")
 *  over the operational name, and expand known abbreviations (`OPERATOR_NAMES`). */
function trainName(tags: Record<string, string>): string {
  if (tags.operator) {
    const op = tags.operator.replace(/\s+AG$/i, '').trim();
    return OPERATOR_NAMES[op] ?? op;
  }
  const n = tags.name ?? 'Mountain train';
  return n.replace(LINE_PREFIX_RE, '').trim() || 'Mountain train';
}

/** The line's posted number/designator ("R 311", "Zug 68") — the same text a
 *  rider would look for at the station, so they can actually find the train. */
function trainRef(tags: Record<string, string>): string | undefined {
  return tags.name?.match(LINE_PREFIX_RE)?.[1].trim() ?? tags.ref?.trim();
}

interface TrainLine {
  name: string;
  ref?: string;
  stops: LatLng[];
}

/** Ordered stops of every non-mainline `route=train` relation. */
function trainLines(rels: OverpassRelation[]): TrainLine[] {
  const lines: TrainLine[] = [];
  for (const r of rels) {
    const tags = r.tags ?? {};
    if (tags.service === 'long_distance') continue; // IC/IR mainline
    const stops: LatLng[] = [];
    for (const m of r.members ?? []) {
      if (
        m.type === 'node' &&
        /^stop/.test(m.role ?? '') &&
        m.lat != null &&
        m.lon != null
      ) {
        stops.push({ latitude: m.lat, longitude: m.lon });
      }
    }
    if (stops.length >= 2)
      lines.push({ name: trainName(tags), ref: trainRef(tags), stops });
  }
  return lines;
}

/**
 * Gate train lines by elevation (DEM), then expand each kept line into ride
 * edges between every pair of its stations (so a day can board and alight at any
 * two stops). Dedup across the two travel directions / overlapping lines.
 */
async function buildTrainEdges(
  lines: TrainLine[],
  signal?: AbortSignal,
): Promise<Ride[]> {
  if (lines.length === 0) return [];

  const uniq = new Map<string, LatLng>();
  for (const l of lines) for (const s of l.stops) uniq.set(key4(s), s);
  const pts = [...uniq.values()];

  let eles: (number | null)[] = [];
  try {
    eles = await fetchElevations(
      pts.map((p) => ({ lat: p.latitude, lon: p.longitude })),
      signal,
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    // A spent DEM quota must NOT be swallowed here. Without elevations every
    // line fails the `TRAIN_ELE_MIN` gate, so the region would look like it
    // genuinely has no mountain railways — and the generator would cache that
    // as the answer and never ask again. Propagate so the run ends PARTIAL and
    // resumes when the quota recovers (see scripts/generate-huts.ts).
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('ELEVATION_QUOTA')) throw err;
    eles = [];
  }
  const eleByKey = new Map<string, number>();
  pts.forEach((p, i) => {
    const e = eles[i];
    if (e != null) eleByKey.set(key4(p), e);
  });

  const edges = new Map<string, Ride>();
  for (const l of lines) {
    const stops = l.stops.slice(0, 12);
    const maxEle = Math.max(0, ...stops.map((s) => eleByKey.get(key4(s)) ?? 0));
    if (maxEle < TRAIN_ELE_MIN) continue; // valley line — skip
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const a = stops[i];
        const b = stops[j];
        if (haversineM(a, b) < 400) continue;
        const id = `train/${key4(a)}/${key4(b)}`;
        if (!edges.has(id))
          edges.set(id, { id, name: l.name, ref: l.ref, mode: 'train', a, b });
      }
    }
  }
  return [...edges.values()];
}

/**
 * All rides available in the region. Each Overpass call is independent and
 * non-fatal: a partial result (e.g. lifts but no trains, if a mirror is slow) is
 * fine — the generator just has fewer options. Returns [] only if everything
 * failed. Meant to be cached (react-query, staleTime ~1 h) like the hut queries.
 */
export async function fetchRides(
  box: BBox,
  signal?: AbortSignal,
): Promise<Ride[]> {
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;
  const rides: Ride[] = [];

  try {
    const els = await overpassGeom(
      `[out:json][timeout:90];(way["aerialway"~"^(cable_car|gondola|mixed_lift|chair_lift)$"](${bbox}););out geom tags;`,
      signal,
      60000,
    );
    rides.push(...liftEdges(els as OverpassWay[], aerialwayMode, { minSpan: 150 }));
  } catch (err) {
    if (signal?.aborted) throw err;
  }

  try {
    const els = await overpassGeom(
      `[out:json][timeout:90];(way["railway"="funicular"](${bbox}););out geom tags;`,
      signal,
      60000,
    );
    rides.push(
      ...liftEdges(els as OverpassWay[], () => 'funicular', {
        minSpan: 200,
        // Industrial/private inclines and disabled-access lifts aren't rides.
        dropName: /schräglift|behinderten|material|kwo|erlenbahn/i,
      }),
    );
  } catch (err) {
    if (signal?.aborted) throw err;
  }

  try {
    const els = await overpassGeom(
      `[out:json][timeout:120];(relation["route"="train"](${bbox}););out geom;`,
      signal,
      90000,
    );
    rides.push(...(await buildTrainEdges(trainLines(els as OverpassRelation[]), signal)));
  } catch (err) {
    if (signal?.aborted) throw err;
  }

  const byId = new Map(rides.map((r) => [r.id, r]));
  return [...byId.values()];
}
