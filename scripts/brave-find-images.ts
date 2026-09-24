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

import { distinctiveTokens, normalizePlaceName } from '../src/utils/dedupePlaces';
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
const BAD_IMAGE = /(mapcarta|openstreetmap|tile\.|staticmap|googleusercontent\/maps|logo|favicon|avatar|sprite)/i;

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

  // Only names with two or more distinctive words: a one-word name is a phrase
  // of one word, so the strict rule would protect nothing.
  const todo = rows.filter(
    (r) => !tried[r.id] && distinctiveTokens(normalizePlaceName(r.name)).length >= 2,
  );

  console.log(`${rows.length.toLocaleString()} in the list`);
  console.log(`${todo.length.toLocaleString()} have a two-word name and have not been searched`);
  console.log(`cap: ${MAX_SEARCHES} searches (~$${(MAX_SEARCHES * 0.005).toFixed(2)} beyond the free allowance)\n`);

  let searches = 0;
  let accepted = 0;
  let noMatch = 0;

  for (const row of todo) {
    if (searches >= MAX_SEARCHES) {
      console.log(`\nreached the ${MAX_SEARCHES}-search cap — stopping.`);
      break;
    }
    const full = normalizePlaceName(row.name);

    try {
      // The quoted name ALONE — deliberately not the CSV's `query`, which
      // appends our region name. That extra term helps a web search pick the
      // right Rifugio; in an image search it is ANDed against the hosting page
      // and quietly excludes good photos, because image captions rarely name
      // the massif. Recall comes from the broad query, precision from the
      // full-name check below — not from narrowing the query.
      const u =
        `https://api.search.brave.com/res/v1/images/search` +
        `?q=${encodeURIComponent(`"${row.name}"`)}&count=20&safesearch=strict`;
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

      // The full name must appear in the image's title or in its source page
      // URL. Anything else is a word-match, which is how the wrong building
      // gets attached.
      const hit = results.find((x) => {
        const title = normalizePlaceName(String(x?.title ?? ''));
        const page = String(x?.url ?? '');
        const pageWords = normalizePlaceName(page.replace(/[^a-zA-Z0-9]+/g, ' '));
        const img = String(x?.properties?.url ?? x?.thumbnail?.src ?? '');
        if (!img || !/^https:\/\//i.test(img)) return false;
        if (NEVER.test(page) || BAD_IMAGE.test(img)) return false;
        return title.includes(full) || pageWords.includes(full);
      });

      tried[row.id] = true;
      if (!hit) { noMatch++; }
      else {
        const img = String(hit.properties?.url ?? hit.thumbnail?.src ?? '');
        const page = String(hit.url ?? '');
        found[row.id] = {
          url: img,
          // Names the index, not a rights holder — see the header.
          credit: `via Brave Search${hit.source ? ` · ${String(hit.source)}` : ''}`,
          source: page,
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
  console.log(`no full-name match ${noMatch}`);
  console.log(`\ntotal held: ${Object.keys(found).length.toLocaleString()}`);
  console.log(`\n⚠️ INSPECT BEFORE TRUSTING THE PERCENTAGE. A web image index returns`);
  console.log(`   pictures matching words. Open a sample and check they are the right`);
  console.log(`   buildings before running the rest.`);
  console.log(`\n-> ${OUT}`);
}

main();
