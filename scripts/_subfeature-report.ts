/**
 * Throwaway verification for the sub-feature filter: prints exactly what
 * `isSubFeatureName` removes from the shipped region bundles, so the list can
 * be eyeballed for a legitimate lodging name before committing.
 *
 *   npx tsx scripts/_subfeature-report.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSubFeatureName, isNonLodgingPoi } from '../src/utils/lodging';
import type { Hut } from '../src/types/hut';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'data', 'regions');

let rows = 0;
let removedRows = 0;
const distinct = new Map<string, { hut: Hut; regions: string[] }>();

for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === '_meta.json') continue;
  const region = f.replace(/\.json$/, '');
  const j = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { accommodations?: Hut[] };
  for (const h of j.accommodations ?? []) {
    rows++;
    if (!isSubFeatureName(h.name)) continue;
    removedRows++;
    const e = distinct.get(h.id);
    if (e) e.regions.push(region);
    else distinct.set(h.id, { hut: h, regions: [region] });
  }
}

console.log(`shipped accommodation rows: ${rows}`);
console.log(`removed by isSubFeatureName: ${removedRows} rows, ${distinct.size} distinct OSM features\n`);

// Split by whether the existing tag filter already hid them from the user.
const visible: typeof distinct = new Map();
const already: typeof distinct = new Map();
for (const [id, e] of distinct)
  (isNonLodgingPoi(e.hut.tags ?? {}) ? already : visible).set(id, e);

const show = (title: string, m: typeof distinct) => {
  console.log(`=== ${title} (${m.size}) ===`);
  for (const { hut, regions } of [...m.values()].sort((a, b) => a.hut.name.localeCompare(b.hut.name))) {
    const t = Object.entries(hut.tags ?? {})
      .filter(([k]) => k !== 'name')
      .map(([k, v]) => `${k}=${v}`)
      .slice(0, 4)
      .join(' ');
    console.log(`  ${hut.id.padEnd(16)} ${hut.name}`);
    console.log(`  ${''.padEnd(16)}   tags: ${t || '(none)'}`);
    console.log(`  ${''.padEnd(16)}   in: ${regions.join(', ')}`);
  }
  console.log();
};

show('NEWLY HIDDEN — these are visible in the app today', visible);
show('already hidden by the tag filter; this just drops them from the files', already);
