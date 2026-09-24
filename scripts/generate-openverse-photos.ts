/**
 * Build-time: openly-licensed photos from Openverse, matched on the FULL name.
 *
 * ⚠️ THE FULL NAME, NOT ITS PARTS, AND THAT IS THE WHOLE TRICK. Openverse has
 * no coordinates, so nothing can confirm a match except the name itself — and
 * the project's usual token matching accepts a subset, which on these places
 * returns a landslide for "Talheimer", a Belgian villa for "La Maisonnette" and
 * a man called Max Hattl for "Hattler".
 *
 * Measured, requiring the whole name as a contiguous phrase:
 *
 *   any distinctive word    18%    mostly wrong
 *   every distinctive word  16%
 *   the whole name          15%    <- costs 3 points, buys precision
 *
 * ⚠️ AND ONLY NAMES WITH TWO OR MORE DISTINCTIVE WORDS. A one-word name is a
 * phrase of one word, so the strict rule protects nothing: "Chêne" would still
 * match another village's coat of arms. Those places are skipped outright.
 *
 * ⚠️ COMMERCIAL-SAFE LICENCES ONLY. Roughly a quarter of matches are `by-nc`,
 * usable in a free app and not in a paid one. Filtering now means the day this
 * app charges for anything, nothing has to be found and removed.
 *
 * Free, no API key. Run: npm run generate-openverse-photos
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import { distinctiveTokens, normalizePlaceName } from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'data', 'openverse-photos.json');
const TRIED = `${OUT}.tried`;

const API = 'https://api.openverse.org/v1/images/';
const PAUSE_MS = 800;
const MAX_PER_HUT = 3;
const SAVE_EVERY = 100;

/**
 * Licences that permit commercial use.
 *
 * `by-nd` is absent deliberately even though displaying an unmodified photo is
 * not a derivative work: it is one ambiguity too many for something shipped to
 * strangers, and it is 8% of matches.
 */
const COMMERCIAL_SAFE = /^(cc0|pdm|by|by-sa)$/i;

interface Photo {
  url: string;
  credit: string;
  author?: string;
  license?: string;
  link?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "CC BY-SA 4.0", or "CC0" / "Public Domain" where there is no version. */
function licenceLabel(license: string, version?: string): string {
  const l = license.toLowerCase();
  if (l === 'cc0') return 'CC0';
  if (l === 'pdm') return 'Public Domain';
  return `CC ${license.toUpperCase()}${version ? ` ${version}` : ''}`;
}

async function main() {
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

  const found: Record<string, Photo[]> = read(OUT);
  const tried: Record<string, true> = read(TRIED);

  const candidates = [...byId.values()].filter(
    (h) =>
      !refuges[h.id]?.length &&
      !idx[h.id]?.length &&
      !isFallbackHutName(h.name) &&
      distinctiveTokens(normalizePlaceName(h.name)).length >= 2 &&
      !tried[h.id],
  );

  console.log(`${candidates.length.toLocaleString()} places to ask about`);
  console.log(`${Object.keys(tried).length.toLocaleString()} already asked, ${Object.keys(found).length.toLocaleString()} held\n`);
  if (!candidates.length) { console.log('nothing to do'); return; }

  let asked = 0;
  let matched = 0;
  let rejectedLicence = 0;
  const licences: Record<string, number> = {};

  for (const hut of candidates) {
    const full = normalizePlaceName(hut.name);
    try {
      const r = await fetch(`${API}?q=${encodeURIComponent(hut.name)}&page_size=10`, {
        headers: { Accept: 'application/json', 'User-Agent': 'AlpineHutsApp/1.0 (hut photo index)' },
        signal: AbortSignal.timeout(25_000),
      });
      if (r.status === 429) {
        console.log('\n429 from Openverse — backing off 60 s.');
        await sleep(60_000);
        continue; // not marked tried: it will be retried
      }
      if (!r.ok) { tried[hut.id] = true; asked++; await sleep(PAUSE_MS); continue; }

      const j = (await r.json()) as { results?: Record<string, any>[] };
      // The whole name must appear as a phrase in the title.
      const hits = (j.results ?? []).filter((x) =>
        normalizePlaceName(String(x?.title ?? '')).includes(full),
      );
      const usable = hits.filter((x) => COMMERCIAL_SAFE.test(String(x?.license ?? '')));
      if (hits.length && !usable.length) rejectedLicence++;

      if (usable.length) {
        matched++;
        found[hut.id] = usable.slice(0, MAX_PER_HUT).map((x) => {
          const label = licenceLabel(String(x.license), x.license_version);
          licences[label] = (licences[label] ?? 0) + 1;
          const author = String(x.creator ?? '').trim() || undefined;
          return {
            url: String(x.url),
            // CC BY and BY-SA both require naming the creator; this is that,
            // not a courtesy.
            credit: author ? `${author} · ${label}` : label,
            author,
            license: label,
            // Back to the page the photo lives on, which the licences also
            // expect where practical.
            link: x.foreign_landing_url ? String(x.foreign_landing_url) : undefined,
          };
        });
      }
      tried[hut.id] = true;
      asked++;
    } catch {
      tried[hut.id] = true;
      asked++;
    }

    if (asked % SAVE_EVERY === 0) {
      writeFileSync(OUT, JSON.stringify(found, null, 0));
      writeFileSync(TRIED, JSON.stringify(tried));
      process.stdout.write(
        `\r  ${asked}/${candidates.length}  matched ${matched} (${Math.round((matched / asked) * 100)}%)  ` +
        `licence-rejected ${rejectedLicence}   `,
      );
    }
    await sleep(PAUSE_MS);
  }

  writeFileSync(OUT, JSON.stringify(found, null, 0));
  writeFileSync(TRIED, JSON.stringify(tried));

  console.log(`\n\n${'='.repeat(54)}`);
  console.log(`asked                 ${asked.toLocaleString()}`);
  console.log(`matched on full name  ${matched.toLocaleString()}  ${asked ? Math.round((matched / asked) * 100) : 0}%`);
  console.log(`dropped, licence      ${rejectedLicence.toLocaleString()}   <- by-nc / by-nd, kept out on purpose`);
  console.log(`\ntotal held: ${Object.keys(found).length.toLocaleString()}`);
  console.log('\nlicences:');
  for (const [k, v] of Object.entries(licences).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  console.log(`\n-> ${OUT}`);
  console.log('   then: npm run retry-photo-index');
}

main();
