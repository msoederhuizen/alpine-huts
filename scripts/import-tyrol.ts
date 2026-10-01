/**
 * Merge the Tirol Werbung hut directory (tyrol.com) into the app's data.
 *
 * ⚠️ WHAT THIS SOURCE UNIQUELY HAS IS THE E-MAIL ADDRESS. The Alpenverein
 * register already covers Tirol more completely — 280 huts against this
 * directory's 172 — and carries websites, telephone numbers and public
 * transport that this does not. What it does NOT carry is an e-mail address for
 * anybody, and the hut detail screen renders one. So that is the field worth
 * coming here for; phone and altitude are taken too, but only where nothing
 * else has already supplied them.
 *
 * ⚠️ IT DOES NOT TAKE THEIR PHOTOGRAPHS. Every image on the site is credited to
 * Tirol Werbung or to the hut's own photographer — "© Tirol Werbung/Christian
 * Klingler", "© Carola & Achim Zinßer" — and none of them is offered under a
 * licence this app could rely on. The project's rule stands: photographs come
 * from the hut's OWN site. What this import contributes to photo coverage is
 * the e-mail DOMAIN, which is a strong candidate for a hut's own website and is
 * handed to `photos-from-own-sites` to try.
 *
 * ⚠️ AND IT ASKS HONESTLY. No spoofed User-Agent; the app identifies itself.
 * robots.txt disallows only `?id=`, `L=0` and the TYPO3 internals, not these
 * pages. One request at a time with a pause — about 200 in total, which is a
 * couple of minutes and asks almost nothing of the server.
 *
 *   npm run import-tyrol            # report
 *   npm run import-tyrol -- --write
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appPlaces, isPlaceholderName, pickField, samePhone, sameSite } from './lib/app-places';
import { MAX_METRES, MAX_METRES_UNCORROBORATED, corroborate, matchByPosition, type SourceRow } from './lib/place-matcher';
import { type Provenance, writeProvenance } from './lib/provenance';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'data', 'tyrol-overlay.json');
const CACHE = join(ROOT, 'assets', 'data', 'tyrol-huts.json');
const WRITE = process.argv.includes('--write');
const REFETCH = process.argv.includes('--refetch');

const LIST = 'https://www.tyrol.com/activities/sport/hiking/refuge-huts/all-huts';
const UA = 'AlpineHutsApp/1.0 (hut-to-hut hiking app; margot.soederhuizen@live.nl)';

interface Row extends SourceRow {
  phone?: string;
  email?: string;
  /** Derived from the e-mail domain, and only kept once it answers. */
  site?: string;
  elevation?: string;
  url: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** Every hut's detail-page URL, by paging the listing six at a time. */
async function hutUrls(): Promise<string[]> {
  const urls = new Set<string>();
  let total = Infinity;
  for (let pos = 1; urls.size < total && pos <= 60; pos++) {
    const raw = await get(`${LIST}?listpos=${pos}&type=1000&extension=content`);
    const j = JSON.parse(raw) as { content?: { numberOfElements?: number; content?: string } };
    if (typeof j.content?.numberOfElements === 'number') total = j.content.numberOfElements;
    const html = j.content?.content ?? '';
    const before = urls.size;
    for (const m of html.matchAll(/href="(https:\/\/www\.tyrol\.com\/[^"]*all-huts\/[^"#?]+)"/g)) {
      urls.add(m[1]);
    }
    // The listing has run out; stop rather than hammer a static tail.
    if (urls.size === before) break;
    process.stdout.write(`\r  listing ${urls.size}/${total === Infinity ? '?' : total}   `);
    await sleep(300);
  }
  console.log('');
  return [...urls];
}

/**
 * Free mailbox providers, whose domain says nothing about the hut.
 *
 * ⚠️ THE WHOLE WEBSITE DERIVATION HANGS ON THIS LIST. "info@ambergerhuette.at"
 * means the hut owns ambergerhuette.at; "ambergerhuette@gmail.com" means only
 * that somebody has a Google account. Deriving a site from the second would put
 * gmail.com in front of a walker as a hut's homepage.
 */
const FREE_MAIL =
  /^(gmail|googlemail|gmx|web|hotmail|outlook|live|yahoo|aon|a1|chello|t-online|icloud|me|mac|libero|alice|tiscali|virgilio|bluewin|hispeed|sunrise|protonmail|proton|posteo|mail|email|inbox|freenet)\./i;

/**
 * Pull the facts off one detail page.
 *
 * ⚠️ FROM ITS JSON-LD, NOT FROM THE MARKUP. Every page carries a schema.org
 * `Place` block with the name, the coordinates and a PostalAddress holding the
 * e-mail and telephone number — structured, stable, and meant to be read. An
 * earlier version scraped the HTML instead and silently produced nothing for
 * all 172 huts, because `<h1 class="headline">` opens with a nested `<span>`
 * and the name regex matched an empty string.
 *
 * The block's `image` array is deliberately ignored: those photographs are
 * Tirol Werbung's and the huts' own photographers', under no licence this app
 * can rely on.
 */
function parseDetail(html: string, url: string): Row | undefined {
  const block = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!block) return undefined;

  let ld: {
    name?: string;
    geo?: { latitude?: number; longitude?: number };
    address?: { email?: string; telephone?: string };
    description?: string;
  };
  try {
    ld = JSON.parse(block);
  } catch {
    return undefined;
  }

  const lat = Number(ld.geo?.latitude);
  const lon = Number(ld.geo?.longitude);
  if (!ld.name || !Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

  const email = ld.address?.email?.trim().toLowerCase();
  // "0043/676/9523426" — slashes are group separators, as in the Alpenverein
  // register; the app puts this straight into a `tel:` link.
  const phone = ld.address?.telephone?.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();

  // The altitude is written into the prose: "(2,135 metres)".
  const ele = ld.description?.match(/\(([\d.,]{3,6})\s*met/i)?.[1]?.replace(/[.,]/g, '');

  const domain = email?.split('@')[1];
  const site = domain && !FREE_MAIL.test(`${domain}.`) ? `https://www.${domain}` : undefined;

  return {
    name: ld.name.trim(),
    lat,
    lon,
    url,
    phone: phone || undefined,
    email,
    site,
    elevation: ele && Number(ele) >= 150 && Number(ele) <= 4600 ? ele : undefined,
  };
}

async function collect(): Promise<Row[]> {
  if (!REFETCH && existsSync(CACHE)) {
    const rows = JSON.parse(readFileSync(CACHE, 'utf8')) as Row[];
    console.log(`${rows.length} huts read from the local cache (--refetch to re-ask tyrol.com)\n`);
    return rows;
  }
  console.log('paging the directory…');
  const urls = await hutUrls();
  console.log(`${urls.length} hut pages to read\n`);
  const rows: Row[] = [];
  for (const [i, u] of urls.entries()) {
    try {
      const row = parseDetail(await get(u), u);
      if (row) rows.push(row);
    } catch {
      // One dead page is not worth failing the run over.
    }
    if ((i + 1) % 10 === 0) process.stdout.write(`\r  ${i + 1}/${urls.length}   `);
    await sleep(300);
  }
  console.log('');
  if (rows.length) writeFileSync(CACHE, JSON.stringify(rows, null, 1));
  else console.error('Parsed nothing — NOT caching, so the next run re-asks.');
  return rows;
}

async function main() {
  const rows = await collect();
  const huts = appPlaces();
  console.log(`${rows.length} huts from tyrol.com`);
  console.log(`  with an e-mail address: ${rows.filter((r) => r.email).length}`);
  console.log(`  with a telephone number: ${rows.filter((r) => r.phone).length}`);
  console.log(`${huts.length.toLocaleString()} places in the app\n`);

  const m = matchByPosition(rows, huts);
  const overlay: Record<string, Record<string, string>> = {};
  const provenance: Record<string, Provenance> = {};
  const gains = { email: 0, phone: 0, website: 0, elevation: 0 };
  let notALodging = 0;
  let tooFar = 0;
  let disagreed = 0;
  const examples: string[] = [];

  for (const [id, list] of m.claims) {
    const hut = m.byId.get(id)!;
    const nearest = list.reduce((a, b) => (b.m < a.m ? b : a));
    const rows_ = list.map((c) => c.row);

    const verdict = corroborate(nearest.row.name, undefined, hut, nearest.m, isPlaceholderName);
    if (!verdict.write) {
      if (verdict.why === 'not-a-lodging') notALodging++;
      else tooFar++;
      continue;
    }
    if (verdict.disagrees) {
      disagreed++;
      examples.push(`${String(Math.round(nearest.m)).padStart(4)} m  "${nearest.row.name}"  vs app "${hut.name}"`);
    }

    const tags = hut.tags ?? {};
    const add: Record<string, string> = {};

    const email = pickField(rows_, (r) => r.email, (v) => v.toLowerCase()).value;
    if (email && !(tags.email || tags['contact:email'])) { add.email = email; gains.email++; }

    const phone = pickField(rows_, (r) => r.phone, samePhone).value;
    if (phone && !(tags.phone || tags['contact:phone'])) { add.phone = phone; gains.phone++; }

    const site = pickField(rows_, (r) => r.site, sameSite).value;
    if (site && !(tags.website || tags['contact:website'] || tags.url || hut.website)) {
      add.website = site;
      gains.website++;
    }

    const ele = pickField(rows_, (r) => r.elevation).value;
    if (ele && !tags.ele && hut.elevation == null) { add.ele = ele; gains.elevation++; }

    if (Object.keys(add).length) {
      overlay[id] = add;
      provenance[id] = {
        source: 'tyrol.com',
        appName: hut.name ?? '(unnamed)',
        lat: hut.lat,
        lon: hut.lon,
        rowName: nearest.row.name,
        metres: Math.round(nearest.m),
        how: nearest.how,
        insteadOf: nearest.insteadOf,
        nameDisagrees: Boolean(verdict.disagrees),
        fields: add,
      };
    }
  }

  console.log(`matched on position (≤${MAX_METRES} m)   ${m.matched}`);
  console.log(`  of those, names disagree        ${disagreed}`);
  console.log(`  refused, row is not a lodging   ${notALodging}`);
  console.log(`  refused, unconfirmed past ${MAX_METRES_UNCORROBORATED} m  ${tooFar}`);
  console.log(`moved onto the place that carries the name ${m.redirected}`);
  console.log(`matched further out on an exact name  ${m.widened}`);
  console.log(`no place found at all                 ${m.unmatched}\n`);
  console.log('fields the app is missing and this fills:');
  for (const [k, v] of Object.entries(gains)) console.log(`  ${k.padEnd(10)} ${v}`);
  console.log(`\nplaces gaining at least one field: ${Object.keys(overlay).length}`);

  if (examples.length) {
    console.log('\nname disagreements, furthest first:');
    examples.sort((a, b) => parseInt(b) - parseInt(a));
    for (const e of examples.slice(0, 12)) console.log('  ' + e);
  }
  if (m.redirectedRows.length) {
    console.log('\nmoved off a NEARER place onto the one that carries the name:');
    for (const r of m.redirectedRows) console.log('  ' + r);
  }
  if (m.widenedRows.length) {
    console.log('\nmatched beyond 250 m because the name is unmistakable:');
    for (const w of m.widenedRows) console.log('  ' + w);
  }

  if (WRITE) {
    writeFileSync(OUT, JSON.stringify(overlay, null, 1));
    writeProvenance(OUT.replace(/\.json$/, '-provenance.json'), provenance);
    console.log(`\n-> ${OUT}`);
  } else {
    console.log('\n(report only — pass --write to save the overlay)');
  }
}

main();
