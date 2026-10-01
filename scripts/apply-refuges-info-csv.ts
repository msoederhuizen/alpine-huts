/**
 * Turn the reviewed refuges.info CSV into places the app ships.
 *
 * ⚠️ A SEPARATE FILE FROM `manualPlaces.ts`, ON PURPOSE. That list opens by
 * saying it "is a liability and should stay tiny", and it is right: each of its
 * entries is a fact somebody typed once, which will never correct itself. These
 * are a different thing — a reviewed import from a source with a real licence
 * (CC BY-SA 2.0), verified coordinates, and a page per hut that can be checked
 * later. Mixing a hundred of them into that file would bury the handful of
 * genuine one-offs it exists to hold.
 *
 * ⚠️ MERGED THE SAME WAY MANUAL PLACES ARE, so a regeneration cannot drop them:
 * `generate-huts` adds them after all fetching, keyed by id. This script also
 * writes them straight into the region files, so they appear without waiting
 * for the elevation quota to reset.
 *
 * ⚠️ AND IT ONLY ADDS WHAT A PERSON APPROVED. A blank `keep?` counts as yes —
 * the reviewer said so explicitly after finding the list almost all correct —
 * but an `n` is final and the row never reaches the app.
 *
 *   npm run apply-refuges-csv -- "path/to/reviewed.csv"
 *   npm run apply-refuges-csv -- "path/to/reviewed.csv" --write
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRefused, recordRejections } from './lib/reviewed-csv';

import type { Hut, HutType } from '../src/types/hut';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'data', 'refuges-info-places.json');
const REGION_DIR = join(ROOT, 'assets', 'data', 'regions');
const SOURCE = process.argv[2];
const WRITE = process.argv.includes('--write');

/** Split one CSV line, honouring quotes and doubled quotes inside them. */
function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

const TYPES = new Set<HutType>(['alpine_hut', 'wilderness_hut', 'shelter', 'guesthouse']);

/** Everything the region files hold that did NOT come from this importer. */
function appOsmPlaces(): Hut[] {
  const out: Hut[] = [];
  const seen = new Set<string>();
  for (const f of readdirSync(REGION_DIR).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(REGION_DIR, f), 'utf8')) as Record<string, Hut[]>;
    for (const b of ['core', 'accommodations', 'villages']) {
      for (const h of d[b] ?? []) {
        if (h.id.startsWith('refuges/') || seen.has(h.id)) continue;
        seen.add(h.id);
        out.push(h);
      }
    }
  }
  return out;
}

/**
 * ⚠️ A GOOGLE MAPS LINK IS NOT A WEBSITE. One reviewed row supplied
 * `maps.app.goo.gl/...` in the website column, which is a pin, not the hut's
 * homepage — the app renders this field as "visit the website" and would send
 * somebody to a map they are already looking at.
 */
const isRealSite = (v: string) =>
  /^https?:\/\//i.test(v) && !/(maps\.app\.goo\.gl|google\.[a-z.]+\/maps)/i.test(v);

function main() {
  if (!SOURCE) {
    console.error('usage: npm run apply-refuges-csv -- "<reviewed .csv>" [--write]');
    process.exit(1);
  }
  const rows = readFileSync(SOURCE, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(splitRow);
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
  const C = {
    keep: col('keep'), type: col('type'), name: col('name'),
    lat: col('latitude'), lon: col('longitude'), sleeps: col('sleeps'),
    region: col('region'), page: col('refuges.info'), site: col('website'),
  };

  /**
   * ⚠️ RE-CHECKED AGAINST OSM EVERY RUN, NOT JUST THE FIRST TIME. A row reached
   * the CSV because nothing in the app was within 250 m of it — but "the app
   * does not have it" is a statement about a moment. Fixing the core query to
   * ask for `nwr` instead of node+way added 93 huts, and 13 of them landed on
   * places already added from this very list: the Bordierhütte, the Cabane de
   * Tracuit, the Refuge du Parmelan. They were never missing, only invisible.
   *
   * OSM always wins, because an OSM place self-corrects as OSM improves and a
   * row imported from a CSV never will. Skipping them here rather than at
   * review time also means this script is idempotent: re-run it after any
   * regeneration and the redundant entries drop out on their own.
   */
  const existing = appOsmPlaces();
  const RAD = Math.PI / 180;
  const metres = (aLat: number, aLon: number, bLat: number, bLon: number) => {
    const dLat = (bLat - aLat) * RAD;
    const dLon = (bLon - aLon) * RAD;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(x));
  };

  const places: Array<Hut & { regionId: string }> = [];
  let refused = 0;
  let badType = 0;
  let nowInOsm = 0;
  const supersededBy: string[] = [];
  const droppedSites: string[] = [];

  /**
   * ⚠️ THIS USED TO TEST `=== 'n'` AND MISS "No". The shared `isRefused` has
   * always accepted both, and this importer quietly did not — so a reviewer who
   * typed the whole word, as they did in the register file, would have had
   * every refusal IMPORTED. Two importers reading the same column with two
   * different ideas of what a refusal is was precisely what reviewed-csv.ts
   * exists to prevent; it had drifted anyway.
   */
  const refusedRows: Array<{ name: string; lat: number; lon: number }> = [];

  for (const r of rows.slice(1)) {
    // Blank means yes: the reviewer checked the list and said to assume it.
    if (isRefused(r[C.keep])) {
      refused++;
      const n = (r[C.name] ?? '').trim();
      const la = Number(r[C.lat]);
      const lo = Number(r[C.lon]);
      if (n && Number.isFinite(la) && Number.isFinite(lo)) refusedRows.push({ name: n, lat: la, lon: lo });
      continue;
    }

    const name = (r[C.name] ?? '').trim();
    const lat = Number(r[C.lat]);
    const lon = Number(r[C.lon]);
    const regionId = (r[C.region] ?? '').trim();
    const type = (r[C.type] ?? '').trim() as HutType;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || !regionId) continue;
    if (!TYPES.has(type)) { badType++; continue; }

    let covered: Hut | undefined;
    for (const o of existing) {
      if (metres(lat, lon, o.lat, o.lon) <= 250) { covered = o; break; }
    }
    if (covered) {
      nowInOsm++;
      if (supersededBy.length < 15) supersededBy.push(`${name}  ->  OSM "${covered.name}" (${covered.id})`);
      continue;
    }

    const page = (r[C.page] ?? '').trim();
    const supplied = (r[C.site] ?? '').trim();
    let website = page || undefined;
    if (supplied && supplied.toUpperCase() !== 'N/A') {
      if (isRealSite(supplied)) website = supplied;
      else droppedSites.push(`${name}  ${supplied}`);
    }

    const sleeps = Number(r[C.sleeps]);
    const tags: Record<string, string> = {
      name,
      'source': 'refuges.info',
      'source:licence': 'CC BY-SA 2.0',
    };
    // `capacity` is already rendered as "Sleeps N" by parseFacilities.
    if (Number.isFinite(sleeps) && sleeps > 0) tags.capacity = String(sleeps);
    if (website) tags.website = website;

    places.push({
      // `refuges/` prefix, so these can never collide with an OSM id and are
      // obvious in a log — the same reasoning as manualPlaces' `manual/`.
      id: `refuges/${page.match(/\/point\/(\d+)/)?.[1] ?? `${lat},${lon}`}`,
      regionId,
      name,
      lat,
      lon,
      type,
      website,
      // Nothing here takes a hut-reservation.org booking; the point page is the
      // most useful thing a walker can open, and it is what carries the photos.
      bookingUrl: page || 'https://www.refuges.info/',
      tags,
    });
  }

  console.log(`${rows.length - 1} reviewed rows`);
  const remembered = recordRejections('refuges', refusedRows);
  console.log(`  refused                     ${refused}`);
  if (remembered.added) console.log(`  newly remembered refusals   ${remembered.added} (${remembered.total} in all)`);
  if (badType) console.log(`  skipped, unknown type       ${badType}`);
  console.log(`  now covered by OSM, skipped ${nowInOsm}`);
  console.log(`  to add                      ${places.length}`);

  const byType: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  for (const p of places) {
    byType[p.type] = (byType[p.type] ?? 0) + 1;
    byRegion[p.regionId] = (byRegion[p.regionId] ?? 0) + 1;
  }
  console.log('\nby type:   ' + Object.entries(byType).map(([k, v]) => `${k} ${v}`).join('   '));
  console.log('by region: ' + Object.entries(byRegion).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('   '));
  console.log(`\nwith a real website ${places.filter((p) => p.website && !p.website.includes('refuges.info')).length}` +
    `, falling back to the refuges.info page ${places.filter((p) => p.website?.includes('refuges.info')).length}`);
  console.log(`with a sleeping capacity ${places.filter((p) => p.tags.capacity).length}`);

  if (supersededBy.length) {
    console.log('\nOSM has these now — dropped so the self-correcting record wins:');
    for (const x of supersededBy) console.log('  ' + x);
  }

  if (droppedSites.length) {
    console.log('\nnot used as a website — a map pin is not a homepage:');
    for (const d of droppedSites) console.log('  ' + d);
  }

  // Which regions actually exist, so a typo in the CSV is caught here.
  const known = new Set(readdirSync(REGION_DIR).filter((f) => f.endsWith('.json') && f !== '_meta.json').map((f) => f.replace('.json', '')));
  const unknown = [...new Set(places.map((p) => p.regionId))].filter((r) => !known.has(r));
  if (unknown.length) {
    console.error(`\n⛔ unknown region id(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  if (!WRITE) {
    console.log('\n(report only — pass --write to save)');
    return;
  }

  writeFileSync(OUT, JSON.stringify(places, null, 1));
  console.log(`\n-> ${OUT}`);

  /**
   * ⚠️ REPLACE, DO NOT APPEND. Every `refuges/` place is stripped first and the
   * approved set written back. Appending would leave the 13 superseded entries
   * sitting in the region files for ever — a removal has to be able to take
   * effect, or this script can only ever grow the data.
   */
  let added = 0;
  let removed = 0;
  for (const f of readdirSync(REGION_DIR).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const regionId = f.replace('.json', '');
    const path = join(REGION_DIR, f);
    const d = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Hut[]>;
    const before = (d.accommodations ?? []).length;
    const kept = (d.accommodations ?? []).filter((h) => !h.id.startsWith('refuges/'));
    const mine = places.filter((p) => p.regionId === regionId).map(({ regionId: _r, ...h }) => h);
    if (before === kept.length && !mine.length) continue;
    removed += before - kept.length;
    added += mine.length;
    d.accommodations = [...kept, ...mine];
    writeFileSync(path, JSON.stringify(d));
  }
  console.log(`-> region files: removed ${removed} previous entries, wrote ${added}`);
  console.log('   Data: © refuges.info contributors, CC BY-SA 2.0');
}

main();
