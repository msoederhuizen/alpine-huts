/**
 * The list of places still worth an image search, built from the SHIPPED data.
 *
 * ⚠️ REBUILD IT, NEVER REUSE THE OLD CSV. brave-search-list.csv was written
 * once, months of photo passes ago: it holds places that have since been given
 * a photo by a better source, misses places added since, and its `country`
 * column is 79% empty. Searching from it spends money re-asking questions that
 * are already answered and never asks about the rest.
 *
 * Emits the columns brave-find-images reads — id, name, region, lat, lon — plus
 * geography for eyeballing. Only places with NO photo from any source, a real
 * name, and a name specific enough to verify a result against.
 *
 *   npm run build-search-list          # the strict pool
 *   npm run build-search-list -- --loose   # also single words of 8+ chars
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REGIONS, regionForPoint } from '../src/constants/region';
import type { Hut } from '../src/types/hut';
import { distinctiveTokens, normalizePlaceName } from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';
import { isSubFeatureName } from '../src/utils/lodging';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f: string) => join(ROOT, 'assets', 'data', f);
const OUT = join(ROOT, 'search-list.csv');

/**
 * ⚠️ 8, AND ONLY WITH --loose. A single distinctive word of eight or more
 * characters is usually a compound that names exactly one building:
 * "Zafernahütte", "Spiesseck", "Krottenwaldhütte". Below that it is
 * "Alpina", "Central", "Kuhalm" — names hundreds of places share.
 *
 * The earlier rule counted WORDS and never looked at how specific the word was,
 * which discarded 4,364 places, most of them findable. Being wrong in this
 * direction is expensive and silent: an excluded place is simply never asked
 * about again.
 */
const LOOSE_MIN_LEN = 8;
const LOOSE = process.argv.includes('--loose');

const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

function main() {
  const idx: Record<string, unknown[]> = read(D('photo-index.json'));
  const ref: Record<string, unknown[]> = read(D('refuges-photos.json'));

  const byId = new Map<string, Hut>();
  const regionOf = new Map<string, string>();
  const dir = join(ROOT, 'assets', 'data', 'regions');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const slug = f.replace(/\.json$/, '');
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, Hut[]>;
    for (const b of ['core', 'accommodations']) {
      for (const h of d[b] ?? []) {
        if (byId.has(h.id)) continue;
        byId.set(h.id, h);
        regionOf.set(h.id, slug);
      }
    }
  }

  const rows: string[] = [];
  let strict = 0;
  let loose = 0;

  for (const h of byId.values()) {
    if (idx[h.id]?.length || ref[h.id]?.length) continue;
    const raw = (h.name ?? '').trim();
    if (!raw || isFallbackHutName(raw) || isSubFeatureName(raw)) continue;

    const n = normalizePlaceName(raw.replace(/\s*\([^)]*\)/g, ''));
    const toks = distinctiveTokens(n);
    const words = n.split(' ').filter(Boolean).length;
    const isStrict = toks.length >= 2 || words >= 3;
    const isLoose = !isStrict && toks.length === 1 && toks[0].length >= LOOSE_MIN_LEN;
    if (!isStrict && !(LOOSE && isLoose)) continue;
    if (isStrict) strict++; else loose++;

    // Region from the file the place shipped in; the point lookup is only a
    // fallback, and the country always comes from the curated table.
    const r = REGION_BY_ID.get(regionOf.get(h.id) ?? '') ?? regionForPoint(h.lat, h.lon);
    rows.push(
      [
        h.id,
        `"${raw.replace(/"/g, '""')}"`,
        h.type ?? '',
        h.lat,
        h.lon,
        r?.id ?? '',
        r ? `"${r.name}"` : '',
        r?.country ?? '',
        isStrict ? 'strict' : 'loose',
      ].join(','),
    );
  }

  // BOM: Excel reads the file as the system codepage without one, and every
  // umlaut in these names turns to mojibake.
  writeFileSync(
    OUT,
    '﻿' + 'id,name,type,lat,lon,region,region_name,country,tier\n' + rows.join('\n'),
  );

  console.log(`places with no photo, worth searching: ${rows.length.toLocaleString()}`);
  console.log(`  strict (two words, or three)         ${strict.toLocaleString()}`);
  if (LOOSE) console.log(`  loose  (one word, ${LOOSE_MIN_LEN}+ chars)          ${loose.toLocaleString()}`);
  else console.log(`  (re-run with --loose to add single long words)`);
  console.log(`\ncost at $5/1000: $${(rows.length * 0.005).toFixed(2)}`);
  console.log(`-> ${OUT}`);
}

main();
