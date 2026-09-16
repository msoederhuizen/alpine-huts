/**
 * Compact serialisation of a routed leg, so a saved trip carries its own trail
 * geometry and can be reopened with no network.
 *
 * WHY IT'S PACKED: legs are the only genuinely large thing we persist. BRouter
 * returns a point roughly every 10–20 m, so one day's walk is commonly 800–1500
 * coordinates, and a leg that uses a lift repeats much of that inside
 * `segments`. Stored as `{latitude, longitude}` objects that is ~42 bytes per
 * point — a week-long trip lands around 300 KB, and a handful of saved trips
 * would approach AsyncStorage's ~6 MB budget on Android.
 *
 * Flat `[lat, lon, lat, lon, …]` arrays at 5 decimal places (~1 m, far finer
 * than a hiking line needs) cut that to ~17 bytes per point — a ~2.5×
 * reduction — while staying plain readable JSON. An encoded-polyline codec
 * would be smaller still, but it's a format to get wrong for a gain we don't
 * need at these sizes.
 */
import type { LatLng, RouteLeg } from '../api/brouter';
import type { LegSegment, RideUse } from '../types/ride';
import type { SacScale } from './sacScale';

/** Coordinate precision, in decimal places. 5 dp ≈ 1.1 m at Alpine latitudes. */
const DP = 5;

export interface PackedSegment {
  mode: LegSegment['mode'];
  /** Flat [lat, lon, lat, lon, …]. */
  c: number[];
  name?: string;
}

export interface PackedLeg {
  /** Flat [lat, lon, lat, lon, …] — the leg's full geometry. */
  c: number[];
  d: number; // distance, metres
  a: number; // ascent, metres
  de: number; // descent, metres
  t: number; // duration, seconds
  seg?: PackedSegment[];
  ride?: RideUse;
  sac?: SacScale;
  /** Height profile, flat [metresAlong, metresAsl, …]. ~1.4 KB — small beside
   *  the geometry, and without it a saved trip reopens with no chart. */
  p?: number[];
}

function round(n: number): number {
  return Math.round(n * 10 ** DP) / 10 ** DP;
}

function packCoords(coords: LatLng[]): number[] {
  const out: number[] = new Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    out[i * 2] = round(coords[i].latitude);
    out[i * 2 + 1] = round(coords[i].longitude);
  }
  return out;
}

function unpackCoords(flat: number[]): LatLng[] {
  const out: LatLng[] = new Array(Math.floor(flat.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = { latitude: flat[i * 2], longitude: flat[i * 2 + 1] };
  }
  return out;
}

export function packLeg(leg: RouteLeg): PackedLeg {
  return {
    c: packCoords(leg.coordinates),
    d: leg.distance,
    a: leg.ascent,
    de: leg.descent,
    t: leg.duration,
    ...(leg.segments
      ? {
          seg: leg.segments.map((s) => ({
            mode: s.mode,
            c: packCoords(s.coordinates),
            ...(s.name ? { name: s.name } : {}),
          })),
        }
      : {}),
    ...(leg.ride ? { ride: leg.ride } : {}),
    ...(leg.sacScale ? { sac: leg.sacScale } : {}),
    ...(leg.profile?.length ? { p: leg.profile } : {}),
  };
}

export function unpackLeg(p: PackedLeg): RouteLeg {
  return {
    coordinates: unpackCoords(p.c),
    distance: p.d,
    ascent: p.a,
    descent: p.de,
    duration: p.t,
    segments: p.seg?.map((s) => ({
      mode: s.mode,
      coordinates: unpackCoords(s.c),
      name: s.name,
    })),
    ride: p.ride,
    sacScale: p.sac,
    profile: p.p,
  };
}
