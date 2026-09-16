/**
 * Reduce the tag bag on every hut in `assets/data/regions/*.json` to the keys
 * in `src/constants/hutTags.ts`.
 *
 * WHEN TO RUN THIS: after adding (or removing) a key in `KEPT_HUT_TAGS`. Takes
 * a few seconds and touches NO network — no Overpass, no elevation quota — so
 * widening the whitelist is cheap. That is the whole point of keeping the
 * untrimmed master in `huts-bundle.json`.
 *
 * ⚠️ Works on the REGION FILES IN PLACE rather than re-deriving them from the
 * master. `writePerRegion` deliberately skips a region whose fetch came back
 * incomplete, leaving its existing file alone — so a region file can be NEWER
 * than what the master would produce right now. Editing in place can't lose
 * that; regenerating could.
 *
 * Idempotent: a hut that already carries `tagCount` keeps it, so running twice
 * never scores a hut by its already-trimmed bag.
 *
 * Run: npm run trim-region-tags
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trimHutTags } from '../src/constants/hutTags';
import type { Hut } from '../src/types/hut';

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'data',
  'regions',
);

interface RegionFile {
  core: Hut[];
  accommodations: Hut[];
  villages: Hut[];
  rides?: unknown;
}

function trim(h: Hut): Hut {
  const { tags, tagCount } = trimHutTags(h.tags ?? {});
  // Keep an existing count — on a second run `h.tags` is already trimmed, so a
  // freshly computed count would be the KEPT total, not the original.
  return { ...h, tags, tagCount: h.tagCount ?? tagCount };
}

const files = readdirSync(DIR).filter(
  (f) => f.endsWith('.json') && f !== '_meta.json',
);

let before = 0;
let after = 0;
let huts = 0;

for (const file of files) {
  const path = join(DIR, file);
  before += statSync(path).size;

  const d = JSON.parse(readFileSync(path, 'utf8')) as RegionFile;
  const out: RegionFile = {
    core: (d.core ?? []).map(trim),
    accommodations: (d.accommodations ?? []).map(trim),
    villages: (d.villages ?? []).map(trim),
    // ⚠️ OMITTED, not `[]`, when absent — `bundledRides` reads undefined as
    // "fetch live" and `[]` as "there are genuinely no lifts here".
    ...(d.rides ? { rides: d.rides } : {}),
  };
  huts += out.core.length + out.accommodations.length + out.villages.length;

  writeFileSync(path, JSON.stringify(out));
  after += statSync(path).size;
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
console.log(
  `${files.length} region files, ${huts.toLocaleString()} huts\n` +
    `  ${mb(before)} MB -> ${mb(after)} MB ` +
    `(-${(((before - after) / before) * 100).toFixed(0)}%, ` +
    `${mb(before - after)} MB saved)`,
);
