/**
 * A day's height profile, reduced to something small enough to store and smooth
 * enough to draw.
 *
 * ⚠️ Deliberately NOT `simplifyProfile` from hikeTime. That one exists to make
 * the WALKING TIME right: it collapses everything inside a 10 m deadband to
 * turning points, which is correct for integrating speed but draws as a chain of
 * straight segments with visible corners. This keeps the shape.
 *
 * ⚠️ Also not the raw BRouter output. That is a point every 10–20 m — 800–1500
 * per day — which is far more than a ~350 px chart can show and would roughly
 * double what a saved trip costs in storage.
 */
import type { ProfilePoint } from './hikeTime';

/** Points kept per leg. ~2 px apart on a full-width chart; ~1.4 KB packed. */
const MAX_POINTS = 120;

export interface ProfileSample {
  /** Metres walked from the start of the leg. */
  d: number;
  /** Metres above sea level. */
  e: number;
}

function haversineMeters(a: ProfilePoint, b: ProfilePoint): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Build a flat `[d, e, d, e, …]` profile from BRouter's `[lon, lat, ele]` track.
 *
 * Sampled at EVEN DISTANCE rather than by taking every Nth point, so a stretch
 * with dense coordinates (a switchback) doesn't get more chart width than a
 * sparse one — the x-axis has to stay proportional to distance or the gradients
 * it shows are lies.
 *
 * Returns an empty array when the track carries no elevation, which is the
 * signal to draw nothing rather than a flat line at zero.
 */
export function buildElevationProfile(coords: ProfilePoint[]): number[] {
  if (!coords || coords.length < 2) return [];
  if (coords.some((c) => c[2] == null) && coords.every((c) => c[2] == null)) return [];

  // Cumulative distance at each source point.
  const dist: number[] = new Array(coords.length);
  dist[0] = 0;
  for (let i = 1; i < coords.length; i++) {
    dist[i] = dist[i - 1] + haversineMeters(coords[i - 1], coords[i]);
  }
  const total = dist[dist.length - 1];
  if (!(total > 0)) return [];

  const n = Math.min(MAX_POINTS, coords.length);
  const out: number[] = new Array(n * 2);
  let src = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    while (src < coords.length - 2 && dist[src + 1] < target) src++;
    // Interpolate between the bracketing points so the sample sits where the
    // even-distance grid says, not at whichever source point happens to be near.
    const d0 = dist[src];
    const d1 = dist[src + 1];
    const t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
    const e0 = coords[src][2] ?? 0;
    const e1 = coords[src + 1][2] ?? e0;
    out[i * 2] = Math.round(target);
    out[i * 2 + 1] = Math.round(e0 + (e1 - e0) * t);
  }
  return out;
}

/**
 * Where along the leg you are, from a GPS fix — or null if you aren't on it.
 *
 * Finds the nearest point of the track and returns how far along that is, so the
 * chart can mark your height and what's coming. Uses the ROUTE COORDINATES
 * rather than the profile, because the profile is resampled to ~120 points
 * (~80 m apart) and snapping to that would be needlessly coarse.
 *
 * ⚠️ Returns null beyond `maxOffRouteM`. Someone planning at home is thousands
 * of km away, and a dot pinned to the nearest point of the track would tell them
 * they're at 2,400 m on a col they've never seen. Better to show nothing than
 * something confidently wrong.
 */
export function positionAlongRoute(
  coords: { latitude: number; longitude: number }[],
  here: { latitude: number; longitude: number },
  maxOffRouteM = 500,
): { distanceM: number; offRouteM: number } | null {
  if (!coords || coords.length < 2) return null;
  const p: ProfilePoint = [here.longitude, here.latitude];

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineMeters(p, [coords[i].longitude, coords[i].latitude]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestDist > maxOffRouteM) return null;

  let along = 0;
  for (let i = 1; i <= bestIdx; i++) {
    along += haversineMeters(
      [coords[i - 1].longitude, coords[i - 1].latitude],
      [coords[i].longitude, coords[i].latitude],
    );
  }
  return { distanceM: along, offRouteM: bestDist };
}

/** Height at a given distance along, interpolated between profile samples. */
export function elevationAt(flat: number[] | undefined, distanceM: number): number | null {
  const pts = readElevationProfile(flat);
  if (pts.length < 2) return null;
  if (distanceM <= pts[0].d) return pts[0].e;
  const last = pts[pts.length - 1];
  if (distanceM >= last.d) return last.e;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].d >= distanceM) {
      const span = pts[i].d - pts[i - 1].d;
      const t = span > 0 ? (distanceM - pts[i - 1].d) / span : 0;
      return pts[i - 1].e + (pts[i].e - pts[i - 1].e) * t;
    }
  }
  return last.e;
}

/** Flat `[d, e, …]` back into points, for drawing. */
export function readElevationProfile(flat: number[] | undefined): ProfileSample[] {
  if (!flat || flat.length < 4) return [];
  const out: ProfileSample[] = new Array(Math.floor(flat.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = { d: flat[i * 2], e: flat[i * 2 + 1] };
  }
  return out;
}
