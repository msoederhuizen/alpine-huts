/**
 * The shared half of "a human checked a list of candidate huts, now apply it".
 *
 * Two sources go through this — the refuges.info candidates and the Alpenverein
 * register candidates — and the parts that must not drift between them are the
 * parts that decide what reaches the app: what counts as approval, whether OSM
 * has since covered the place, and how the region files get written.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

// ── remembering what a reviewer already said no to ──────────────────────────
/**
 * ⚠️ WITHOUT THIS, EVERY REJECTION COMES BACK, BLANK, FOR EVER — AND BLANK
 * MEANS YES. The review CSVs are generated from "what is missing from the
 * app". A place the reviewer rejects is never added, so it is still missing,
 * so the next regeneration lists it again with an empty `keep?` cell. Combined
 * with the rule directly above, re-running an importer on a freshly generated
 * file imports precisely the things the reviewer refused.
 *
 * Measured on 2026-10-01, which is why this exists: of the 15 rows in a
 * regenerated `missing-huts-to-check.csv`, ALL 15 were rows the user had
 * already marked "No" — the holiday apartments, a 487 m valley pension, two
 * farm B&Bs. Not one was a new candidate. The file looked like a backlog and
 * was in fact a list of settled questions pointed the wrong way.
 *
 * So a refusal is now durable. The review builders exclude anything in here,
 * which means a regenerated CSV holds only genuinely new candidates and an
 * EMPTY file honestly means "nothing to do".
 */
const REJECTIONS = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'data', 'reviewed-rejections.json',
);

export interface Rejection {
  source: string;
  name: string;
  lat: number;
  lon: number;
  /** When it was refused — so a decision can be found and reversed by hand. */
  at: string;
}

/**
 * ⚠️ POSITION DECIDES, WITH THE NAME ONLY AS A SECOND CHANCE — the same rule
 * the place matcher follows. Candidates are regenerated from the same source
 * files each run, so their coordinates are identical and a rounded position is
 * an exact key. The name check exists only for the case where a source nudges
 * a point slightly between runs; 150 m is far tighter than the matcher's
 * limits because this is re-identifying one known row, not finding a match.
 */
const NEAR_M = 150;
const norm = (s: string) =>
  s.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9]/g, '');

export function readRejections(): Rejection[] {
  if (!existsSync(REJECTIONS)) return [];
  try {
    return JSON.parse(readFileSync(REJECTIONS, 'utf8')) as Rejection[];
  } catch {
    return [];
  }
}

/** Is this candidate one the reviewer has already turned down? */
export function isRejected(
  rejections: Rejection[],
  candidate: { name: string; lat: number; lon: number },
): boolean {
  const n = norm(candidate.name);
  return rejections.some((r) => {
    const d = metres(r.lat, r.lon, candidate.lat, candidate.lon);
    if (d <= 10) return true;
    return d <= NEAR_M && norm(r.name) === n;
  });
}

/**
 * Record refusals from a reviewed file, merging with what is already known.
 *
 * ⚠️ IT ONLY EVER ADDS. A row absent from this run's CSV is not an approval —
 * it may simply not have been listed, because OSM has since covered it or the
 * source changed. Forgetting a refusal must be a deliberate act (editing the
 * file), never a side effect of running an importer.
 */
export function recordRejections(
  source: string,
  refused: Array<{ name: string; lat: number; lon: number }>,
): { added: number; total: number } {
  const have = readRejections();
  let added = 0;
  for (const r of refused) {
    if (isRejected(have, r)) continue;
    have.push({ source, name: r.name, lat: r.lat, lon: r.lon, at: new Date().toISOString().slice(0, 10) });
    added++;
  }
  if (added) writeFileSync(REJECTIONS, JSON.stringify(have, null, 2));
  return { added, total: have.length };
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
