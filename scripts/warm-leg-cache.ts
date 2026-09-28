/**
 * Compute every leg people are likely to ask for, BEFORE they ask for it.
 *
 * ⚠️ A COLD CACHE IS THE WORST MOMENT A SERVER EVER HAS, AND IT IS LAUNCH DAY.
 * Measured: BRouter takes ~180 ms a leg (36 ms for 3 km, 360 ms for 40 km), and
 * planning one trip asks for about 63 of them — 11 seconds of single-core work.
 * Two cores therefore serve six to eight trips a minute with nothing cached.
 * Warm, a leg comes off disk in about a millisecond, and the same box serves
 * thirty to sixty. The difference between those two numbers is entirely whether
 * this script has been run.
 *
 * ⚠️ IT WARMS THE CACHE, IT DOES NOT WRITE TO IT. nginx's cache files carry a
 * binary header and a hashed name; producing them by hand is a corrupt cache
 * waiting to happen and would break silently on any nginx change. So this makes
 * ordinary requests THROUGH the proxy and lets nginx store the answers itself —
 * the same path a real user takes, so whatever gets cached is exactly what gets
 * served.
 *
 * ⚠️ MOUNTAIN HUTS ONLY, AND THAT IS WHAT MAKES IT AFFORDABLE. Every place
 * within 25 km of every other is 4.9 million pairs — 247 core-hours. Restricted
 * to alpine huts, wilderness huts and shelters it is 452,154 pairs at 18 km:
 * 23 core-hours, under six on four cores. The 19,479 valley guesthouses
 * dominate the count and nobody plans a hut-to-hut route between two hotels in
 * the same town.
 *
 * Run it ON THE SERVER, against the local nginx — routing the geometry back
 * over the internet would take longer than computing it.
 *
 *   npx tsx scripts/warm-leg-cache.ts --base http://127.0.0.1:8080
 *   npx tsx scripts/warm-leg-cache.ts --max-km 12 --profile hiking-t4
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import { metresBetween } from '../src/utils/geo';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DONE_FILE = join(ROOT, 'leg-warm.done');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Through nginx, not straight to BRouter — the point is to fill nginx. */
const BASE = arg('base', 'http://127.0.0.1:8080');

/**
 * ⚠️ hiking-t6 BY DEFAULT BECAUSE THAT IS WHAT MOST PEOPLE GET. `maxSac`
 * defaults to T6, so an untouched install asks for this profile. Warming all
 * six would multiply the work by six to serve the minority who changed the
 * setting — and their first plan simply pays full price, which is the correct
 * trade rather than an oversight.
 */
const PROFILE = arg('profile', 'hiking-t6');

/**
 * ⚠️ 18 km, NOT 25. A day's walk between huts is rarely longer, and the pair
 * count grows with the square: 25 km is 745k pairs, 18 km is 452k, 12 km is
 * 240k. Going wider buys legs almost nobody asks for at a steeply rising price.
 */
const MAX_KM = Number(arg('max-km', '18'));

/**
 * ⚠️ MATCH THE SERVER'S CORES, AND NO MORE. BRouter is CPU-bound, so requests
 * beyond the core count do not go faster — they queue, while making the box
 * unresponsive to any real user who happens to be planning at the same time.
 * Four is right for a 4-core VPS; use 2 on a 2-core one.
 */
const CONCURRENCY = Number(arg('concurrency', '4'));

const MOUNTAIN = new Set(['alpine_hut', 'wilderness_hut', 'shelter']);

interface Pair { a: Hut; b: Hut }

function pairs(): Pair[] {
  const dir = join(ROOT, 'assets', 'data', 'regions');
  const out: Pair[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, Hut[]>;
    // Within one region only: the generator never links huts across distant
    // regions, so those pairs would be computed and never asked for.
    const huts = [...(d.core ?? []), ...(d.accommodations ?? [])].filter((h) => MOUNTAIN.has(h.type));
    for (let i = 0; i < huts.length; i++) {
      for (let j = i + 1; j < huts.length; j++) {
        if (metresBetween(huts[i].lat, huts[i].lon, huts[j].lat, huts[j].lon) <= MAX_KM * 1000) {
          out.push({ a: huts[i], b: huts[j] });
        }
      }
    }
  }
  return out;
}

/** Exactly the URL the app builds — see src/api/brouter.ts. */
function urlFor(p: Pair): string {
  const lonlats = `${p.a.lon},${p.a.lat}|${p.b.lon},${p.b.lat}`;
  return `${BASE}/brouter?lonlats=${lonlats}&profile=${PROFILE}&alternativeidx=0&format=geojson`;
}

const key = (p: Pair) => `${p.a.id}>${p.b.id}:${PROFILE}`;

async function main() {
  const all = pairs();
  const done: Record<string, true> = existsSync(DONE_FILE)
    ? JSON.parse(readFileSync(DONE_FILE, 'utf8'))
    : {};
  const todo = all.filter((p) => !done[key(p)]);

  console.log(`${all.length.toLocaleString()} pairs within ${MAX_KM} km, profile ${PROFILE}`);
  console.log(`${Object.keys(done).length.toLocaleString()} already warmed, ${todo.length.toLocaleString()} to go`);
  console.log(`through ${BASE}, ${CONCURRENCY} at a time\n`);
  if (!todo.length) return;

  let n = 0;
  let hit = 0;
  let miss = 0;
  let failed = 0;
  let next = 0;
  const t0 = Date.now();

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= todo.length) return;
      const p = todo[i];
      try {
        const r = await fetch(urlFor(p), { signal: AbortSignal.timeout(60_000) });
        // Drain the body: without this the connection is not reused and, more
        // to the point, nginx may not finish writing the cache entry.
        await r.arrayBuffer();
        const status = r.headers.get('x-cache-status') ?? '';
        if (status === 'HIT') hit++;
        else if (r.ok) miss++;
        else failed++;
        // A 4xx is a real answer — these two huts are not connected — and is
        // worth remembering so a re-run does not ask again.
        if (r.ok || (r.status >= 400 && r.status < 500)) done[key(p)] = true;
      } catch {
        failed++;
      }

      if (++n % 250 === 0) {
        writeFileSync(DONE_FILE, JSON.stringify(done));
        const rate = n / ((Date.now() - t0) / 1000);
        const left = (todo.length - n) / Math.max(rate, 0.01) / 3600;
        process.stdout.write(
          `\r  ${n.toLocaleString()}/${todo.length.toLocaleString()}  ` +
            `${rate.toFixed(1)}/s  ~${left.toFixed(1)} h left  ` +
            `computed ${miss.toLocaleString()}  already cached ${hit.toLocaleString()}  failed ${failed}   `,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  writeFileSync(DONE_FILE, JSON.stringify(done));

  console.log(`\n\n${'='.repeat(54)}`);
  console.log(`  computed and cached  ${miss.toLocaleString()}`);
  console.log(`  already cached       ${hit.toLocaleString()}`);
  console.log(`  failed               ${failed.toLocaleString()}`);
  console.log(`\n  ${((Date.now() - t0) / 3600000).toFixed(1)} hours elapsed`);
  console.log(`\n⚠️  A run where everything says "already cached" on the FIRST pass means`);
  console.log(`   the requests are not reaching nginx — check --base points at the proxy`);
  console.log(`   (port 8080), not at BRouter itself (17777), which caches nothing.`);
}

main();
