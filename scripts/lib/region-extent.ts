/**
 * Catch a region whose HUT data stops short of its own bounds.
 *
 * ⚠️ THIS BUG SHIPPED SILENTLY FOR MONTHS AND NOTHING NOTICED. `ortler-stelvio`
 * held huts from 46.201 to 46.600 while its bounds run to 46.86 — the northern
 * 29 km simply absent, longitudes fine. It was found only because somebody
 * asked why Martin-Busch-Hütte, plainly tagged `tourism=alpine_hut` in OSM, was
 * 7.7 km from anything the app had.
 *
 * ⚠️ THE CAUSE WAS THE ELEVATION QUOTA, NOT OVERPASS. `fetchAccommodations`
 * uses DEM lookups to keep hotels above 1400 m, and a DEM failure used to just
 * DROP those candidates rather than fail — so a run that exhausted the daily
 * quota partway through lost accommodations for every region after that point.
 * A truncated result is indistinguishable from "there are no huts there" unless
 * something checks, which is what this is.
 *
 * ⚠️ VILLAGES ARE THE YARDSTICK, AND THAT IS THE TRICK. They come from a far
 * smaller query with no DEM step, so they survive whatever killed the huts.
 * Comparing the two extents needs no API, no network and no knowledge of why a
 * run failed: if a region has villages 27 km further north than any of its
 * huts, its huts are incomplete.
 */
import type { Hut } from '../../src/types/hut';

/**
 * ⚠️ 6 km, MEASURED NOT GUESSED. Across 42 regions the five truncated ones
 * were short by 6, 9, 14, 18 and 27 km (one by 50 km westward); every healthy
 * region was under 6. `valais-west` sat exactly at 6 and WAS genuinely
 * truncated — it gained 118 huts when refetched — so the bar belongs at 6 and
 * not higher.
 */
const SHORTFALL_KM = 6;

/** Enough points on both sides for the comparison to mean anything. */
const MIN_HUTS = 20;
const MIN_VILLAGES = 10;

/**
 * Regions where the gap is real geography, not a truncated fetch.
 *
 * ⚠️ EVERY ENTRY NEEDS EVIDENCE, because this list is how the check gets
 * quietly disabled. A region is only added after a CLEAN refetch left the gap
 * unchanged — if refetching fixes it, it was truncation and belongs nowhere
 * near here. Without the list a permanent false positive would stop the dataset
 * ever being stamped complete, which would train everyone to ignore the check.
 */
const KNOWN_UNEVEN: Record<string, string> = {
  'peneda-geres':
    'Its bbox reaches east onto the Barroso plateau and over the Galician ' +
    'border — Boticas, Montalegre, Trasmiras — which is farmland with villages ' +
    'and no mountain lodging at all. 34 villages sit east of every hut. ' +
    'Refetched cleanly on 2026-09-29 (73 -> 74 huts) and the 14 km gap did not ' +
    'move, which is what makes it geography rather than a truncated response.',
};

const KM_PER_DEG_LAT = 111;
/** Rough, and deliberately so: at Alpine latitudes a degree of longitude is
 *  about 0.7 of a degree of latitude, which is close enough to flag 20 km. */
const KM_PER_DEG_LON = 111 * 0.7;

export interface ExtentShortfall {
  regionId: string;
  /** Which side, and by how far, in km. */
  side: 'north' | 'south' | 'east' | 'west';
  km: number;
  huts: number;
}

/**
 * Does this region's hut data reach as far as its villages?
 *
 * Returns the worst shortfall, or undefined when the region looks healthy or
 * has too few points to judge.
 */
export function extentShortfall(
  regionId: string,
  huts: Hut[],
  villages: Hut[],
): ExtentShortfall | undefined {
  if (huts.length < MIN_HUTS || villages.length < MIN_VILLAGES) return undefined;
  if (regionId in KNOWN_UNEVEN) return undefined;

  const hLat = huts.map((h) => h.lat);
  const hLon = huts.map((h) => h.lon);
  const vLat = villages.map((v) => v.lat);
  const vLon = villages.map((v) => v.lon);

  const sides: ExtentShortfall[] = [
    { regionId, side: 'north', km: (Math.max(...vLat) - Math.max(...hLat)) * KM_PER_DEG_LAT, huts: huts.length },
    { regionId, side: 'south', km: (Math.min(...hLat) - Math.min(...vLat)) * KM_PER_DEG_LAT, huts: huts.length },
    { regionId, side: 'east', km: (Math.max(...vLon) - Math.max(...hLon)) * KM_PER_DEG_LON, huts: huts.length },
    { regionId, side: 'west', km: (Math.min(...hLon) - Math.min(...vLon)) * KM_PER_DEG_LON, huts: huts.length },
  ];

  const worst = sides.reduce((a, b) => (b.km > a.km ? b : a));
  return worst.km > SHORTFALL_KM ? { ...worst, km: Math.round(worst.km) } : undefined;
}

export { KNOWN_UNEVEN, SHORTFALL_KM };
