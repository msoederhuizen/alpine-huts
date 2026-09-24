/**
 * Build-time generator for the OFFLINE hut dataset (run on a dev machine, NEVER
 * at app runtime). Fetches every region's huts, accommodations and villages
 * from the SAME live Overpass + Open-Meteo the app uses at runtime — by calling
 * the app's own fetch functions, so the snapshot is exactly what a live load
 * would produce — and writes them as a static JSON asset the app ships and shows
 * INSTANTLY on first open (see src/data/hutBundle.ts + useHuts/useVillages'
 * `initialData`). Live Overpass then only refreshes in the background.
 *
 * Run with:  npm run generate-huts
 * The public Overpass mirrors are flaky, so this is INCREMENTAL and gentle: it
 * fetches one request at a time, retries hard, and re-uses anything already in
 * assets/data/huts-bundle.json — so if a region fails, just run it again and it
 * only refetches the gaps. Delete the file to force a full refresh.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchAccommodations,
  fetchCoreHuts,
  fetchVillages,
  setElevationCache,
} from '../src/api/overpass';
import { fetchRides } from '../src/api/lifts';
import { REGIONS } from '../src/constants/region';
import { manualPlacesFor } from '../src/constants/manualPlaces';
import { isSubFeatureName } from '../src/utils/lodging';
import type { Hut } from '../src/types/hut';
import type { Ride } from '../src/types/ride';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'data',
  'huts-bundle.json',
);

interface Bundle {
  generatedAt: number;
  core: Record<string, Hut[]>;
  accommodations: Record<string, Hut[]>;
  villages: Record<string, Hut[]>;
  /** Lifts/trains per region — see the note on `ridesPending` in main(). */
  rides: Record<string, Ride[]>;
}

/**
 * Read the existing bundle, NORMALISING its shape.
 *
 * ⚠️ Never `JSON.parse(...) as Bundle` and trust it. The file on disk was
 * written by an older version of this script, so it lacks any field added since
 * — `rides` was absent, the cast asserted otherwise, and the first
 * `r.id in bundle.rides` threw on an undefined. tsc cannot catch that: the cast
 * is the lie. Filling every field in explicitly means a newly added map starts
 * as `{}` on an old bundle and the run resumes normally.
 */
function load(): Bundle {
  if (existsSync(OUT)) {
    try {
      const raw = JSON.parse(readFileSync(OUT, 'utf8')) as Partial<Bundle>;
      return {
        generatedAt: raw.generatedAt ?? 0,
        core: raw.core ?? {},
        accommodations: raw.accommodations ?? {},
        villages: raw.villages ?? {},
        rides: raw.rides ?? {},
      };
    } catch {
      /* fall through to empty */
    }
  }
  return { generatedAt: 0, core: {}, accommodations: {}, villages: {}, rides: {} };
}

function save(b: Bundle) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(b));
}

/**
 * Drop sub-features (the helipad/cableway/access road OF a refuge) on the way
 * out — see `isSubFeatureName` in utils/lodging.ts.
 *
 * ⚠️ Applied HERE, at fan-out, and not to `bundle` itself. The bundle is the
 * cache of what Overpass returned, and `main()` skips a region that is already
 * in it (by PRESENCE, see the note on main()), so purging rows from the cache
 * would make the next run refetch those regions — which is exactly the daily
 * Overpass/DEM quota this script is built to conserve. Filtering the fan-out
 * instead re-derives clean region files from the cache with no network calls at
 * all, and stays idempotent.
 *
 * `overpass.ts` applies the same rule at fetch time, so newly fetched regions
 * never carry these in the first place; this is what cleans the rows banked by
 * earlier runs.
 */
function withoutSubFeatures(huts: Hut[]): Hut[] {
  return huts.filter((h) => !isSubFeatureName(h.name));
}

/** The app reads ONE file per region (lazy-parsed — see src/data/hutBundle.ts),
 *  so once the full bundle is complete, fan it out into assets/data/regions/. */
function writePerRegion(b: Bundle) {
  const dir = join(dirname(OUT), 'regions');
  mkdirSync(dir, { recursive: true });
  const ids = new Set([
    ...Object.keys(b.core),
    ...Object.keys(b.accommodations),
    ...Object.keys(b.villages),
    ...Object.keys(b.rides),
  ]);
  for (const id of ids) {
    // ⚠️ Skip a region that is missing ANY of the three required buckets.
    // Now that this runs on partial runs too, `?? []` would be destructive: a
    // region whose villages query failed this time would have its existing
    // villages overwritten with an empty array, silently deleting data the app
    // is currently serving. Leaving the old file alone is always safer.
    if (!b.core[id] || !b.accommodations[id] || !b.villages[id]) {
      console.log(`  · ${id}: incomplete, leaving its existing file untouched`);
      continue;
    }
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        core: b.core[id],
        // Only the accommodations need this: `fetchCoreHuts` is a pure tag
        // lookup (tourism=alpine_hut & co), so a footpath or helipad can't
        // enter that bucket. It's the NAME-matched accommodation query that
        // sweeps them in.
        accommodations: withoutSubFeatures(b.accommodations[id]),
        villages: b.villages[id],
        // ⚠️ OMITTED, not `[]`, when this region's rides haven't been generated.
        // `bundledRides` treats undefined as "fetch live" and `[]` as "there are
        // genuinely none here" — writing `[]` for an ungenerated region would
        // permanently tell the app there are no lifts.
        ...(b.rides[id] ? { rides: b.rides[id] } : {}),
      }),
    );
  }
  // Per-region hut counts alongside the timestamp. `_meta.json` is tiny and
  // always parsed, so the region picker can tell which regions actually have
  // data WITHOUT parsing every region file (which would defeat the whole
  // lazy-per-region design). Needed once regions could exist before their data
  // did — a freshly added country ships as an empty placeholder until generated.
  const counts: Record<string, number> = {};
  for (const id of ids) {
    // Counted AFTER the sub-feature filter, so the region picker's number
    // matches what the region file actually holds.
    counts[id] =
      (b.core[id]?.length ?? 0) +
      (b.accommodations[id] ? withoutSubFeatures(b.accommodations[id]).length : 0);
  }
  writeFileSync(
    join(dir, '_meta.json'),
    JSON.stringify({ generatedAt: b.generatedAt, counts }),
  );
}

/** Retry a flaky Overpass call, with backoff. Returns null if it never succeeds
 *  (so we can move on and pick it up on the next run). */
async function tryFetch<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // An exhausted elevation quota cannot be retried into success, and each
      // attempt re-runs the (expensive) Overpass query as well. Give up on this
      // region immediately so the run ends PARTIAL and can be resumed later,
      // instead of spending five more attempts proving the same point.
      if (msg.startsWith('ELEVATION_QUOTA')) {
        console.warn(`    ⛔ ${label}: ${msg}`);
        console.warn(`       not retrying — resume this region once the quota recovers`);
        return null;
      }
      console.warn(`    ⚠ ${label} attempt ${attempt}/6: ${msg}`);
      await new Promise((r) => setTimeout(r, Math.min(3000 * attempt, 15000)));
    }
  }
  return null;
}

/**
 * Persistent `type/id -> metres` DEM cache.
 *
 * The elevation API has a DAILY quota, and a full regeneration can blow through
 * it — places without an OSM `ele` tag each need a lookup, and the
 * `building=hotel` rule adds ~1 500 such places in a big region. Altitude of a
 * fixed building doesn't change, so this makes repeat runs almost free and means
 * a quota-limited run resumes cheaply the next day instead of starting over.
 *
 * Seeded from whatever elevations the current bundle already holds, so it works
 * from the first run without a separate warm-up.
 */
const ELEV_CACHE = join(dirname(OUT), 'elevation-cache.json');

function loadElevationCache(bundle: Bundle): Map<string, number> {
  const cache = new Map<string, number>();
  if (existsSync(ELEV_CACHE)) {
    try {
      for (const [k, v] of Object.entries(
        JSON.parse(readFileSync(ELEV_CACHE, 'utf8')) as Record<string, number>,
      ))
        cache.set(k, v);
    } catch {
      /* corrupt cache is not fatal — it just refills */
    }
  }
  for (const group of [bundle.core, bundle.accommodations, bundle.villages]) {
    for (const huts of Object.values(group)) {
      for (const h of huts) if (h.elevation != null) cache.set(h.id, h.elevation);
    }
  }
  return cache;
}

function saveElevationCache(cache: Map<string, number>) {
  writeFileSync(ELEV_CACHE, JSON.stringify(Object.fromEntries(cache)));
}

/**
 * ⚠️ Skip-if-cached uses PRESENCE (`id in bundle.x`), not array length.
 *
 * It used to test `bundle.x[id]?.length`, which treats a legitimately EMPTY
 * result as 'not fetched yet'. Black Forest genuinely returned 0 accommodations
 * (few places clear the 900 m gate there), so it was refetched on every run — and
 * the moment an API hiccup made that refetch fail, it joined the `failed` list and
 * kept the run PARTIAL. A region that can never be satisfied means writePerRegion
 * never fires and the dataset never goes live at all.
 */
async function main() {
  const bundle = load();
  const failed: string[] = [];
  /**
   * Regions whose rides (lifts/trains) didn't come back this run.
   *
   * ⚠️ Deliberately SEPARATE from `failed`, so a missing ride list can never
   * hold the hut dataset back. Rides need a DEM lookup per train line, which is
   * exactly the quota that runs out first — if they counted as failures the run
   * would stay PARTIAL, `writePerRegion` would never fire, and NONE of the hut
   * data would go live. The app falls back to a live Overpass fetch for any
   * region without bundled rides, so pending rides degrade to today's behaviour
   * rather than breaking anything.
   */
  const ridesPending: string[] = [];

  const elevations = loadElevationCache(bundle);
  setElevationCache(elevations);
  console.log(`elevation cache: ${elevations.size} known points`);

  /**
   * Regions still missing data go FIRST.
   *
   * ⚠️ Order is not cosmetic here. Kungsleden and Jotunheimen are last in
   * `REGIONS`, and they failed on every run for five days while regions earlier
   * in the list kept succeeding — because by the time the run reached them the
   * public mirrors had been answering us for an hour and were refusing
   * everything. They were never getting a fair attempt, not once.
   *
   * Fetching the gaps first spends the freshest connection state on the work
   * that actually remains, and a fully cached region costs nothing to skip.
   */
  const ordered = [...REGIONS].sort((a, b) => {
    const missing = (r: (typeof REGIONS)[number]) =>
      (r.id in bundle.core ? 0 : 1) +
      (r.id in bundle.accommodations ? 0 : 1) +
      (r.id in bundle.villages ? 0 : 1);
    return missing(b) - missing(a);
  });

  for (const r of ordered) {
    console.log(`\n▶ ${r.name} (${r.id})`);

    // Fetched only if this region has no entry AT ALL for that query — one at a
    // time, so we never pile requests onto the (overloaded) public mirrors. An
    // empty array counts as fetched; see the note on main().
    if (!(r.id in bundle.core)) {
      const c = await tryFetch(`${r.id} core`, () => fetchCoreHuts(r.bbox));
      if (c) {
        bundle.core[r.id] = c;
        save(bundle);
        console.log(`  ✓ core ${c.length}`);
      } else failed.push(`${r.id}/core`);
    } else console.log(`  • core cached (${bundle.core[r.id].length})`);

    if (!(r.id in bundle.accommodations)) {
      const a = await tryFetch(`${r.id} accommodations`, () =>
        fetchAccommodations(r.bbox),
      );
      if (a) {
        bundle.accommodations[r.id] = a;
        save(bundle);
        console.log(`  ✓ accommodations ${a.length}`);
      } else failed.push(`${r.id}/accommodations`);
    } else
      console.log(
        `  • accommodations cached (${bundle.accommodations[r.id].length})`,
      );

    if (!(r.id in bundle.villages)) {
      const v = await tryFetch(`${r.id} villages`, () => fetchVillages(r.bbox));
      if (v) {
        bundle.villages[r.id] = v;
        save(bundle);
        console.log(`  ✓ villages ${v.length}`);
      } else failed.push(`${r.id}/villages`);
    } else console.log(`  • villages cached (${bundle.villages[r.id].length})`);

    // ⚠️ Rides go to `ridesPending`, NOT `failed` — see the note in main().
    if (!(r.id in bundle.rides)) {
      const rd = await tryFetch(`${r.id} rides`, () => fetchRides(r.bbox));
      if (rd) {
        bundle.rides[r.id] = rd;
        save(bundle);
        console.log(`  ✓ rides ${rd.length}`);
      } else {
        ridesPending.push(r.id);
        console.log(`  – rides pending (app will fetch these live meanwhile)`);
      }
    } else console.log(`  • rides cached (${bundle.rides[r.id].length})`);

    // Flush the DEM cache after EVERY region, not just at the end. The cache is
    // now how a quota-limited region makes progress (see `onBatch` in
    // api/elevation.ts) — losing it to a Ctrl-C or a crash would throw away
    // exactly the expensive part.
    saveElevationCache(elevations);
  }

  // Merge hand-entered places. Done AFTER all fetching so a regeneration can
  // never drop them, and keyed by id so re-running is idempotent.
  for (const r of REGIONS) {
    const manual = manualPlacesFor(r.id);
    if (!manual.length || !bundle.accommodations[r.id]) continue;
    const have = new Set(bundle.accommodations[r.id].map((h) => h.id));
    const add = manual.filter((h) => !have.has(h.id));
    if (add.length) {
      bundle.accommodations[r.id] = [...bundle.accommodations[r.id], ...add];
      console.log(`  + ${add.length} manual place(s) merged into ${r.id}`);
    }
  }
  save(bundle);
  // Persist whatever the DEM taught us, even on a partial run — that's exactly
  // when it matters most, so the next attempt doesn't re-spend the quota.
  saveElevationCache(elevations);
  console.log(`elevation cache: ${elevations.size} points saved`);

  // Only stamp generatedAt once everything is present, so a partial run doesn't
  // look complete to the app.
  if (failed.length === 0) {
    bundle.generatedAt = Date.now();
    save(bundle);
  }

  // ⚠️ Fan out to the app's per-region files on EVERY run, not just clean ones.
  //
  // This used to sit inside the `failed.length === 0` branch, which coupled
  // every region's fate to every other region's. Two regions in Norway and
  // Sweden that Overpass couldn't serve kept Château-d'Oex — fetched, banked and
  // correct — out of the app indefinitely, because the run never went green.
  // `writePerRegion` already skips a region that has no data, so publishing the
  // ones that DID succeed is strictly better than serving stale files. The
  // `generatedAt` stamp above is what still distinguishes a complete dataset.
  writePerRegion(bundle);

  const totalHuts = Object.values(bundle.core).reduce((n, l) => n + l.length, 0);
  const totalAcc = Object.values(bundle.accommodations).reduce(
    (n, l) => n + l.length,
    0,
  );
  const totalVil = Object.values(bundle.villages).reduce(
    (n, l) => n + l.length,
    0,
  );
  const mb = (JSON.stringify(bundle).length / 1024 / 1024).toFixed(2);
  console.log(
    `\n${failed.length === 0 ? '✅ COMPLETE' : '⏳ PARTIAL'} — ${totalHuts} core + ${totalAcc} accommodations + ${totalVil} villages, ${mb} MB → ${OUT}`,
  );
  if (failed.length > 0) {
    console.log(
      `   ${failed.length} still missing: ${failed.join(', ')}\n   Re-run \`npm run generate-huts\` to fetch just those.`,
    );
  }
  if (ridesPending.length > 0) {
    console.log(
      `   rides pending for ${ridesPending.length} region(s): ${ridesPending.join(', ')}\n` +
        `   These do NOT block the dataset — the app fetches those regions' lifts\n` +
        `   live until a later run picks them up.`,
    );
  }
}

main().catch((err) => {
  console.error('\n❌ Generation failed:', err);
  process.exit(1);
});
