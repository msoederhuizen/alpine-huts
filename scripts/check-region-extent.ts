/**
 * Check every region's hut data against its villages, without fetching anything.
 *
 * The same test `generate-huts` now runs before it stamps a dataset complete —
 * exposed on its own because it is instant, needs no network, and answers the
 * one question you cannot answer by looking at a hut count: is this region's
 * data actually whole? See `lib/region-extent.ts` for why villages are the
 * yardstick.
 *
 *   npm run check-regions
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import { KNOWN_UNEVEN, SHORTFALL_KM, extentShortfall } from './lib/region-extent';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'data', 'regions');

function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== '_meta.json');
  const bad: string[] = [];
  let judged = 0;

  for (const f of files.sort()) {
    const id = f.replace('.json', '');
    const d = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Record<string, Hut[]>;
    const huts = [...(d.core ?? []), ...(d.accommodations ?? [])];
    const villages = d.villages ?? [];
    const short = extentShortfall(id, huts, villages);
    if (short === undefined && (huts.length < 20 || villages.length < 10)) {
      console.log(`  ·  ${id.padEnd(26)} too few points to judge (${huts.length} huts, ${villages.length} villages)`);
      continue;
    }
    if (id in KNOWN_UNEVEN) {
      console.log(`  ~  ${id.padEnd(26)} known uneven, not a truncation — see lib/region-extent.ts`);
      continue;
    }
    judged++;
    if (short) {
      bad.push(id);
      console.log(`  ⚠  ${id.padEnd(26)} huts stop ${String(short.km).padStart(3)} km short on the ${short.side}  (${short.huts} huts)`);
    } else {
      console.log(`  ✓  ${id.padEnd(26)} reaches its villages on every side  (${huts.length} huts)`);
    }
  }

  console.log(`\n${judged} regions judged, ${bad.length} truncated (threshold ${SHORTFALL_KM} km)`);
  if (bad.length) {
    console.log(`\nTo refetch just these, delete their core+accommodations keys from`);
    console.log(`assets/data/huts-bundle.json and re-run \`npm run generate-huts\`:`);
    console.log(`  ${bad.join(', ')}`);
    process.exitCode = 1;
  }
}

main();
