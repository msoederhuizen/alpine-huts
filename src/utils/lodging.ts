import type { Hut } from '../types/hut';
import { kmBetween } from './geo';
import { HIGH_REFUGE_NAME_RE } from './hutMeta';

/**
 * Quality filters for the ACCOMMODATION layer (the purple pins) — the hotels and
 * mountain inns that aren't tagged as huts in OSM and therefore have to be found
 * by name, which lets junk in.
 *
 * These run at RUNTIME over the shipped bundle rather than only at generation
 * time, so they take effect without regenerating the dataset. `overpass.ts`
 * applies {@link isNonLodgingPoi} too, so freshly-generated bundles are clean at
 * the source as well.
 */

// The refuge-name pattern lives in hutMeta.ts — it protects places from BOTH
// this crowding filter and the non-overnight shelter filter. Deliberately
// separate from `GUESTHOUSE_NAME_RE` in overpass.ts: that one decides what gets
// INCLUDED in the dataset, and widening it would pull in new places, whereas
// this one only ever protects, so it can be broader safely.

/**
 * Tag families that are plainly not somewhere you can sleep. The accommodation
 * query matches on NAME (`node["name"~"rifugio|berghotel|…"]`), so anything
 * named after a nearby hotel or refuge gets swept in — most visibly webcams
 * ("Webcam Rifugio Lagazuoi", "Berghotel Zirm - Olang", both
 * `man_made=surveillance`), but also monitoring stations, viewpoints, artwork
 * and, in one case, a mine adit.
 */
const NON_LODGING_MAN_MADE = new Set([
  'surveillance',
  'monitoring_station',
  'adit',
  'mineshaft',
  'tower',
  'mast',
  'antenna',
  'water_well',
  'storage_tank',
]);
const NON_LODGING_TOURISM = new Set([
  'information',
  'viewpoint',
  'attraction',
  'artwork',
  'picnic_site',
  'giant_furniture',
  'proposed',
  'theme_park',
  'zoo',
  'museum',
]);

/**
 * Infrastructure keys that make something categorically not a place to sleep,
 * whatever its name says.
 *
 * Found while verifying the crowding filter: thirteen copies of "Strada per il
 * Rifugio Auronzo" were being shown as accommodation pins. They're segments of
 * the ROAD to the refuge — `highway=*` — swept in because the accommodations
 * query matches on name and they contain "Rifugio". Same family as the webcams,
 * but a tag check catches the whole class (roads, paths, cable cars, lifts,
 * railways) rather than chasing Italian words like `strada` and `sentiero`.
 */
const NON_LODGING_KEYS = [
  'highway',
  'aerialway',
  'railway',
  'waterway',
  'power',
  'barrier',
  'piste:type',
];

/** True when tags show this is not lodging at all, whatever it's called. */
export function isNonLodgingPoi(tags: Record<string, string>): boolean {
  if (tags.man_made && NON_LODGING_MAN_MADE.has(tags.man_made)) return true;
  if (tags.tourism && NON_LODGING_TOURISM.has(tags.tourism)) return true;
  // A surveillance:* tag is conclusive even when `man_made` is missing.
  if (tags.surveillance || tags['surveillance:type']) return true;
  for (const k of NON_LODGING_KEYS) if (tags[k]) return true;
  return false;
}

/** How close counts as "the same place" for the crowding rule. */
const CLUSTER_RADIUS_KM = 1;
/**
 * More neighbours than this within the radius ⇒ crowded.
 *
 * Tightened 5 → 3 to thin village high streets further (30% → 35% of
 * accommodations removed). Verified first that it costs none of the hamlet inns
 * this rule exists to protect: Bären Kiental (0 neighbours), Spillgerten (1),
 * Bärghuus Axalp and Hotel Chemihüttli (2 each) all sit well under it, and
 * Gasthaus Zwirgi (0) and the Grindelwald Blümlisalp are unaffected.
 *
 * Density beats OSM's `population` tag as a "is this a real village" signal —
 * only 65% of settlement nodes carry population at all, so a threshold on it
 * would silently keep the hotels of every unlabelled village.
 */
const MAX_NEIGHBOURS = 3;

/**
 * How far from a settlement's OSM node still counts as "in" it. Villages are
 * mapped as a single centre POINT, not an outline, so this stands in for the
 * built-up area. Scaled by place type — a town sprawls further than a village.
 *
 * Calibrated against the case that motivated this: Grindelwald's node sits at
 * 46.6243, 8.0367, and the Blümlisalp on Obere Gletscherstrasse is ~2 km up the
 * glacier road — outside the village at 1.2 km, so it survives, while the hotels
 * packed along the village high street do not.
 */
const IN_TOWN_RADIUS_KM = 2;
const IN_VILLAGE_RADIUS_KM = 1.2;

function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  return kmBetween(a.lat, a.lon, b.lat, b.lon);
}

/**
 * Drops accommodations that are BOTH crowded AND inside a settlement — i.e.
 * hotels along a village high street, which clutter the map without being useful
 * hut-to-hut stops.
 *
 * Both conditions are required, deliberately. Crowding alone is too blunt: an
 * inn just outside a village still has neighbours within a kilometre, so density
 * on its own removed places like the Blümlisalp on Grindelwald's glacier road.
 * Requiring "in the settlement" as well keeps outlying inns while still clearing
 * the village core. Elevation can't make this distinction at all — Hotel
 * Wetterhorn (1046 m) sits at the same height as Grindelwald village (1034 m).
 *
 * ⚠️ Named mountain refuges are EXEMPT regardless. Without that, this drops
 * Rifugio Auronzo (6 neighbours, at Tre Cime), Rifugio Passo Sella and
 * Enzianhütte — real refuges that cluster at popular passes, which would be
 * exactly backwards.
 *
 * Counts only OTHER accommodations; alpine huts/shelters are a separate layer
 * and neither count towards the density nor are affected by it.
 *
 * KNOWN LIMIT: a dense cluster with no settlement node near it (a ski-area hotel
 * group, say) is now kept. That's the intended trade — it isn't a village.
 */
export function dropCrowdedLodging(
  accommodations: Hut[],
  villages: Hut[] = [],
): Hut[] {
  if (accommodations.length === 0) return accommodations;

  // Settlement lookup, bucketed by the widest radius we ever test against.
  const vCellDeg = IN_TOWN_RADIUS_KM / 111;
  const vGrid = new Map<string, Hut[]>();
  const vKey = (lat: number, lon: number) =>
    `${Math.floor(lat / vCellDeg)}:${Math.floor(lon / vCellDeg)}`;
  for (const v of villages) {
    const k = vKey(v.lat, v.lon);
    const cell = vGrid.get(k);
    if (cell) cell.push(v);
    else vGrid.set(k, [v]);
  }
  const insideSettlement = (h: Hut) => {
    const gy = Math.floor(h.lat / vCellDeg);
    const gx = Math.floor(h.lon / vCellDeg);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const v of vGrid.get(`${gy + dy}:${gx + dx}`) ?? []) {
          const radius =
            v.tags?.place === 'town' ? IN_TOWN_RADIUS_KM : IN_VILLAGE_RADIUS_KM;
          if (haversineKm(h, v) <= radius) return true;
        }
      }
    }
    return false;
  };

  // Bucket into ~1 km cells so each place only compares against its own cell and
  // the 8 around it — linear rather than quadratic on dense regions.
  const latCell = CLUSTER_RADIUS_KM / 111;
  const cellKey = (lat: number, lon: number) => {
    const lonCell =
      CLUSTER_RADIUS_KM / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    return `${Math.floor(lat / latCell)}:${Math.floor(lon / lonCell)}`;
  };
  const grid = new Map<string, Hut[]>();
  for (const h of accommodations) {
    const k = cellKey(h.lat, h.lon);
    const cell = grid.get(k);
    if (cell) cell.push(h);
    else grid.set(k, [h]);
  }

  const neighboursOf = (h: Hut) => {
    const lonCell =
      CLUSTER_RADIUS_KM / (111 * Math.max(0.1, Math.cos((h.lat * Math.PI) / 180)));
    const gy = Math.floor(h.lat / latCell);
    const gx = Math.floor(h.lon / lonCell);
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const other of grid.get(`${gy + dy}:${gx + dx}`) ?? []) {
          if (other === h) continue;
          if (haversineKm(h, other) <= CLUSTER_RADIUS_KM) n++;
        }
      }
    }
    return n;
  };

  return accommodations.filter(
    (h) =>
      HIGH_REFUGE_NAME_RE.test(h.name ?? '') ||
      neighboursOf(h) <= MAX_NEIGHBOURS ||
      !insideSettlement(h),
  );
}

/** Both accommodation-quality passes, in order. */
export function cleanAccommodations(
  accommodations: Hut[],
  villages: Hut[] = [],
): Hut[] {
  return dropCrowdedLodging(
    accommodations.filter((h) => !isNonLodgingPoi(h.tags ?? {})),
    villages,
  );
}
