/**
 * Would Openverse actually help, on the places we STILL have nothing for?
 *
 * ⚠️ MEASURED ON A RANDOM SAMPLE OF THE REAL REMAINDER, not on famous huts.
 * A first look tested "Berliner Hütte" and found 240 results, which proves
 * only that Openverse knows famous huts — the same sampling error that once
 * produced a 60% coverage estimate for a set that was really at 29%. The 11,429
 * places left are, by definition, the ones every other source could not reach.
 *
 * Flickr was tried directly earlier in this project and dropped: sparse results
 * and a paid account for almost nothing. Openverse carries much of the same
 * Flickr material, so the honest question is whether the aggregation and the
 * licence filter change the answer, or whether it is the same emptiness with a
 * better interface.
 *
 *   tsx scripts/measure-openverse.ts [sampleSize]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import {
  distinctiveTokens,
  normalizePlaceName,
  textNamesPlace,
} from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = Number(process.argv[2] ?? 60);
const PAUSE_MS = 900;

/** Licences we could use in a paid app too. `by-nc*` is excluded from this
 *  count and reported separately: fine today, a problem the day you charge. */
const COMMERCIAL_OK = /^(by|by-sa|cc0|pdm)$/i;

const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const idx: Record<string, unknown[]> = read(join(ROOT, 'assets/data/photo-index.json'));
const refuges: Record<string, unknown[]> = read(join(ROOT, 'assets/data/refuges-photos.json'));

const REGIONS = join(ROOT, 'assets', 'data', 'regions');
const byId = new Map<string, Hut>();
for (const f of readdirSync(REGIONS).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
  const d = JSON.parse(readFileSync(join(REGIONS, f), 'utf8')) as Record<string, Hut[]>;
  for (const b of ['core', 'accommodations']) {
    for (const h of d[b] ?? []) if (h.name && !byId.has(h.id)) byId.set(h.id, h);
  }
}
const need = [...byId.values()].filter(
  (h) =>
    !refuges[h.id]?.length &&
    !idx[h.id]?.length &&
    !isFallbackHutName(h.name) &&
    distinctiveTokens(normalizePlaceName(h.name)).length > 0,
);

// Even spread across the whole remainder rather than one region's worth.
const step = Math.max(1, Math.floor(need.length / SAMPLE));
const sample = need.filter((_, i) => i % step === 0).slice(0, SAMPLE);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`${need.length.toLocaleString()} places still have no photo and a searchable name`);
  console.log(`sampling ${sample.length} of them\n`);

  let anyResult = 0;
  let nameMatched = 0;
  let commercialOk = 0;
  let errors = 0;
  const shown: string[] = [];
  const bySource: Record<string, number> = {};

  for (const hut of sample) {
    const tokens = distinctiveTokens(normalizePlaceName(hut.name));
    try {
      const r = await fetch(
        `https://api.openverse.org/v1/images/?q=${encodeURIComponent(hut.name)}&page_size=8`,
        {
          headers: { Accept: 'application/json', 'User-Agent': 'AlpineHutsApp/1.0 (hut photo index)' },
          signal: AbortSignal.timeout(25_000),
        },
      );
      if (!r.ok) { errors++; await sleep(PAUSE_MS); continue; }
      const j = (await r.json()) as any;
      const results: any[] = j?.results ?? [];
      if (results.length) anyResult++;

      // ⚠️ THE SAME NAME TEST AS EVERYWHERE ELSE. "results exist" is not
      // "results about this hut" — a search for a two-word name returns
      // whatever shares a word with it.
      const match = results.find((x) =>
        textNamesPlace(normalizePlaceName(String(x?.title ?? '')), tokens),
      );
      if (match) {
        nameMatched++;
        const lic = String(match.license ?? '');
        bySource[String(match.source ?? '?')] = (bySource[String(match.source ?? '?')] ?? 0) + 1;
        if (COMMERCIAL_OK.test(lic)) commercialOk++;
        if (shown.length < 12) {
          shown.push(
            `${hut.name.slice(0, 26).padEnd(28)} ${String(match.title ?? '').slice(0, 28).padEnd(30)} ` +
            `${lic.padEnd(9)} ${String(match.source ?? '')}`,
          );
        }
      }
    } catch {
      errors++;
    }
    await sleep(PAUSE_MS);
  }

  const n = sample.length - errors;
  console.log(`${n} answered (${errors} errors, excluded)\n`);
  console.log(`  returned anything at all     ${String(anyResult).padStart(4)}  ${Math.round((anyResult / n) * 100)}%`);
  console.log(`  ...and the NAME matches      ${String(nameMatched).padStart(4)}  ${Math.round((nameMatched / n) * 100)}%   <- the real rate`);
  console.log(`  ...under a commercial-ok CC  ${String(commercialOk).padStart(4)}  ${Math.round((commercialOk / n) * 100)}%`);
  console.log(`\n  projected over all ${need.length.toLocaleString()}: ~${Math.round((nameMatched / n) * need.length).toLocaleString()} photos`);
  console.log(`  of which usable if the app ever charges: ~${Math.round((commercialOk / n) * need.length).toLocaleString()}`);
  if (Object.keys(bySource).length) {
    console.log('\n  where the matches came from:');
    for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(14)} ${v}`);
    }
  }
  console.log('\n  examples:');
  for (const s of shown) console.log(`    ${s}`);
}

main();
