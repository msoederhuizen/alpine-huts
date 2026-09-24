/**
 * Find each place's website with the Brave Search API, and VERIFY it.
 *
 * ⚠️ A SEARCH RESULT IS NOT EVIDENCE. This is the failure mode the whole
 * project keeps paying for: a page that mentions "Berghaus Alpenblick" is not
 * the same thing as that hut's website. Overture and Open Data Hub avoid it by
 * matching on position, which a search cannot do — so every candidate here is
 * FETCHED and must name the place in its own markup before it is accepted.
 * Roughly half of otherwise plausible results fail that check.
 *
 * ⚠️ HARD REQUEST CAP. The free allowance is finite and overshooting it costs
 * real money. Brave calls are counted and the run STOPS at the limit, whatever
 * else is left. Resumable, so a stop is not a loss.
 *
 *   tsx scripts/brave-find-websites.ts <list.csv> [maxSearches]
 *
 * Writes assets/data/brave-websites.json, which `websiteOf()` in
 * generate-photo-index.ts picks up exactly like the Overture matches.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { distinctiveTokens, normalizePlaceName } from '../src/utils/dedupePlaces';
import { PORTAL as NOT_OWN_SITE, registrableDomain } from './siteDomain';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'data', 'brave-websites.json');
const ENV = join(ROOT, '.env');

const LIST = process.argv[2];
const MAX_SEARCHES = Number(process.argv[3] ?? 999);

/** Free tier is rate limited; one per second is under any published figure and
 *  costs us nothing but patience. */
const PAUSE_MS = 1100;
const FETCH_TIMEOUT_MS = 12_000;

/**
 * ⚠️ THE REAL TEST IS THE HOSTNAME, NOT A BLOCKLIST.
 *
 * The first run of this accepted 7 of 10 and looked like a success. Inspected,
 * one was the place's own website and six were directory pages ABOUT it:
 *
 *   Bivacco Matteo Fiori  -> gaiagps.com/hike/poi/…
 *   Waldhornalm           -> wanderlog.com/place/details/…
 *   Zimska soba           -> mapcarta.com/W498293307     (an OSM mirror!)
 *   Al Camoscio           -> visitdolomitibellunesi.com/…
 *   L'Alzarella           -> alzarella.com               <- the only real one
 *
 * Fetching the page cannot separate those: a directory page genuinely does
 * name the place, so it passes every content check. And no blocklist can ever
 * be complete — there are thousands of hiking and travel directories.
 *
 * What separates them is structural. A place's OWN site puts its name in the
 * domain; a site that writes about places does not. `alzarella.com` contains
 * "alzarella"; `wanderlog.com` contains nothing. So the distinctive words must
 * appear in the HOSTNAME, and the page check then confirms it.
 *
 * This rejects the valley-portal case (`zillertal.at/berghaus-xyz`) too. That
 * is accepted: such a page's og:image is usually the valley, not the building.
 *
 * The domain rules themselves live in ./siteDomain, in ONE copy — the same
 * logic duplicated across two files had already drifted once here.
 */

function fromEnvFile(key: string): string | undefined {
  if (!existsSync(ENV)) return undefined;
  for (const line of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split('\n');
  const cols = lines[0].split(',').map((c) => c.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const v: string[] = [];
    let cur = '';
    let q = false;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (q) {
        if (c === '"' && line[k + 1] === '"') { cur += '"'; k++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { v.push(cur); cur = ''; }
      else cur += c;
    }
    v.push(cur);
    const row: Record<string, string> = {};
    cols.forEach((c, j) => (row[c] = v[j] ?? ''));
    out.push(row);
  }
  return out;
}

const hostOf = (u: string) => u.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();

/**
 * ⚠️ THE SUBDOMAIN IS NOT THE PLACE'S. Booking portals hand each property a
 * subdomain carrying its name, which sails through a plain hostname check.
 * Measured escapes from the first full run:
 *
 *   gasperlerhof.hotelsintyrol.com
 *   appart-samson.obertauernhotelrooms.com
 *   landhaus-scherl.hotels-in-tyrol.com
 *   bergblick.italianalpshotel.com
 *
 * Every one has the property's name in the host and belongs to a portal, so
 * `registrableDomain` (in ./siteDomain) is what must carry the name — with an
 * exception for site BUILDERS, where the subdomain genuinely is the business's
 * own page.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Found {
  url: string;
  /** What convinced us. Kept so a wrong photo can be traced to its cause. */
  why: string;
  name: string;
}

/**
 * Does this page actually belong to the place?
 *
 * Fetches it and looks for the place's distinctive words in the served markup.
 * Not a Brave request, so it costs nothing against the allowance — and it is
 * the only thing standing between a plausible search result and a wrong photo.
 */
async function pageNamesPlace(url: string, tokens: string[]): Promise<boolean> {
  if (!tokens.length) return false;
  try {
    // No User-Agent spoofing, as everywhere else here: a site that refuses an
    // honest request is saying no.
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return false;
    const html = (await r.text()).slice(0, 300_000);
    const text = normalizePlaceName(html.replace(/<[^>]*>/g, ' '));
    // Every distinctive word must appear. One shared word ("berghaus") landing
    // on a directory page is precisely what this is guarding against.
    return tokens.every((t) => text.includes(t));
  } catch {
    return false;
  }
}

async function main() {
  if (!LIST || !existsSync(LIST)) {
    console.error('usage: tsx scripts/brave-find-websites.ts <list.csv> [maxSearches]');
    process.exit(1);
  }
  const key = process.env.BRAVE_API_KEY ?? fromEnvFile('BRAVE_API_KEY');
  if (!key || key === 'paste-your-key-here') {
    console.error(
      'BRAVE_API_KEY is not set in .env (or is still the placeholder).\n' +
      '  Get one from https://api-dashboard.search.brave.com and put it in .env.',
    );
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(LIST, 'utf8'));
  const found: Record<string, Found> = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : {};
  // A place already searched is not searched again, whether or not it yielded.
  const tried: Record<string, true> = existsSync(`${OUT}.tried`)
    ? JSON.parse(readFileSync(`${OUT}.tried`, 'utf8'))
    : {};

  const todo = rows.filter((r) => !tried[r.id]);
  console.log(`${rows.length} in the list, ${Object.keys(tried).length} already searched`);
  console.log(`searching up to ${Math.min(MAX_SEARCHES, todo.length)} (hard cap ${MAX_SEARCHES})\n`);

  let searches = 0;
  let accepted = 0;
  let rejectedByFetch = 0;
  let noCandidate = 0;

  for (const row of todo) {
    if (searches >= MAX_SEARCHES) {
      console.log(`\nreached the ${MAX_SEARCHES}-search cap — stopping.`);
      break;
    }

    const tokens = distinctiveTokens(normalizePlaceName(row.name));
    let results: { url: string; title: string }[] = [];
    try {
      const u =
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(row.query)}` +
        `&count=10&result_filter=web`;
      const r = await fetch(u, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': key },
        signal: AbortSignal.timeout(20_000),
      });
      searches++;
      if (r.status === 429) {
        console.log('\n429 from Brave — rate limited. Stopping rather than hammering it.');
        break;
      }
      if (!r.ok) {
        console.log(`\nBrave returned ${r.status}. Stopping.`);
        if (r.status === 401 || r.status === 403) console.log('  that is the API key.');
        break;
      }
      const j = (await r.json()) as any;
      results = (j?.web?.results ?? []).map((x: any) => ({
        url: String(x?.url ?? ''),
        title: String(x?.title ?? ''),
      }));
    } catch {
      searches++; // count it: it may well have reached them
    }

    tried[row.id] = true;

    // ⚠️ REQUIRED, not merely scored: at least one distinctive word of the
    // place's name must be in the hostname. See NOT_OWN_SITE above for the
    // measured reason — without this, six of seven "successes" were directory
    // pages about the place rather than the place's own site.
    //
    // Hostname punctuation is flattened first so `berghaus-alpina.at` and
    // `berghausalpina.at` both match "berghaus" and "alpina".
    const scored = results
      .filter((x) => /^https?:\/\//i.test(x.url) && !NOT_OWN_SITE.test(x.url))
      .map((x, i) => {
        // The REGISTRABLE domain, not the hostname — see registrableDomain.
        const bare = registrableDomain(hostOf(x.url));
        const host = normalizePlaceName(bare.replace(/[.-]/g, ' '));
        const squashed = bare.replace(/[^a-z0-9]/g, '');
        const inHost = (t: string) => host.includes(t) || squashed.includes(t);
        const hits = tokens.filter(inHost).length;
        if (!hits) return null; // not this place's own domain
        const title = normalizePlaceName(x.title);
        let score = Math.max(0, 3 - i * 0.3) + hits * 3;
        if (tokens.every(inHost)) score += 4;
        if (tokens.length && tokens.every((t) => title.includes(t))) score += 2;
        return { ...x, score };
      })
      .filter((x): x is { url: string; title: string; score: number } => !!x)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      noCandidate++;
    } else {
      // Verify the best two only — beyond that the score is too weak to bother.
      let ok = false;
      for (const cand of scored.slice(0, 2)) {
        if (await pageNamesPlace(cand.url, tokens)) {
          found[row.id] = {
            url: cand.url.replace(/\/+$/, ''),
            why: `brave, verified on page (score ${cand.score.toFixed(1)})`,
            name: row.name,
          };
          accepted++;
          ok = true;
          break;
        }
      }
      if (!ok) rejectedByFetch++;
    }

    if (searches % 25 === 0) {
      writeFileSync(OUT, JSON.stringify(found, null, 0));
      writeFileSync(`${OUT}.tried`, JSON.stringify(tried));
      process.stdout.write(
        `\r  ${searches}/${Math.min(MAX_SEARCHES, todo.length)}  accepted ${accepted}  ` +
        `page-check rejected ${rejectedByFetch}  no candidate ${noCandidate}   `,
      );
    }
    await sleep(PAUSE_MS);
  }

  writeFileSync(OUT, JSON.stringify(found, null, 0));
  writeFileSync(`${OUT}.tried`, JSON.stringify(tried));

  console.log(`\n\n${'='.repeat(56)}`);
  console.log(`brave searches used   ${searches}`);
  console.log(`websites accepted     ${accepted}   ${searches ? ((accepted / searches) * 100).toFixed(0) : 0}%`);
  console.log(`rejected by the page check  ${rejectedByFetch}   <- looked right, was not`);
  console.log(`no usable candidate   ${noCandidate}`);
  console.log(`\ntotal held in ${OUT}: ${Object.keys(found).length}`);
  console.log('\nnow run `npm run retry-photo-index` to turn these into photos.');
}

main();
