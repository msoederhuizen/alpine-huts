/**
 * The OSM tag keys the app keeps on a bundled hut. Everything else is dropped
 * when `assets/data/regions/*.json` is written.
 *
 * ⚠️ READ THIS BEFORE WRITING `hut.tags.something` IN A COMPONENT.
 *
 * If the key you want isn't on this list, it is NOT in the shipped data and
 * your code will silently see `undefined` — for every hut, in dev and in
 * production alike. Add the key here, then re-run `npm run trim-region-tags`
 * (a few seconds, no network). Don't work around it by reading a different tag.
 *
 * WHY THIS EXISTS: huts carry their full raw OSM tag set, and across the 47,884
 * bundled places that is 398,152 tag keys of which the app reads 47%. The rest
 * — `source`, `building`, `addr:postcode`, `population`, `openGeoDB:*` and a
 * tail of 1,379 one-off keys — describes the map data rather than the hut, and
 * shipped 5.6 MB to every phone for nothing.
 *
 * ⚠️ The MASTER `assets/data/huts-bundle.json` keeps every tag. Nothing here is
 * destructive: adding a key back is an edit plus a re-run, never a refetch. That
 * matters because refetching costs Overpass throttling and a daily DEM quota.
 *
 * NOT IN THIS LIST, DELIBERATELY: `lat`, `lon`, `name`, `elevation`, `website`,
 * `wikidata`, `wikipedia`, `image` and the rest of the `Hut` interface are
 * TOP-LEVEL FIELDS, not tags. Trimming never touches them — coordinates are
 * present on 100% of huts and stay that way.
 */
export const KEPT_HUT_TAGS: ReadonlySet<string> = new Set([
  // ── Facilities — the chips on the hut detail screen (utils/facilities.ts) ──
  'capacity',
  'beds',
  'capacity:winter_room',
  'rooms',
  'rooms:family',
  'drinking_water',
  'shower',
  'breakfast',
  'dinner',
  'half_board',
  'kitchen',
  'internet_access',
  'dog',
  'payment:credit_cards',

  // ── Contact block — app/hut/[id].tsx ──
  'operator',
  'owner',
  'phone',
  'contact:phone',
  'email',
  'contact:email',

  // ── Typing and filtering ──
  /** Bivouac vs staffed hut — utils/hutMeta.ts */
  'shelter_type',
  /** Hut typing AND the duplicate-place score — hooks/useHuts.ts */
  'tourism',
  /** The "is this a hotel on a village high street" filter — utils/lodging.ts */
  'man_made',
  'surveillance',
  'surveillance:type',

  // ── Locality + duplicate resolution — hooks/useHuts.ts ──
  /** Also feeds the duplicate-place score. */
  'ele',
  'addr:city',
  'addr:village',
  'addr:hamlet',
  'addr:suburb',
  'addr:place',
  /** Matching two OSM records of the same place — utils/dedupePlaces.ts */
  'name',

  // ── Photos and links ──
  // These are ALSO promoted to top-level Hut fields by the generator; kept here
  // because the promotion only fires when the tag parses cleanly, and the raw
  // value is the fallback.
  'image',
  'wikimedia_commons',
  'website',
  'contact:website',
  'url',
  'reservation:website',
  'wikidata',
  'wikipedia',
]);

/**
 * Reduce a raw OSM tag bag to the keys above.
 *
 * Returns the ORIGINAL key count alongside, because
 * `placeScore` in hooks/useHuts.ts ranks two OSM records of the same physical
 * place partly by how many tags each carries. Counting the TRIMMED bag would
 * change which record wins — a pin quietly moving to the other of two
 * duplicates — so the count is taken before anything is dropped and travels
 * with the hut as `tagCount`.
 */
export function trimHutTags(tags: Record<string, string>): {
  tags: Record<string, string>;
  tagCount: number;
} {
  const kept: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(tags)) {
    n++;
    if (KEPT_HUT_TAGS.has(k)) kept[k] = v;
  }
  return { tags: kept, tagCount: n };
}
