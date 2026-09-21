/**
 * Is the missing website sitting on a DIFFERENT OSM object at the same spot?
 *
 * A mountain hut is very often mapped twice: `tourism=alpine_hut` for the
 * lodging and `amenity=restaurant` for the Gaststube, because they are
 * different things to a mapper even when they are one building. Our extract
 * only ever took the lodging tags, so a website on the restaurant copy was
 * invisible to us.
 *
 * ⚠️ THE NAME HAS TO AGREE, and that is what separates this from the earlier
 * eyeball. A neighbour within 60 m in a village is usually a DIFFERENT
 * business — measured: "B&B Haus Daniels" sits 43 m from "Hotel Edelweiß" and
 * they are unrelated. Only a co-located object carrying the SAME name is the
 * same establishment mapped twice, which is the case worth having.
 *
 * Queried by TILE rather than one `around` per place: 150 around-clauses in one
 * request returned 504, and batches of 30 hit 429 after two. Tiles ask Overpass
 * for the kind of thing it is built to answer.
 *
 * Run: tsx scripts/measure-osm-neighbours.ts [sampleSize]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import {
  distinctiveTokens,
  normalizePlaceName,
  textNamesPlace,
} from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGIONS = join(ROOT, 'assets', 'data', 'regions');
const PHOTO_INDEX = join(ROOT, 'assets', 'data', 'photo-index.json');
const REFUGES = join(ROOT, 'assets', 'data', 'refuges-photos.json');
const OVERTURE = join(ROOT, 'assets', 'data', 'overture-websites.json');

const SAMPLE = Number(process.argv[2] ?? 400);
const TILE = 0.25;      // degrees — small enough that one query stays light
const RADIUS_M = 60;    // same building or its yard
const PAUSE_MS = 4000;  // Overpass is shared; this is the polite floor

/** Only lodging and food tags. Asking for every `website` object in a tile is
 *  a far heavier query and most of the answer would be shops and churches. */
const FILTER = [
  '["amenity"~"^(restaurant|cafe|bar|pub|biergarten|fast_food)$"]',
  '["tourism"~"^(hotel|guest_house|chalet|hostel|alpine_hut|wilderness_hut|apartment|motel)$"]',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}

/** Same test the Overture matching uses, and weaker than the Commons one for
 *  the same reason: position has already discriminated, so the name only has
 *  to corroborate. See generate-overture-websites.ts. */
function namesAgree(ours: string, theirs: string): boolean {
  if (!theirs || isFallbackHutName(ours)) return false;
  const a = normalizePlaceName(ours);
  const b = normalizePlaceName(theirs);
  if (!a || !b) return false;
  const tokens = distinctiveTokens(a);
  if (tokens.length) return textNamesPlace(b, tokens);
  return a === b || b.includes(a) || a.includes(b);
}

interface OsmEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function main() {
  const idx: Record<string, unknown[]> = existsSync(PHOTO_INDEX)
    ? JSON.parse(readFileSync(PHOTO_INDEX, 'utf8'))
    : {};
  const refuges: Record<string, unknown[]> = existsSync(REFUGES)
    ? JSON.parse(readFileSync(REFUGES, 'utf8'))
    : {};
  const overture: Record<string, unknown> = existsSync(OVERTURE)
    ? JSON.parse(readFileSync(OVERTURE, 'utf8'))
    : {};

  const byId = new Map<string, Hut>();
  for (const f of readdirSync(REGIONS).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(REGIONS, f), 'utf8')) as Record<string, Hut[]>;
    for (const b of ['core', 'accommodations']) {
      for (const h of d[b] ?? []) if (h.name && !byId.has(h.id)) byId.set(h.id, h);
    }
  }
  const usable = (raw?: string) => {
    if (!raw) return null;
    const t = raw.trim().split(/[\s,;]/)[0];
    return t && /^([a-z]+:\/\/)?[^/\s.]+\.[^/\s]+/i.test(t) ? t : null;
  };
  const need = [...byId.values()].filter(
    (h) =>
      !refuges[h.id]?.length &&
      !idx[h.id]?.length &&
      !usable(h.website) &&
      !overture[h.id],
  );

  // Even spread across the whole set rather than the first N of one region.
  const step = Math.max(1, Math.floor(need.length / SAMPLE));
  const sample = need.filter((_, i) => i % step === 0).slice(0, SAMPLE);

  // Group into tiles so one query serves many places.
  const tiles = new Map<string, Hut[]>();
  for (const h of sample) {
    const key = `${Math.floor(h.lat / TILE)},${Math.floor(h.lon / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key)!.push(h);
  }

  console.log(`${need.length.toLocaleString()} places have no photo and no website from any source`);
  console.log(`sampling ${sample.length} of them across ${tiles.size} tiles of ${TILE}°\n`);

  let answered = 0;
  let matched = 0;
  let failedTiles = 0;
  const kinds: Record<string, number> = {};
  const shown: string[] = [];

  for (const [key, group] of tiles) {
    const [ty, tx] = key.split(',').map(Number);
    const s = ty * TILE, w = tx * TILE, n = s + TILE, e = w + TILE;
    const bbox = `${s},${w},${n},${e}`;
    const query =
      `[out:json][timeout:90];(` +
      FILTER.map((f) => `nwr${f}["website"]["name"](${bbox});`).join('') +
      `);out center tags;`;

    let els: OsmEl[] = [];
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Honest and descriptive. Never a browser impersonation.
          'User-Agent': 'AlpineHutsApp/1.0 (hut photo index; build script)',
        },
      });
      if (!res.ok) {
        failedTiles++;
        // 429 means slow down, so slow down rather than pressing on at pace.
        if (res.status === 429) await sleep(30_000);
        continue;
      }
      els = ((await res.json()) as { elements?: OsmEl[] }).elements ?? [];
    } catch {
      failedTiles++;
      continue;
    }

    for (const h of group) {
      answered++;
      let best: { d: number; el: OsmEl } | null = null;
      for (const el of els) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const d = metres(h, { lat, lon });
        if (d > RADIUS_M) continue;
        if (!namesAgree(h.name, el.tags?.name ?? '')) continue;
        if (!best || d < best.d) best = { d, el };
      }
      if (!best) continue;
      matched++;
      const t = best.el.tags ?? {};
      const kind = t.amenity ?? t.tourism ?? 'other';
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      if (shown.length < 14) {
        shown.push(
          `${h.name.slice(0, 28).padEnd(29)} ~ ${(t.name ?? '').slice(0, 26).padEnd(27)} ` +
          `${String(Math.round(best.d)).padStart(3)}m  ${kind.padEnd(11)} ${t.website}`,
        );
      }
    }
    process.stdout.write(`  ${answered}/${sample.length} places, ${matched} matched\r`);
    await sleep(PAUSE_MS);
  }

  console.log('\n');
  if (!answered) {
    console.log('Overpass answered nothing — try again later rather than harder.');
    return;
  }
  const rate = matched / answered;
  console.log(`${matched} of ${answered} answered have a SAME-NAMED website object within ${RADIUS_M} m  (${(rate * 100).toFixed(1)}%)`);
  console.log(`projected over all ${need.length.toLocaleString()}: ~${Math.round(rate * need.length).toLocaleString()} websites`);
  if (failedTiles) console.log(`(${failedTiles} tiles failed or were throttled and are excluded)`);
  console.log('\nwhat the matching object was tagged as:');
  for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  console.log('\nexamples:');
  for (const s of shown) console.log(`  ${s}`);
}

main();
