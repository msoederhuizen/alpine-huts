/**
 * Photos from Brave's general web image index, matched on the full name.
 *
 * ⚠️ HOW THIS DIFFERS FROM EVERY OTHER SOURCE HERE, and it is not a small
 * difference. refuges.info, Overture, Open Data Hub and CAI are confirmed by
 * POSITION. Wikimedia P18 is bound to the entity. Openverse is at least
 * confirmed by the full name AND carries the photographer's licence.
 *
 * This has neither. A web image index returns pictures that match WORDS, from
 * whatever page hosts them, with no licence and no coordinate. So:
 *
 *   - the full name must appear, as a phrase, in the image's title or its
 *     source page URL — a subset match on a one-word name is how "Talheimer"
 *     became a landslide and "La Maisonnette" a villa in Belgium
 *   - names with fewer than two distinctive words are skipped entirely
 *   - the SOURCE PAGE is stored with every photo, so that anything here can be
 *     traced to where it came from and removed if asked
 *
 * ⚠️ THE CREDIT NAMES AN INDEX, NOT A RIGHTS HOLDER. Brave did not take these
 * photographs and cannot license them; "via Brave Search" records where we
 * found it, which is traceability rather than permission. Every other source in
 * this project can name the photographer or the site that published the image
 * for sharing. This one cannot. That is a deliberate, informed choice by the
 * app's owner, and the `source` field exists so it can be undone cleanly.
 *
 * ⚠️ HARD REQUEST CAP. Searches cost money past the free monthly allowance.
 * Calls are counted and the run stops at the limit. Resumable.
 *
 *   tsx scripts/brave-find-images.ts <list.csv> [maxSearches]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { looksLikeAPhoto } from '../src/api/siteImage';
import { distinctiveTokens, normalizePlaceName } from '../src/utils/dedupePlaces';
import { isSubFeatureName } from '../src/utils/lodging';
import { NEVER } from './siteDomain';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'data', 'brave-images.json');
const TRIED = `${OUT}.tried`;
const ENV = join(ROOT, '.env');

const LIST = process.argv[2];
const MAX_SEARCHES = Number(process.argv[3] ?? 1000);
const PAUSE_MS = 1100;

/** Hosts whose "photo" is not a photograph of the place: map tiles, logos,
 *  avatars. NEVER is shared with the website search — see ./siteDomain. */
/**
 * ⚠️ A MAP IS THE COMMONEST WRONG "PHOTO", AND IT PASSES EVERY OTHER CHECK.
 * It is a large JPEG, so the byte gate accepts it; it sits on a page named
 * after the hut, so the name gate accepts it. Measured on a sample of 20
 * banked results, 2 were maps — 10%, the single largest error class:
 *
 *   peakvisor.com/tiles/styles/peaksummer-jpg/static/11.729921,46.186664,14/…
 *   worldmaps.reliefmaps.io/styles/ReliefMaps/static/auto/1024x512.webp?path=7.44…
 *
 * A PAIR OF DECIMAL COORDINATES IN THE URL is the tell that catches both and
 * generalises to tile servers we have not seen: photographs are not addressed
 * by latitude.
 *
 * `/default/` is here for the same reason — freizeitmonster served
 * `assets/images/default/others/almhuette-29.jpg`, a stock hut that is not
 * anyone's hut, from a correctly-named page.
 */
const BAD_IMAGE =
  /(mapcarta|openstreetmap|reliefmaps|tile\.|\/tiles?\/|staticmap|googleusercontent\/maps|-?\d+\.\d+,\s*-?\d+\.\d+|\/default\/|placeholder|logo|favicon|avatar|sprite)/i;

/**
 * OSM names that describe a FEATURE OF a place rather than the place itself
 * ("Helipad Rifugio Coldai", "Teleferica Rifugio Stoppani") now live in
 * utils/lodging.ts as {@link isSubFeatureName}, because they are excluded from
 * the dataset itself and not merely from this search.
 *
 * They still matter here: searching one is worse than useless, because the
 * results are photographs of the refuge, which is a real building that is NOT
 * the thing our record points at — a good-looking match would hang a hut's
 * photo on a helicopter pad or a cable winch. Kept as a belt-and-braces check
 * so a stale list (this script reads a CSV snapshot) can't resurrect one.
 */

/**
 * Does `title` name this place?
 *
 * ⚠️ TWO RULES, AND THE ORDER MATTERS. The contiguous phrase is the strong one
 * and is tried first. The ordered-subsequence fallback exists because a strict
 * phrase match rejected a quarter of a measured sample for reasons that were
 * nothing to do with the photo being wrong:
 *
 *   "Bergerie d'Asinau"     vs "bergerie asinau chez aline GR20"   (elided d')
 *   "Rifugio Piezza - Da Aurelio" vs "Rifugio Piezza Ristorante da Aurelio"
 *   "Casera La Varetta"     vs "La conca di Casera de la Varetta"  (inserted de)
 *
 * In each case every distinctive word is present AND IN THE SAME ORDER, with
 * only filler between. That is a much stronger claim than "shares a word",
 * which is the rule that once returned a landslide for "Talheimer".
 *
 * ⚠️ IT STILL REJECTS THE NEAR-MISSES THAT MATTER. "Lovska koča nad Malim
 * poljem" does not match "Lovska koča na Mali Poljani" — a different hut — and
 * "Helipad Rifugio Coldai - Civetta" does not match a photo captioned only
 * "Rifugio Coldai", because `helipad` is absent. Both were checked.
 *
 * Deliberately NOT edit distance. One letter is the difference between
 * Rifugio Vandelli and Rifugio Vandolli, and between two real neighbouring
 * bergerie; fuzziness here buys recall by attaching wrong buildings.
 *
 * ⚠️ WHOLE WORDS ONLY, AND THIS WAS A REAL BUG. Both checks used raw substring
 * matching, so our "Châlet de la Petite Berge" matched a TripAdvisor photo of
 * "La Petite Bergerie" — `berge` sits inside `bergerie`. Padding with spaces
 * for the phrase, and comparing word-for-word for the subsequence, costs
 * nothing: every near-miss this function was written to recover still passes,
 * because those differ by inserted filler, not by truncated words.
 */
function titleNames(title: string, full: string, tokens: string[]): boolean {
  if (` ${title} `.includes(` ${full} `)) return true;
  if (tokens.length < 2) return false; // one word in order is not evidence
  const words = title.split(' ');
  let at = 0;
  for (const t of tokens) {
    while (at < words.length && words[at] !== t) at++;
    if (at >= words.length) return false;
    at++;
  }
  return true;
}

interface Found {
  url: string;
  credit: string;
  /** Where it was found. Kept so every photo here can be traced and, if a
   *  photographer objects, removed without touching anything else. */
  source: string;
  name: string;
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!LIST || !existsSync(LIST)) {
    console.error('usage: tsx scripts/brave-find-images.ts <list.csv> [maxSearches]');
    process.exit(1);
  }
  const key = process.env.BRAVE_API_KEY ?? fromEnvFile('BRAVE_API_KEY');
  if (!key || key === 'paste-your-key-here') {
    console.error('BRAVE_API_KEY is not set in .env.');
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(LIST, 'utf8'));
  const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
  const found: Record<string, Found> = read(OUT);
  const tried: Record<string, true> = read(TRIED);

  /**
   * Re-apply the current filters to everything already banked, and FORGET the
   * ones that no longer pass so they are searched again.
   *
   * ⚠️ FILTERS GET TIGHTER AFTER YOU LOOK AT THE RESULTS, AND THE ALREADY-SAVED
   * ROWS DO NOT FIX THEMSELVES. Every tightening here came from inspecting a
   * sample, which means the rows collected before it are exactly the ones
   * carrying the fault. Dropping them from `found` AND from `tried` is what
   * makes the next run re-ask; dropping them from `found` alone would leave
   * them permanently unsearched, which is how a "miss" silently became
   * unrecoverable earlier in this project.
   */
  let dropped = 0;
  for (const [id, f] of Object.entries(found)) {
    if (!BAD_IMAGE.test(f.url)) continue;
    delete found[id];
    delete tried[id];
    dropped++;
  }
  if (dropped) console.log(`re-checked what was already banked: dropped ${dropped} (maps, stock art) for re-search\n`);

  /**
   * The name we actually search on, with any parenthetical dropped.
   *
   * ⚠️ 88 NAMES CARRY ONE AND IT IS ALWAYS AN ANNOTATION, NOT PART OF THE NAME:
   * "Auberge La Boerne (gîte d'étape du GR du TMB)". No caption anywhere writes
   * that, so keeping it guaranteed a miss on a place whose photo was sitting in
   * the first result.
   */
  const searchName = (raw: string) => raw.replace(/\s*\([^)]*\)/g, '').trim();

  /**
   * Worth spending a request on.
   *
   * Two distinctive words, OR three words of any kind: "Auberge La Boerne"
   * yields only one distinctive token once the parenthetical goes, but a
   * three-word phrase matched contiguously is specific enough to trust. The
   * one-and-two-word names stay excluded — that is where guessing starts.
   */
  const eligible = (raw: string) => {
    const n = normalizePlaceName(searchName(raw));
    return distinctiveTokens(n).length >= 2 || n.split(' ').filter(Boolean).length >= 3;
  };

  const todo = rows.filter(
    (r) => !tried[r.id] && !isSubFeatureName(r.name) && eligible(r.name),
  );

  console.log(`${rows.length.toLocaleString()} in the list`);
  console.log(`${todo.length.toLocaleString()} have a two-word name and have not been searched`);
  console.log(`cap: ${MAX_SEARCHES} searches (~$${(MAX_SEARCHES * 0.005).toFixed(2)} beyond the free allowance)\n`);

  let searches = 0;
  let accepted = 0;
  let noMatch = 0;
  let tooSmall = 0;

  for (const row of todo) {
    if (searches >= MAX_SEARCHES) {
      console.log(`\nreached the ${MAX_SEARCHES}-search cap — stopping.`);
      break;
    }
    const clean = searchName(row.name);
    const full = normalizePlaceName(clean);
    const tokens = distinctiveTokens(full);

    try {
      // The quoted name ALONE — deliberately not the CSV's `query`, which
      // appends our region name. That extra term helps a web search pick the
      // right Rifugio; in an image search it is ANDed against the hosting page
      // and quietly excludes good photos, because image captions rarely name
      // the massif. Recall comes from the broad query, precision from the
      // full-name check below — not from narrowing the query.
      const u =
        `https://api.search.brave.com/res/v1/images/search` +
        `?q=${encodeURIComponent(`"${clean}"`)}&count=20&safesearch=strict`;
      const r = await fetch(u, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': key },
        signal: AbortSignal.timeout(25_000),
      });
      searches++;
      if (r.status === 429) { console.log('\n429 — rate limited, stopping.'); break; }
      if (r.status === 402) { console.log('\n402 — credit exhausted, stopping.'); break; }
      if (!r.ok) { console.log(`\nHTTP ${r.status}, stopping.`); break; }

      const j = (await r.json()) as { results?: Record<string, any>[] };
      const results = j.results ?? [];

      // The name must be in the image's title or its source page URL — see
      // titleNames for exactly how much slack that allows and why.
      const candidates = results.filter((x) => {
        const title = normalizePlaceName(String(x?.title ?? ''));
        const page = String(x?.url ?? '');
        const pageWords = normalizePlaceName(page.replace(/[^a-zA-Z0-9]+/g, ' '));
        const img = String(x?.properties?.url ?? x?.thumbnail?.src ?? '');
        if (!img || !/^https:\/\//i.test(img)) return false;
        if (NEVER.test(page) || BAD_IMAGE.test(img)) return false;
        return titleNames(title, full, tokens) || titleNames(pageWords, full, tokens);
      });

      // ⚠️ Check the BYTES of the first few, not just the first. A name match
      // is no guarantee of a usable picture: the pilot accepted
      // `hribi.net/slike1/P8190522711360.th.jpg` — a 150 px thumbnail — which
      // would have shipped as a hut's photo. looksLikeAPhoto is the same gate
      // the website scraper uses, imported rather than copied, because the last
      // time this logic existed twice one copy kept an EXIF bug for months.
      let hit: Record<string, any> | undefined;
      let img = '';
      for (const c of candidates.slice(0, 4)) {
        const u2 = String(c.properties?.url ?? c.thumbnail?.src ?? '');
        if (await looksLikeAPhoto(u2)) { hit = c; img = u2; break; }
        tooSmall++;
      }

      tried[row.id] = true;
      if (!hit) { noMatch += candidates.length ? 0 : 1; }
      else {
        found[row.id] = {
          url: img,
          // Names the index, not a rights holder — see the header.
          credit: `via Brave Search${hit.source ? ` · ${String(hit.source)}` : ''}`,
          source: String(hit.url ?? ''),
          name: row.name,
        };
        accepted++;
      }
    } catch {
      searches++;
      tried[row.id] = true;
    }

    if (searches % 25 === 0) {
      writeFileSync(OUT, JSON.stringify(found, null, 0));
      writeFileSync(TRIED, JSON.stringify(tried));
      process.stdout.write(
        `\r  ${searches}/${Math.min(MAX_SEARCHES, todo.length)}  accepted ${accepted} ` +
        `(${Math.round((accepted / searches) * 100)}%)  no match ${noMatch}   `,
      );
    }
    await sleep(PAUSE_MS);
  }

  writeFileSync(OUT, JSON.stringify(found, null, 0));
  writeFileSync(TRIED, JSON.stringify(tried));

  console.log(`\n\n${'='.repeat(54)}`);
  console.log(`searches used     ${searches}   ~$${(searches * 0.005).toFixed(2)}`);
  console.log(`photos accepted   ${accepted}   ${searches ? Math.round((accepted / searches) * 100) : 0}%`);
  console.log(`no name match     ${noMatch}`);
  console.log(`named but too small/not a photo  ${tooSmall}`);
  console.log(`\ntotal held: ${Object.keys(found).length.toLocaleString()}`);
  console.log(`\n⚠️ INSPECT BEFORE TRUSTING THE PERCENTAGE. A web image index returns`);
  console.log(`   pictures matching words. Open a sample and check they are the right`);
  console.log(`   buildings before running the rest.`);
  console.log(`\n-> ${OUT}`);
}

main();
