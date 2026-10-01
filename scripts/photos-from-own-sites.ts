/**
 * Fetch a photo from each hut's OWN website, for huts whose site we already
 * know and which still have no picture.
 *
 * ⚠️ THE CLEANEST SOURCE IN THE PROJECT, AND THE LEAST USED. A photograph a hut
 * publishes on its own homepage is published by the people who run the hut, of
 * the hut, deliberately. There is no name-matching to get wrong, no index to
 * mis-attribute, no third party's compilation involved, and no question about
 * whose material it is. Compare the Brave image search, where a human review
 * rejected 46% and the residue was always a correct name in the wrong place.
 *
 * ⚠️ WHY THESE HUTS WERE MISSED. The site URL and the photo were found at
 * DIFFERENT times: the Overture import and the Brave website search filled in
 * thousands of websites AFTER the last full photo build. The full build is an
 * hour of Commons round trips and hotel-server fetches for every hut in the
 * app, so it has not been re-run since — leaving ~997 huts whose own website is
 * sitting in the data, unvisited.
 *
 * This pass asks one question of one host per hut and nothing else. No Commons,
 * no Wikidata, no search engine.
 *
 *   npx tsx scripts/photos-from-own-sites.ts            # every region
 *   npx tsx scripts/photos-from-own-sites.ts --country Austria
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchSiteImage } from '../src/api/siteImage';
import { REGIONS } from '../src/constants/region';
import type { Hut } from '../src/types/hut';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f: string) => join(ROOT, 'assets', 'data', f);
const OUT = D('own-site-photos.json');
const TRIED = `${OUT}.tried`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const COUNTRY = arg('country');

/**
 * ⚠️ FOUR, AND EACH WORKER PAUSES. Every request goes to a DIFFERENT hut's
 * server — a small Austrian guesthouse on someone's shared hosting, not a CDN.
 * Six workers with no pause is what exhausted Windows sockets on an earlier
 * sweep (TIME_WAIT), and it is also simply rude to the hosts. Four with a pause
 * finishes in twenty minutes and asks nothing of anyone.
 */
const WORKERS = 4;
const PAUSE_MS = 250;

const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});

function main() {
  const idx: Record<string, unknown[]> = read(D('photo-index.json'));
  const ref: Record<string, unknown[]> = read(D('refuges-photos.json'));
  const brave: Record<string, unknown> = read(D('brave-images.json'));
  // ⚠️ BOTH FILES USE `url`. An earlier version read `.website` from the
  // Overture file, which does not exist there — so every Overture-sourced hut
  // silently returned undefined and was dropped from the queue. The run then
  // looked complete and found almost nothing, because what it actually
  // processed was only the OSM-tagged huts the last photo build had already
  // tried and already failed on.
  const braveSites: Record<string, { url?: string } | string> = read(D('brave-websites.json'));
  const overture: Record<string, { url?: string } | string> = read(D('overture-websites.json'));
  /**
   * ⚠️ THE NEWEST SOURCE OF WEBSITES, AND THE WHOLE REASON TO RE-RUN THIS.
   * `import-hut-database` filled a website on 145 places that had none from any
   * source — so they were never queued here, never asked, and are the only
   * addresses in the project nobody has tried. A re-run without this file finds
   * them all in `.tried`-less limbo and asks nothing.
   */
  const overlay: Record<string, { website?: string }> = read(D('hut-contact-overlay.json'));
  /** Same again for the Alpenverein register — also addresses nobody has tried. */
  const avOverlay: Record<string, { website?: string }> = read(D('alpenverein-overlay.json'));
  /** tyrol.com: the site derived from the hut's own e-mail domain. */
  const tyOverlay: Record<string, { website?: string }> = read(D('tyrol-overlay.json'));

  const wanted = COUNTRY
    ? new Set(REGIONS.filter((r) => r.country === COUNTRY).map((r) => r.id))
    : null;

  /**
   * Whatever we already know, from wherever we learned it.
   *
   * ⚠️ NEWER SOURCES FIRST, AND THAT IS THE WHOLE POINT OF THIS PASS. An OSM
   * `website` tag was already visited by the last full photo build — a hut that
   * has one AND no photo is a hut whose site was tried and yielded nothing, so
   * asking again is almost pure waste. Measured: 644 such Austrian huts
   * re-asked produced 2 photos, both from sites that had changed since.
   *
   * The URLs worth visiting are the ones found AFTER that build, by the
   * Overture import and the Brave website search. Those have never been tried.
   */
  function siteOf(h: Hut): { url: string; fresh: boolean } | undefined {
    const ov = overlay[h.id]?.website;
    if (ov) return { url: ov, fresh: true };
    const av = avOverlay[h.id]?.website;
    if (av) return { url: av, fresh: true };
    const ty = tyOverlay[h.id]?.website;
    if (ty) return { url: ty, fresh: true };
    const b = braveSites[h.id];
    const bu = typeof b === 'string' ? b : b?.url;
    if (bu) return { url: bu, fresh: true };
    const o = overture[h.id];
    const ou = typeof o === 'string' ? o : o?.url;
    if (ou) return { url: ou, fresh: true };
    const tag = h.tags?.website || h.tags?.['contact:website'];
    if (tag) return { url: tag, fresh: false };
    return undefined;
  }

  const dir = join(ROOT, 'assets', 'data', 'regions');
  const todo: Hut[] = [];
  const seen = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    if (wanted && !wanted.has(f.replace('.json', ''))) continue;
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, Hut[]>;
    for (const h of [...(d.core ?? []), ...(d.accommodations ?? [])]) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      if (idx[h.id]?.length || ref[h.id]?.length || brave[h.id]) continue; // already has one
      const site = siteOf(h);
      if (!site) continue;
      // Default to the URLs never visited. --all re-asks the OSM-tagged ones too,
      // which is only worth doing long after a site might have changed.
      if (!site.fresh && !process.argv.includes('--all')) continue;
      // fetchSiteImage reads hut.website, so hand it the one we found.
      todo.push({ ...h, website: site.url });
    }
  }
  return todo;
}

async function run() {
  const todo = main();
  const found: Record<string, { url: string; credit: string; link?: string }> = read(OUT);
  const tried: Record<string, true> = read(TRIED);
  const queue = todo.filter((h) => !tried[h.id]);

  console.log(`${todo.length.toLocaleString()} huts have a known website and no photo${COUNTRY ? ` (${COUNTRY})` : ''}`);
  console.log(`${queue.length.toLocaleString()} not yet asked\n`);
  if (!queue.length) return;

  let n = 0;
  let got = 0;
  let next = 0;
  const t0 = Date.now();

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= queue.length) return;
      const hut = queue[i];
      try {
        // Build-time, so not bound by iOS ATS: read the page over http where
        // https does not answer. The IMAGE url is still forced to https and
        // still byte-verified, so nothing unusable can be stored.
        const img = await fetchSiteImage(hut, undefined, { insecurePageFallback: true });
        if (img?.url) {
          found[hut.id] = { url: img.url, credit: img.credit, link: img.link };
          got++;
        }
      } catch {
        // A dead site, a timeout, a certificate nobody renewed. Not worth a
        // retry: this whole pass is opportunistic.
      }
      tried[hut.id] = true;

      if (++n % 25 === 0) {
        writeFileSync(OUT, JSON.stringify(found));
        writeFileSync(TRIED, JSON.stringify(tried));
        const rate = n / ((Date.now() - t0) / 1000);
        process.stdout.write(
          `\r  ${n}/${queue.length}  found ${got} (${Math.round((got / n) * 100)}%)  ` +
            `~${Math.round((queue.length - n) / Math.max(rate, 0.01) / 60)} min left   `,
        );
      }
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, worker));
  writeFileSync(OUT, JSON.stringify(found));
  writeFileSync(TRIED, JSON.stringify(tried));

  console.log(`\n\n${'='.repeat(50)}`);
  console.log(`  asked          ${n.toLocaleString()}`);
  console.log(`  photos found   ${got.toLocaleString()}   ${n ? Math.round((got / n) * 100) : 0}%`);
  console.log(`\n  total held: ${Object.keys(found).length.toLocaleString()}`);
  console.log(`\n-> ${OUT}`);
  console.log('   then: npm run merge-prepared-photos');
}

run();
