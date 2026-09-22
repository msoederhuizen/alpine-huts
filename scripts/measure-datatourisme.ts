/** How many of our photoless places does DATAtourisme reach?
 *  Run: tsx scripts/measure-datatourisme.ts <extracted-flux-dir> */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import { resolveDatatourisme } from './datatourismePhotos';

const DIR = process.argv[2];
if (!DIR) {
  console.error('usage: tsx scripts/measure-datatourisme.ts <extracted-flux-dir>');
  process.exit(1);
}

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

async function main() {
  const found = await resolveDatatourisme(need, DIR, (s) => console.log(s));
  console.log(`\n${need.length.toLocaleString()} of our places still have no photo`);
  console.log(`matched in DATAtourisme: ${found.size.toLocaleString()}\n`);

  const byType: Record<string, number> = {};
  let shown = 0;
  for (const [id, photos] of found) {
    const h = byId.get(id)!;
    byType[h.type] = (byType[h.type] ?? 0) + 1;
    if (shown++ < 12) {
      console.log(`  ${h.name.slice(0, 30).padEnd(31)} ${photos.length}p  ${photos[0].credit.slice(0, 46)}`);
    }
  }
  console.log('\nby type:');
  for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(16)} ${c}`);
  }
}

main();
