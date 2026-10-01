/**
 * Find huts refuges.info knows that the app does not.
 *
 * ⚠️ THIS IS A DIFFERENT QUESTION FROM THE ONE `generate-refuges-photos.ts`
 * ASKS. That script walks the same API and attaches photographs to huts we
 * ALREADY have — a refuges.info point with no match is simply skipped there.
 * Those skipped points are exactly what this looks for.
 *
 * ⚠️ IT REPORTS; IT DOES NOT ADD. Every place in the app comes from OSM and
 * therefore self-corrects as OSM improves. Anything entered by hand never does,
 * so a candidate here is a thing for a person to look at — see the warning at
 * the top of `manualPlaces.ts` — not something to bulk-insert. The output is a
 * CSV for checking, alongside the missing-huts review.
 *
 * ⚠️ AND MOST "MISSING" HUTS ARE NOT MISSING. Running it against a nine-point
 * sample of the Rocciamelone area found eight of nine already present, matched
 * within 15 m. The value is in the residue, so the bar for reporting one is
 * deliberately high: 250 m from anything, inside a region the app ships.
 *
 *   npm run import-refuges-info          # report + CSV
 *   npm run import-refuges-info -- --gpx "path/to/export.gpx"
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRejected, readRejections } from './lib/reviewed-csv';

import { REGIONS } from '../src/constants/region';
import { appPlaces } from './lib/app-places';
import { EXTENT, allPoints, type RefugePoint } from './lib/refuges-info';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'assets', 'data', 'refuges-info-points.json');
const CSV = join(ROOT, 'refuges-info-missing.csv');

/** Far enough from everything the app has to be a genuinely different place. */
const MIN_GAP_M = 250;

const RAD = Math.PI / 180;
const metres = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(x));
};

function fromGpx(path: string): RefugePoint[] {
  const gpx = readFileSync(path, 'utf8');
  const dec = (s: string) =>
    s.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const out: RefugePoint[] = [];
  for (const m of gpx.matchAll(/<wpt lat="([-0-9.]+)" lon="([-0-9.]+)">([\s\S]*?)<\/wpt>/g)) {
    const body = m[3];
    const link = body.match(/<link href="([^"]+)"/)?.[1] ?? '';
    out.push({
      id: link.match(/\/point\/(\d+)/)?.[1] ?? link,
      lat: Number(m[1]),
      lon: Number(m[2]),
      name: dec((body.match(/<name>([^<]*)<\/name>/)?.[1] ?? '').trim()),
      link,
      kind: dec(body.match(/<type>([^<]*)<\/type>/)?.[1] ?? ''),
      elevation: Number(body.match(/<ele>([^<]*)<\/ele>/)?.[1]) || undefined,
    });
  }
  return out;
}

function regionsFor(lat: number, lon: number): string[] {
  return REGIONS.filter(
    (r) => r.bbox && lat >= r.bbox.south && lat <= r.bbox.north && lon >= r.bbox.west && lon <= r.bbox.east,
  ).map((r) => r.id);
}

async function points(): Promise<RefugePoint[]> {
  const i = process.argv.indexOf('--gpx');
  if (i !== -1 && process.argv[i + 1]) {
    const p = fromGpx(process.argv[i + 1]);
    console.log(`${p.length} waypoints read from the GPX file\n`);
    return p;
  }
  if (existsSync(CACHE) && !process.argv.includes('--refetch')) {
    const p = JSON.parse(readFileSync(CACHE, 'utf8')) as RefugePoint[];
    console.log(`${p.length.toLocaleString()} points read from the local cache (--refetch to re-ask)\n`);
    return p;
  }
  console.log('walking the refuges.info API over its whole extent…');
  const p = await allPoints((tiles, found) => {
    if (tiles % 10 === 0) process.stdout.write(`\r  ${tiles} tiles, ${found.toLocaleString()} points   `);
  });
  console.log('');
  writeFileSync(CACHE, JSON.stringify(p));
  return p;
}

async function main() {
  const pts = await points();
  const places = appPlaces();

  const inExtent = pts.filter(
    (p) => p.lon >= EXTENT.w && p.lon <= EXTENT.e && p.lat >= EXTENT.s && p.lat <= EXTENT.n,
  );
  console.log(`${pts.length.toLocaleString()} refuges.info points (${inExtent.length.toLocaleString()} inside their stated extent)`);
  console.log(`${places.length.toLocaleString()} places in the app\n`);

  const missing: Array<RefugePoint & { gap: number; nearest: string; regions: string[] }> = [];
  let matched = 0;
  let outside = 0;

  for (const p of pts) {
    let nearest = '';
    let gap = Infinity;
    for (const q of places) {
      const d = metres(p.lat, p.lon, q.lat, q.lon);
      if (d < gap) {
        gap = d;
        nearest = q.name ?? '(unnamed)';
      }
    }
    if (gap <= MIN_GAP_M) {
      matched++;
      continue;
    }
    const regions = regionsFor(p.lat, p.lon);
    if (!regions.length) {
      outside++;
      continue;
    }
    missing.push({ ...p, gap, nearest, regions });
  }

  console.log(`already in the app (≤${MIN_GAP_M} m)   ${matched.toLocaleString()}`);
  console.log(`outside every region the app ships  ${outside.toLocaleString()}`);
  console.log(`MISSING, inside a shipped region    ${missing.length.toLocaleString()}\n`);

  const byKind: Record<string, number> = {};
  for (const m of missing) byKind[m.kind || '?'] = (byKind[m.kind || '?'] ?? 0) + 1;
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`);

  const byRegion: Record<string, number> = {};
  for (const m of missing) byRegion[m.regions[0]] = (byRegion[m.regions[0]] ?? 0) + 1;
  console.log('\nby region:');
  for (const [k, v] of Object.entries(byRegion).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${k.padEnd(26)} ${v}`);
  }

  missing.sort((a, b) => b.gap - a.gap);
  console.log('\nfurthest from anything the app has — most certainly new:');
  for (const m of missing.slice(0, 12)) {
    console.log(`  ${(m.gap / 1000).toFixed(1).padStart(5)} km  ${(m.kind ?? '').padEnd(18)} ${m.name}`);
  }

  /**
   * ⚠️ THE CHECKABLE TIER, NOT EVERYTHING. 851 rows is not a list anybody
   * reviews; it is a list somebody abandons. And the bulk of it is one kind:
   * 779 `cabane non gardée`, of which 582 have NO sleeping capacity recorded at
   * all. Their own descriptions say what those are — "Abri sommaire en cas
   * d'urgence… Pas de sentier ou effondré depuis des lustres" — a rough
   * emergency shelter reached by a path that collapsed decades ago. Putting
   * those on the map as somewhere to plan a night would be worse than omitting
   * them.
   *
   * What survives is everything staffed, everything that calls itself a gîte,
   * and the unmanned cabins big enough to sleep a party: about 116 rows, which
   * includes every missing staffed refuge. `--all` writes the rest.
   */
  /**
   * ⚠️ "NO CAPACITY RECORDED" AND "SLEEPS FOUR" ARE NOT THE SAME TIER, and the
   * original all-or-nothing `--all` could not tell them apart. Of the 779
   * missing cabanes, 582 record no capacity at all — those are the emergency
   * shelters the comment above describes, and they stay out. The rest sleep a
   * known number of people, and a cabane sleeping four is somewhere walkers
   * genuinely plan around.
   *
   * `--min-places 1` therefore means "has a recorded capacity", which is the
   * useful middle tier; the default of 6 keeps the first review small; `--all`
   * still means everything, unknowns included.
   */
  const argMin = process.argv.indexOf('--min-places');
  const CABANE_MIN_PLACES = argMin >= 0 ? Number(process.argv[argMin + 1]) : 6;
  if (!Number.isFinite(CABANE_MIN_PLACES) || CABANE_MIN_PLACES < 0) {
    console.error('--min-places needs a number, e.g. --min-places 1');
    process.exit(1);
  }
  const checkable = (m: (typeof missing)[number]) =>
    m.kind !== 'cabane non gardée' || (m.places ?? 0) >= CABANE_MIN_PLACES;
  const forCsv = process.argv.includes('--all') ? missing : missing.filter(checkable);

  /**
   * ⚠️ AND A ROW ALREADY REFUSED IS NEVER ASKED ABOUT AGAIN. Rejected places
   * stay missing from the app for ever, so without this they reappear on every
   * regeneration with a blank `keep?` cell — which means yes.
   */
  const rejected = readRejections();
  const fresh = forCsv.filter((m) => !isRejected(rejected, { name: m.name, lat: m.lat, lon: m.lon }));
  const alreadyRefused = forCsv.length - fresh.length;
  const held = missing.length - forCsv.length;

  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['keep? (y/n)', 'type', 'name', 'latitude', 'longitude', 'elevation', 'sleeps', 'region', 'nearest app place', 'km away', 'refuges.info page', 'check on a map'].join(','),
    ...fresh.map((m) =>
      [
        '',
        m.kind === 'refuge gardé' ? 'alpine_hut' : m.kind === 'gîte d\'étape' ? 'guesthouse' : 'wilderness_hut',
        m.name, m.lat, m.lon, m.elevation ?? '', m.places ?? '', m.regions[0], m.nearest,
        (m.gap / 1000).toFixed(1), m.link,
        `https://www.google.com/maps?q=${m.lat},${m.lon}`,
      ].map(q).join(','),
    ),
  ];
  writeFileSync(CSV, '﻿' + lines.join('\r\n'));
  console.log(`\n-> ${CSV}   (${fresh.length} rows to check)`);
  if (alreadyRefused) {
    console.log(`   ${alreadyRefused} left out — already refused in an earlier review.`);
  }
  if (held) {
    console.log(
      `   ${held} unmanned cabanes sleeping under ${CABANE_MIN_PLACES}, or with no\n` +
        `   capacity recorded at all, were held back.\n` +
        `   --min-places 1 adds the ones with a recorded size; --all adds the rest.`,
    );
  }
  console.log('   Data: © refuges.info contributors, CC BY-SA 2.0');
}

main();
