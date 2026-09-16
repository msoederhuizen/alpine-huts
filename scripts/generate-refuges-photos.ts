/**
 * Build-time: collect hut photographs from refuges.info and write them into the
 * shipped data, so the app needs no request for them at runtime.
 *
 * WHY THIS SOURCE. It matches by COORDINATES, not by name — measured at 0–9 m
 * against our huts — so every name-ambiguity failure that has plagued the other
 * photo sources is structurally impossible here. A photo attached to a refuge
 * on refuges.info IS a photo of that refuge, because that is what the site is
 * for. It is also open data under CC-BY-SA, with the licence stated on the page.
 *
 * ⚠️ REGIONAL. refuges.info covers France, the Pyrenees and the nearby Alps.
 * It does nothing for Austria, Germany, Slovenia or Scandinavia, and that is
 * fine: those are where Wikimedia is strongest.
 *
 * ⚠️ PHOTOS ARE NOT IN THE API. The bbox and point endpoints return no photo
 * field, so the point PAGE is parsed for them. That is one well-structured site
 * with a clear licence, not eleven thousand random ones.
 *
 * Run: npm run generate-refuges-photos
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGIONS = join(ROOT, 'assets', 'data', 'regions');
const OUT = join(ROOT, 'assets', 'data', 'refuges-photos.json');

/** Where refuges.info has data. Outside this the tiling is wasted requests. */
const EXTENT = { w: -2.0, s: 42.0, e: 8.0, n: 47.2 };

/** Tile size in degrees. Adaptive: a tile that hits the API's cap is split. */
const TILE = 0.5;

/** The API returns at most this many points; hitting it means data was cut off. */
const API_CAP = 250;

/** How close a refuges.info point must be to count as the same place. Their
 *  coordinates and OSM's agree to within a few metres where both exist. */
const MATCH_M = 150;

/** Photos per hut. Three is a gallery; thirty is somebody's holiday album. */
const MAX_PHOTOS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const metres = (aLat: number, aLon: number, bLat: number, bLon: number) =>
  Math.hypot(
    (aLat - bLat) * 111_320,
    (aLon - bLon) * 111_320 * Math.cos((aLat * Math.PI) / 180),
  );

interface Point {
  id: string;
  lat: number;
  lon: number;
  name: string;
  link: string;
}

async function fetchTile(w: number, s: number, e: number, n: number): Promise<Point[]> {
  const url =
    `https://www.refuges.info/api/bbox?bbox=${w},${s},${e},${n}` +
    `&type_points=cabane,refuge,gite&format=geojson&detail=complet`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const gj = (await res.json()) as { features?: any[] };
    const feats = gj.features ?? [];

    // ⚠️ A full response means the box was TRUNCATED, not that it held exactly
    // 250 refuges. Split it rather than silently losing everything past the cap.
    if (feats.length >= API_CAP && e - w > 0.08) {
      const mw = (w + e) / 2;
      const ms = (s + n) / 2;
      const parts: Point[] = [];
      for (const box of [
        [w, s, mw, ms],
        [mw, s, e, ms],
        [w, ms, mw, n],
        [mw, ms, e, n],
      ] as const) {
        await sleep(350);
        parts.push(...(await fetchTile(box[0], box[1], box[2], box[3])));
      }
      return parts;
    }

    return feats
      .map((f) => ({
        id: String(f.properties?.id ?? ''),
        lon: Number(f.geometry?.coordinates?.[0]),
        lat: Number(f.geometry?.coordinates?.[1]),
        name: String(f.properties?.nom?.valeur ?? f.properties?.nom ?? ''),
        link: String(f.properties?.lien ?? ''),
      }))
      .filter((p) => p.id && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  } catch {
    return [];
  }
}

/**
 * Photos on a point page, with their photographer.
 *
 * Each sits in a comment block: the author is in `commentaire_metainfo`
 * ("… par <a>francois</a>"), and the full-size file is the `<a href>` wrapping
 * the thumbnail. Blocks are split on the anchor that opens each one.
 */
function parsePhotos(html: string): { file: string; author?: string }[] {
  const out: { file: string; author?: string }[] = [];
  for (const block of html.split('bloc_commentaire').slice(1)) {
    const file = /href="(\/photos_points\/[^"]+-originale\.[a-z]+[^"]*)"/i.exec(block)?.[1];
    if (!file) continue;
    // The metainfo line sits ABOVE the photo inside the same block.
    const author = /par\s*<a[^>]*>\s*([^<]{1,40}?)\s*<\/a>/i.exec(block)?.[1]?.trim();
    out.push({ file, author: author || undefined });
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

async function main() {
  // ── our huts ──────────────────────────────────────────────────────────────
  const byId = new Map<string, Hut>();
  for (const f of readdirSync(REGIONS).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(REGIONS, f), 'utf8')) as Record<string, Hut[]>;
    for (const b of ['core', 'accommodations']) for (const h of d[b] ?? []) if (h.name) byId.set(h.id, h);
  }
  const inExtent = [...byId.values()].filter(
    (h) => h.lon >= EXTENT.w && h.lon <= EXTENT.e && h.lat >= EXTENT.s && h.lat <= EXTENT.n,
  );
  console.log(`${byId.size.toLocaleString()} huts total, ${inExtent.length.toLocaleString()} inside the refuges.info extent`);

  // ── their points ──────────────────────────────────────────────────────────
  const points: Point[] = [];
  let tiles = 0;
  for (let lon = EXTENT.w; lon < EXTENT.e; lon += TILE) {
    for (let lat = EXTENT.s; lat < EXTENT.n; lat += TILE) {
      tiles++;
      points.push(...(await fetchTile(lon, lat, lon + TILE, lat + TILE)));
      await sleep(300);
    }
    process.stdout.write(`\r  tiles ${tiles}, points ${points.length}   `);
  }
  const uniquePoints = [...new Map(points.map((p) => [p.id, p])).values()];
  console.log(`\n${uniquePoints.length.toLocaleString()} distinct refuges.info points\n`);

  // ── match on coordinates ──────────────────────────────────────────────────
  const matches: { hut: Hut; point: Point; d: number }[] = [];
  for (const hut of inExtent) {
    let best: { point: Point; d: number } | null = null;
    for (const p of uniquePoints) {
      const d = metres(hut.lat, hut.lon, p.lat, p.lon);
      if (d <= MATCH_M && (!best || d < best.d)) best = { point: p, d };
    }
    if (best) matches.push({ hut, point: best.point, d: best.d });
  }
  console.log(`${matches.length.toLocaleString()} huts matched within ${MATCH_M} m ` +
    `(${((matches.length / Math.max(1, inExtent.length)) * 100).toFixed(0)}% of those in extent)\n`);

  // ── photos, one page per match ────────────────────────────────────────────
  const result: Record<string, { url: string; credit: string; author?: string; link: string }[]> = {};
  let done = 0, withPhotos = 0, photos = 0;
  for (const m of matches) {
    done++;
    if (done % 25 === 0) process.stdout.write(`\r  pages ${done}/${matches.length}, ${withPhotos} with photos   `);
    try {
      const res = await fetch(m.point.link);
      if (!res.ok) continue;
      const found = parsePhotos(await res.text());
      if (!found.length) continue;
      withPhotos++;
      photos += found.length;
      result[m.hut.id] = found.map((f) => ({
        url: `https://www.refuges.info${f.file}`,
        // CC-BY-SA needs the author and the licence, and refuges.info states
        // both on the page. Where a contributor is not named, credit the site.
        credit: f.author ? `${f.author} · refuges.info · CC BY-SA` : 'refuges.info · CC BY-SA',
        author: f.author,
        link: m.point.link,
      }));
    } catch {
      /* one page failing must not lose the rest */
    }
    await sleep(250);
  }

  writeFileSync(OUT, JSON.stringify(result));
  const kb = (JSON.stringify(result).length / 1024).toFixed(0);
  console.log(`\n\n${withPhotos.toLocaleString()} huts gained ${photos.toLocaleString()} photos`);
  console.log(`-> ${OUT}  (${kb} KB)`);
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
