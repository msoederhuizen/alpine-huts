/**
 * Build-time: photos from DATAtourisme, France's national tourism open data.
 *
 * ⚠️ LICENCE OBLIGATIONS ARE NOT OPTIONAL HERE. The Licence Ouverte d'Etalab
 * permits commercial reuse, but requires naming the party that created each
 * record — the `hasBeenCreatedBy` field, usually a local tourist office — and
 * the date the dataset was last updated. Both are carried through into the
 * credit line. Dropping them would make the photos unusable, not merely
 * discourteous, so `creator` is REQUIRED for a photo to be accepted.
 *
 * ⚠️ IT IS 129,609 SEPARATE FILES, not one document. The flux arrives as an
 * 823 MB zip of one JSON-LD file per point of interest, plus an index that
 * carries only labels and filenames — no coordinates. So there is no way to
 * narrow it before reading; every file is opened once, filtered on the bbox,
 * and the rest discarded. That is a few minutes, once per refresh.
 *
 * Getting the data:
 *   1. npx tsx scripts/fetch-datatourisme.ts     (downloads the zip)
 *   2. unzip it somewhere with a SHORT path — Windows' 260-character limit
 *      bites on `objects/0/00/10-<uuid>.json` under a deep folder
 *   3. pass that folder to this script
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Hut } from '../src/types/hut';
import {
  distinctiveTokens,
  normalizePlaceName,
  textNamesPlace,
} from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';

export interface Photo {
  url: string;
  credit: string;
  author?: string;
  license?: string;
  link?: string;
}

/** Same two-tier rule as the Overture and ODH importers, for the same reason. */
const NEAR_M = 200;
const MAX_PER_HUT = 4;

/** Only France plus a margin. Everything outside is read and dropped. */
const BBOX = { minLat: 41.0, maxLat: 51.5, minLon: -5.6, maxLon: 10.0 };

const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}
function namesAgree(ours: string, theirs: string): boolean {
  if (!theirs || isFallbackHutName(ours)) return false;
  const a = normalizePlaceName(ours);
  const b = normalizePlaceName(theirs);
  if (!a || !b) return false;
  const tokens = distinctiveTokens(a);
  if (tokens.length) return textNamesPlace(b, tokens);
  return a === b || b.includes(a) || a.includes(b);
}

interface Poi {
  label: string;
  lat: number;
  lon: number;
  images: { url: string; author?: string }[];
  creator: string;
  updated?: string;
}

/** `{"fr":["Gîte d'Ambre"]}` → `Gîte d'Ambre`. French first: it is a French
 *  dataset and the other languages are frequently machine-translated. */
function labelOf(node: any): string {
  const l = node?.['rdfs:label'];
  if (!l) return '';
  const pick = l.fr ?? l.en ?? Object.values(l)[0];
  return Array.isArray(pick) ? String(pick[0] ?? '') : String(pick ?? '');
}

function parsePoi(raw: any): Poi | null {
  const loc = (raw?.isLocatedAt ?? [])[0];
  const geo = loc?.['schema:geo'];
  const lat = Number(geo?.['schema:latitude']);
  const lon = Number(geo?.['schema:longitude']);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) {
    return null;
  }

  const label = labelOf(raw);
  if (!label) return null;

  // The creator is what the licence requires us to name. No creator, no photo.
  const creator =
    raw?.hasBeenCreatedBy?.['schema:legalName'] ??
    raw?.hasBeenCreatedBy?.['rdfs:label']?.fr?.[0] ??
    '';
  if (!creator) return null;

  const images: { url: string; author?: string }[] = [];
  for (const rep of raw?.hasMainRepresentation ?? []) {
    // The photographer, where the record names one, lives on the annotation
    // rather than beside the file.
    const author = (rep?.['ebucore:hasAnnotation'] ?? [])
      .flatMap((a: any) => a?.credits ?? [])
      .find((c: unknown) => typeof c === 'string' && c.trim());
    for (const res of rep?.['ebucore:hasRelatedResource'] ?? []) {
      for (const url of res?.['ebucore:locator'] ?? []) {
        // https only: iOS refuses plain http, so an http image would fail on
        // every iPhone rather than merely looking bad.
        if (typeof url === 'string' && /^https:\/\/.+\.(jpe?g|png|webp)/i.test(url)) {
          images.push({ url, author: author || undefined });
        }
      }
    }
  }
  if (!images.length) return null;

  return { label, lat, lon, images, creator: String(creator), updated: raw?.lastUpdate };
}

/** Every *.json under a directory, following the flux's 2-level fan-out. */
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith('.json')) yield p;
  }
}

export async function resolveDatatourisme(
  places: Hut[],
  dir: string,
  log: (s: string) => void = () => {},
): Promise<Map<string, Photo[]>> {
  const found = new Map<string, Photo[]>();
  const objects = join(dir, 'objects');
  if (!existsSync(objects)) {
    log(`  no objects/ folder under ${dir} — nothing to do`);
    return found;
  }

  const pois: Poi[] = [];
  let read = 0;
  for (const file of walk(objects)) {
    read++;
    try {
      const poi = parsePoi(JSON.parse(readFileSync(file, 'utf8')));
      if (poi) pois.push(poi);
    } catch {
      // One malformed record must not stop 129,608 good ones.
    }
    if (read % 20000 === 0) log(`  read ${read.toLocaleString()}, kept ${pois.length.toLocaleString()}`);
  }
  log(`  read ${read.toLocaleString()} records, ${pois.length.toLocaleString()} in the bbox with photos and a named creator`);

  const CELL = 0.01;
  const grid = new Map<string, Poi[]>();
  for (const p of pois) {
    const k = `${Math.floor(p.lat / CELL)},${Math.floor(p.lon / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(p);
  }

  for (const hut of places) {
    const cy = Math.floor(hut.lat / CELL);
    const cx = Math.floor(hut.lon / CELL);
    let best: { d: number; p: Poi } | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const p of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          const d = metres(hut, p);
          if (d > NEAR_M || !namesAgree(hut.name, p.label)) continue;
          if (!best || d < best.d) best = { d, p };
        }
      }
    }
    if (!best) continue;
    const { p } = best;
    found.set(
      hut.id,
      p.images.slice(0, MAX_PER_HUT).map((img) => ({
        url: img.url,
        // What the Licence Ouverte asks for: the photographer where named, the
        // creating organisation always, and the dataset's update date.
        credit: [img.author, p.creator, p.updated ? `DATAtourisme ${p.updated}` : 'DATAtourisme']
          .filter(Boolean)
          .join(' · '),
        author: img.author,
        license: 'Licence Ouverte (Etalab)',
      })),
    );
  }
  return found;
}
