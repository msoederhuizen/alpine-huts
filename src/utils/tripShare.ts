/**
 * Turning a saved trip into something that can be handed to someone else, and
 * — much more carefully — turning what they hand back into a trip.
 *
 * ⚠️ EVERYTHING COMING IN HERE WAS WRITTEN BY A STRANGER. A shared route is the
 * first thing in this app that arrives from another user and is then LOADED, not
 * merely displayed: it becomes huts on the map, a line to walk, and links the
 * app will open. The server stores the payload verbatim and never looks inside
 * it, which is the right call for compatibility and means every check has to
 * happen in this file.
 *
 * ⚠️ THE URLS ARE THE SHARP EDGE. A hut carries `website`, `bookingUrl` and
 * friends, and the app hands those to `Linking.openURL`. A payload with
 * `javascript:` or a custom scheme in one of them turns "open my friend's walk"
 * into "tap this and something else happens". So a URL that is not plainly http
 * or https is dropped rather than repaired — a hut with no website is a small
 * loss, a hut with somebody else's scheme is not.
 *
 * ⚠️ AND NOTHING UNRECOGNISED SURVIVES. This builds a new object field by field
 * instead of spreading what arrived, so a payload carrying extra keys cannot
 * smuggle them into the store. The caps below are about the same thing from the
 * other side: a route with 4,000 huts or a leg with a million coordinates is
 * not a trip, it is a way to lock up a phone.
 */
import type { LatLng } from '../api/brouter';
import type { Hut, HutType } from '../types/hut';
import type { LegSegment, RideMode, RideUse } from '../types/ride';
import type { SavedTrip } from '../store/savedTripsStore';
import type { PackedLeg, PackedSegment } from './packLeg';

/** Bumped only if the shape stops being readable by an older app. */
const VERSION = 1;

const MAX_HUTS = 80;
const MAX_COORDS = 60_000; // flat numbers, so 30,000 points — a very long day
const MAX_TAGS = 60;
const MAX_TAG_LEN = 300;
const MAX_VIA = 40;

const HUT_TYPES: HutType[] = ['alpine_hut', 'wilderness_hut', 'shelter', 'guesthouse', 'village'];
const RIDE_MODES: RideMode[] = ['gondola', 'cable_car', 'chair_lift', 'funicular', 'train'];
/** A drawn segment can also be the walking half of a walk-ride-walk leg. */
const SEGMENT_MODES: LegSegment['mode'][] = ['walk', ...RIDE_MODES];

export interface SharePayload {
  v: number;
  trip: {
    name: string;
    huts: Hut[];
    scenic: boolean;
    rides?: (RideUse | null)[];
    legs?: PackedLeg[];
  };
}

// ── outgoing ────────────────────────────────────────────────────────────────

/**
 * Prepare a trip for sharing.
 *
 * `withGeometry: false` drops the routed legs — the one part that can be
 * hundreds of kilobytes. The recipient's app then routes the trip itself on
 * first open, exactly as a trip saved before geometry existed does. The caller
 * uses it as the retry when the full payload is refused for size.
 */
export function toSharePayload(trip: SavedTrip, withGeometry = true): SharePayload {
  return {
    v: VERSION,
    trip: {
      name: trip.name,
      huts: trip.huts,
      scenic: trip.scenic ?? false,
      ...(trip.rides?.some(Boolean) ? { rides: trip.rides } : {}),
      ...(withGeometry && trip.legs ? { legs: trip.legs } : {}),
    },
  };
}

// ── incoming ────────────────────────────────────────────────────────────────

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

function num(v: unknown, lo: number, hi: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return undefined;
  return v;
}

/**
 * A link the app may hand to the operating system, or nothing.
 *
 * ⚠️ AN ALLOWLIST, NOT A BLOCKLIST. `javascript:`, `file:`, `intent:` and every
 * app's own scheme are all things a URL could say; naming the two that are
 * acceptable is the only version of this check that stays correct as schemes
 * are invented.
 */
function url(v: unknown): string | undefined {
  const s = str(v, 500);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : undefined;
  } catch {
    return undefined;
  }
}

function tags(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_TAGS) break;
    if (typeof val !== 'string') continue;
    out[k.slice(0, 80)] = val.slice(0, MAX_TAG_LEN);
    n++;
  }
  return out;
}

function hut(v: unknown): Hut | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id, 80);
  const lat = num(r.lat, -90, 90);
  const lon = num(r.lon, -180, 180);
  if (!id || lat === undefined || lon === undefined) return null;
  const type = HUT_TYPES.includes(r.type as HutType) ? (r.type as HutType) : 'alpine_hut';

  const via = Array.isArray(r.via)
    ? r.via
        .slice(0, MAX_VIA)
        .map((p) => {
          const o = p as Record<string, unknown>;
          const la = num(o?.lat, -90, 90);
          const lo = num(o?.lon, -180, 180);
          return la !== undefined && lo !== undefined ? { lat: la, lon: lo } : null;
        })
        .filter((p): p is { lat: number; lon: number } => p !== null)
    : undefined;

  return {
    id,
    name: str(r.name, 200) ?? 'Unnamed',
    lat,
    lon,
    elevation: num(r.elevation, -500, 9000),
    type,
    image: url(r.image),
    wikimediaCommons: str(r.wikimediaCommons, 300),
    website: url(r.website),
    reservationWebsite: url(r.reservationWebsite),
    wikidata: str(r.wikidata, 40),
    wikipedia: str(r.wikipedia, 300),
    // Non-optional on the type, and it is a link the app opens, so a payload
    // without a usable one gets an empty string rather than whatever arrived.
    bookingUrl: url(r.bookingUrl) ?? '',
    ...(via?.length ? { via } : {}),
    tags: tags(r.tags),
  };
}

function coords(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length % 2 !== 0 || v.length > MAX_COORDS) return null;
  const out: number[] = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const n = num(v[i], i % 2 === 0 ? -90 : -180, i % 2 === 0 ? 90 : 180);
    if (n === undefined) return null;
    out[i] = n;
  }
  return out;
}

function latlng(v: unknown): LatLng | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const la = num(o.latitude, -90, 90);
  const lo = num(o.longitude, -180, 180);
  return la !== undefined && lo !== undefined ? { latitude: la, longitude: lo } : undefined;
}

/**
 * ⚠️ REBUILT FIELD BY FIELD, NOT CAST. This used to check the mode and then
 * return the incoming object as a RideUse, which tells TypeScript the shape is
 * right without any of it having been looked at — the two stations especially,
 * which get drawn on the map and would take the line anywhere a stranger liked.
 */
function ride(v: unknown): RideUse | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const id = str(r.id, 120);
  const mode = str(r.mode, 40) as RideMode | undefined;
  const enter = latlng(r.enter);
  const exit = latlng(r.exit);
  if (!id || !mode || !RIDE_MODES.includes(mode) || !enter || !exit) return undefined;
  return { id, name: str(r.name, 160) ?? 'Lift', mode, ref: str(r.ref, 40), enter, exit };
}

function leg(v: unknown): PackedLeg | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const c = coords(r.c);
  if (!c) return null;
  const seg = Array.isArray(r.seg)
    ? r.seg
        .slice(0, 40)
        .map((s): PackedSegment | null => {
          const o = s as Record<string, unknown>;
          const sc = coords(o?.c);
          const mode = str(o?.mode, 40) as LegSegment['mode'] | undefined;
          if (!sc || !mode || !SEGMENT_MODES.includes(mode)) return null;
          return { mode, c: sc, name: str(o?.name, 120) };
        })
        .filter((s): s is PackedSegment => s !== null)
    : undefined;

  const profile = Array.isArray(r.p) && r.p.length <= MAX_COORDS
    ? (r.p as unknown[]).every((n) => typeof n === 'number' && Number.isFinite(n))
      ? (r.p as number[])
      : undefined
    : undefined;

  return {
    c,
    d: num(r.d, 0, 1e7) ?? 0,
    a: num(r.a, 0, 1e5) ?? 0,
    de: num(r.de, 0, 1e5) ?? 0,
    t: num(r.t, 0, 1e7) ?? 0,
    ...(seg?.length ? { seg } : {}),
    ...(ride(r.ride) ? { ride: ride(r.ride) } : {}),
    ...(typeof r.sac === 'string' && /^T[1-6]$/.test(r.sac) ? { sac: r.sac as PackedLeg['sac'] } : {}),
    ...(profile ? { p: profile } : {}),
  };
}

/** What a shared route turns into: a trip, minus the id and date the app mints. */
export type IncomingTrip = Omit<SavedTrip, 'id' | 'createdAt'>;

/**
 * Read a shared payload, or refuse it.
 *
 * Returns null for anything that is not a trip with at least one usable hut.
 * It never throws and never half-accepts: a route that cannot be fully read is
 * better refused than loaded with silent holes, because the holes would be in
 * the line somebody walks.
 */
export function parseSharePayload(raw: unknown, fallbackName = 'Shared route'): IncomingTrip | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const t = (p.trip ?? p) as Record<string, unknown>;
  if (!t || typeof t !== 'object' || !Array.isArray(t.huts)) return null;

  const huts = t.huts
    .slice(0, MAX_HUTS)
    .map(hut)
    .filter((h): h is Hut => h !== null);
  if (huts.length === 0) return null;

  const rides = Array.isArray(t.rides)
    ? t.rides.slice(0, MAX_HUTS).map((r) => ride(r) ?? null)
    : undefined;

  // All or nothing, and for the same reason the save path uses: a partial set
  // draws a trail with gaps that look like real detours. One unreadable leg
  // means the recipient routes the whole trip themselves.
  const packed = Array.isArray(t.legs) ? t.legs.slice(0, MAX_HUTS).map(leg) : undefined;
  const legs =
    packed && packed.length === huts.length - 1 && packed.every((l): l is PackedLeg => l !== null)
      ? packed
      : undefined;

  return {
    name: str(t.name, 120) ?? fallbackName,
    huts,
    scenic: t.scenic === true,
    ...(rides?.some(Boolean) ? { rides } : {}),
    ...(legs ? { legs } : {}),
  };
}
