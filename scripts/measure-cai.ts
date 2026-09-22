/** How many of our photoless places does the CAI register reach?
 *  Run: tsx scripts/measure-cai.ts */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import { resolveCai } from './caiPhotos';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGIONS = join(ROOT, 'assets', 'data', 'regions');

const idx: Record<string, unknown[]> = existsSync(join(ROOT, 'assets/data/photo-index.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'assets/data/photo-index.json'), 'utf8'))
  : {};
const refuges: Record<string, unknown[]> = existsSync(join(ROOT, 'assets/data/refuges-photos.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'assets/data/refuges-photos.json'), 'utf8'))
  : {};

const byId = new Map<string, Hut>();
for (const f of readdirSync(REGIONS).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
  const d = JSON.parse(readFileSync(join(REGIONS, f), 'utf8')) as Record<string, Hut[]>;
  for (const b of ['core', 'accommodations']) {
    for (const h of d[b] ?? []) if (h.name && !byId.has(h.id)) byId.set(h.id, h);
  }
}
const need = [...byId.values()].filter((h) => !refuges[h.id]?.length && !idx[h.id]?.length);

// Wrapped rather than top-level await: tsx transforms these to CJS, which has
// no top-level await. Every other script here has the same shape.
async function main() {
  const found = await resolveCai(need, (s) => process.stdout.write(`${s}\r`));
  console.log(`\n\n${need.length.toLocaleString()} of our places still have no photo`);
  console.log(`matched in the CAI register: ${found.size.toLocaleString()}\n`);

  const byType: Record<string, number> = {};
  let shown = 0;
  for (const [id, photos] of found) {
    const h = byId.get(id)!;
    byType[h.type] = (byType[h.type] ?? 0) + 1;
    if (shown++ < 12) {
      console.log(`  ${h.name.slice(0, 34).padEnd(35)} ${photos.length} photo(s)  ${photos[0].url.slice(0, 62)}`);
    }
  }
  console.log('\nby type:');
  for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(16)} ${c}`);
  }
}

main();
