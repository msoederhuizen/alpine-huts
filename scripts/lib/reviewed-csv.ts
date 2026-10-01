/**
 * The shared half of "a human checked a list of candidate huts, now apply it".
 *
 * Two sources go through this — the refuges.info candidates and the Alpenverein
 * register candidates — and the parts that must not drift between them are the
 * parts that decide what reaches the app: what counts as approval, whether OSM
 * has since covered the place, and how the region files get written.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../../src/types/hut';

export const REGION_DIR = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'data', 'regions',
);

/** Split one CSV line, honouring quotes and doubled quotes inside them. */
export function splitRow(line: string): string[] {
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

export function readCsv(path: string): { head: string[]; rows: string[][] } {
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const rows = lines.map(splitRow);
  return { head: rows[0].map((h) => h.trim().toLowerCase()), rows: rows.slice(1) };
}

/**
 * ⚠️ "NO" IS THE ONLY ANSWER THAT REMOVES A ROW. Blank means yes, because a
 * reviewer who has read the list and found it almost all correct says so once
 * and does not then tick a hundred boxes. Anything else — "y", "yes", a tick —
 * is also yes. Getting this backwards would silently drop everything a person
 * skimmed and approved in bulk.
 */
export function isRefused(cell: string | undefined): boolean {
  const v = (cell ?? '').trim().toLowerCase();
  return v === 'n' || v === 'no';
}

/** Everything the region files hold that did NOT come from a reviewed import. */
export function appOsmPlaces(importPrefixes: string[]): Hut[] {
  const out: Hut[] = [];
  const seen = new Set<string>();
  for (const f of readdirSync(REGION_DIR).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(REGION_DIR, f), 'utf8')) as Record<string, Hut[]>;
    for (const b of ['core', 'accommodations', 'villages']) {
      for (const h of d[b] ?? []) {
        if (importPrefixes.some((p) => h.id.startsWith(p)) || seen.has(h.id)) continue;
        seen.add(h.id);
        out.push(h);
      }
    }
  }
  return out;
}

const RAD = Math.PI / 180;
export function metres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(x));
}

/**
 * ⚠️ A GOOGLE MAPS LINK IS NOT A WEBSITE. Reviewed rows have supplied
 * `maps.app.goo.gl/...` in a website column more than once — that is a pin, not
 * a homepage, and the app renders the field as "visit the website".
 */
export const isRealSite = (v: string) =>
  /^https?:\/\//i.test(v) && !/(maps\.app\.goo\.gl|google\.[a-z.]+\/maps)/i.test(v);

/**
 * Write an import's places into the region files, REPLACING whatever that
 * import wrote last time.
 *
 * ⚠️ REPLACE, NOT APPEND. A removal has to be able to take effect. Appending
 * left thirteen superseded entries sitting in the region files when OSM turned
 * out to have those huts after all, and an importer that can only ever grow the
 * data is one nobody can correct.
 */
export function writeRegionPlaces(
  prefix: string,
  places: Array<Hut & { regionId: string }>,
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const f of readdirSync(REGION_DIR).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const regionId = f.replace('.json', '');
    const path = join(REGION_DIR, f);
    const d = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Hut[]>;
    const before = (d.accommodations ?? []).length;
    const kept = (d.accommodations ?? []).filter((h) => !h.id.startsWith(prefix));
    const mine = places.filter((p) => p.regionId === regionId).map(({ regionId: _r, ...h }) => h);
    if (before === kept.length && !mine.length) continue;
    removed += before - kept.length;
    added += mine.length;
    d.accommodations = [...kept, ...mine];
    writeFileSync(path, JSON.stringify(d));
  }
  return { added, removed };
}
