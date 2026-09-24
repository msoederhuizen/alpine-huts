/**
 * Does Mapillary have a photograph standing at these places?
 *
 * ⚠️ THE ONLY IMAGE SOURCE WITH COORDINATES, which is why it is worth a look
 * at all. Openverse, Google Images and every SERP API match on WORDS, and the
 * places left have one-word generic names — measured, that returns a landslide
 * for "Talheimer" and a Belgian villa for "La Maisonnette". Mapillary images
 * carry a position, so a match can be confirmed the way refuges.info, Overture,
 * Open Data Hub and CAI all were.
 *
 * ⚠️ BUT IT IS STREET-LEVEL IMAGERY, mostly dashcam and phone captures along
 * roads. An image 40 m from a guesthouse may well be pointing at the tarmac.
 * Proximity is therefore necessary and NOT sufficient here, and this script
 * deliberately reports distance bands and sample URLs rather than a single
 * hit rate, because the question "is there an image nearby" is not the question
 * "is there a usable photograph of the building".
 *
 *   tsx scripts/measure-mapillary.ts [sampleSize]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import { distinctiveTokens, normalizePlaceName } from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = join(ROOT, '.env');
const SAMPLE = Number(process.argv[2] ?? 60);
const RADIUS_M = 120;
const PAUSE_MS = 400;

function fromEnvFile(key: string): string | undefined {
  if (!existsSync(ENV)) return undefined;
  for (const line of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const idx: Record<string, unknown[]> = read(join(ROOT, 'assets/data/photo-index.json'));
const refuges: Record<string, unknown[]> = read(join(ROOT, 'assets/data/refuges-photos.json'));

const REGIONS = join(ROOT, 'assets', 'data', 'regions');
const byId = new Map<string, Hut>();
for (const f of readdirSync(REGIONS).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
  const d = JSON.parse(readFileSync(join(REGIONS, f), 'utf8')) as Record<string, Hut[]>;
  for (const b of ['core', 'accommodations']) {
    for (const h of d[b] ?? []) if (h.name && !byId.has(h.id)) byId.set(h.id, h);
  }
}
const need = [...byId.values()].filter(
  (h) =>
    !refuges[h.id]?.length &&
    !idx[h.id]?.length &&
    !isFallbackHutName(h.name) &&
    distinctiveTokens(normalizePlaceName(h.name)).length > 0,
);
const step = Math.max(1, Math.floor(need.length / SAMPLE));
const sample = need.filter((_, i) => i % step === 0).slice(0, SAMPLE);

const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const token = process.env.MAPILLARY_TOKEN ?? fromEnvFile('MAPILLARY_TOKEN');
  if (!token || !token.startsWith('MLY')) {
    console.error('MAPILLARY_TOKEN is missing or malformed in .env');
    process.exit(1);
  }

  console.log(`${need.length.toLocaleString()} places still have no photo and a searchable name`);
  console.log(`sampling ${sample.length}, looking within ${RADIUS_M} m\n`);

  const bands = { m25: 0, m50: 0, m120: 0, none: 0 };
  let errors = 0;
  let panos = 0;
  const shown: string[] = [];

  for (const hut of sample) {
    // Degrees for the radius at this latitude. Longitude shrinks with cos(lat)
    // — at 47°N a degree of longitude is about two thirds of a degree of
    // latitude, and ignoring that would search a lopsided box.
    const dLat = RADIUS_M / 111_320;
    const dLon = RADIUS_M / (111_320 * Math.cos(rad(hut.lat)));
    const bbox = [hut.lon - dLon, hut.lat - dLat, hut.lon + dLon, hut.lat + dLat].join(',');
    try {
      const r = await fetch(
        `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}` +
        `&bbox=${bbox}&limit=10&fields=id,computed_geometry,thumb_1024_url,is_pano,captured_at`,
        { signal: AbortSignal.timeout(25_000) },
      );
      if (!r.ok) {
        errors++;
        if (errors <= 2) console.log(`  HTTP ${r.status}: ${(await r.text()).slice(0, 140)}`);
        await sleep(PAUSE_MS);
        continue;
      }
      const j = (await r.json()) as any;
      const imgs: any[] = j?.data ?? [];
      let best: { d: number; img: any } | null = null;
      for (const img of imgs) {
        const c = img?.computed_geometry?.coordinates;
        if (!Array.isArray(c)) continue;
        const d = metres(hut, { lon: c[0], lat: c[1] });
        if (!best || d < best.d) best = { d, img };
      }
      if (!best) { bands.none++; }
      else {
        if (best.d <= 25) bands.m25++;
        else if (best.d <= 50) bands.m50++;
        else bands.m120++;
        if (best.img.is_pano) panos++;
        if (shown.length < 10) {
          shown.push(
            `${hut.name.slice(0, 24).padEnd(26)} ${hut.type.padEnd(15)} ` +
            `${String(Math.round(best.d)).padStart(3)}m ${best.img.is_pano ? 'pano' : '    '} ` +
            `${String(best.img.thumb_1024_url ?? '').slice(0, 58)}`,
          );
        }
      }
    } catch {
      errors++;
    }
    await sleep(PAUSE_MS);
  }

  const n = sample.length - errors;
  if (n <= 0) { console.log('no usable answers'); return; }
  const any = bands.m25 + bands.m50 + bands.m120;
  console.log(`${n} answered (${errors} errors, excluded)\n`);
  console.log(`  an image within  25 m   ${String(bands.m25).padStart(4)}  ${Math.round((bands.m25 / n) * 100)}%   <- plausibly OF the building`);
  console.log(`  within 26-50 m          ${String(bands.m50).padStart(4)}  ${Math.round((bands.m50 / n) * 100)}%`);
  console.log(`  within 51-${RADIUS_M} m         ${String(bands.m120).padStart(4)}  ${Math.round((bands.m120 / n) * 100)}%`);
  console.log(`  nothing at all          ${String(bands.none).padStart(4)}  ${Math.round((bands.none / n) * 100)}%`);
  console.log(`\n  any image nearby: ${any} (${Math.round((any / n) * 100)}%)`);
  console.log(`  of those, 360° panoramas: ${panos}`);
  console.log(`\n  ⚠️ Proximity is not a photograph of the building. Open a few:`);
  for (const s of shown) console.log(`    ${s}`);
}

main();
