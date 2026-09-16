import type { LatLng } from '../api/brouter';

/**
 * A mechanised way to skip part of a trail — an aerial lift, a funicular, or a
 * scenic mountain railway. Modelled as a single *transport edge* between two
 * stations: riding it costs the hiker ~no ascent and no hiking distance, which
 * is exactly what lets a day reach a hut that would be too much climbing on
 * foot. See `combineRideLeg` in `../api/brouter` for how a ride is stitched into
 * a day's leg, and `planRoute` for how the generator decides to use one.
 */
export type RideMode =
  | 'gondola'
  | 'cable_car'
  | 'chair_lift'
  | 'funicular'
  | 'train';

/** A ride option as fetched from OSM — direction-agnostic (either end can be the
 *  boarding station; the generator picks the useful direction per day). */
export interface Ride {
  /** Stable id (OSM way id for lifts; `train/<rel>/<i>-<j>` for railway edges). */
  id: string;
  name: string;
  mode: RideMode;
  /** The line/service number as posted at the station (e.g. "R 311", "R66"),
   *  when OSM tags one — mountain railways only; lifts aren't numbered. */
  ref?: string;
  /** The two stations. Which is boarding vs alighting is decided per use. */
  a: LatLng;
  b: LatLng;
}

/** A ride actually used on a leg, in the direction it's ridden. Persisted with a
 *  trip so the Map/Route tabs can redraw the same walk-ride-walk geometry. */
export interface RideUse {
  id: string;
  name: string;
  mode: RideMode;
  ref?: string;
  /** Board here (you walk to this station from the day's start hut). */
  enter: LatLng;
  /** Alight here (you walk from this station to the day's end hut). */
  exit: LatLng;
}

/** "Wengernalpbahn (R 311)" — the display form used wherever a ride is named,
 *  so people can actually find it at the station. */
export function rideDisplayName(r: { name: string; ref?: string }): string {
  return r.ref ? `${r.name} (${r.ref})` : r.name;
}

/** A drawable piece of a composite (walk-ride-walk) leg — so the map can style
 *  the walking parts as trail and the ride as a distinct dashed line. */
export interface LegSegment {
  mode: 'walk' | RideMode;
  coordinates: LatLng[];
  /** Ride name, for the ride segment (e.g. "Männlichenbahn"). */
  name?: string;
}

/** Human labels + a matching emoji for each ride mode, for the UI. */
export const RIDE_LABEL: Record<RideMode, string> = {
  gondola: 'Gondola',
  cable_car: 'Cable car',
  chair_lift: 'Chairlift',
  funicular: 'Funicular',
  train: 'Mountain train',
};

export function rideEmoji(mode: RideMode): string {
  return mode === 'train' ? '🚞' : mode === 'funicular' ? '🚟' : '🚠';
}
