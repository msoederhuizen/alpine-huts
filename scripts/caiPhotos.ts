/**
 * Build-time: photos from the Club Alpino Italiano hut register.
 *
 * 681 shelters, and the paginated listing already carries both the geometry and
 * the media, so 69 page fetches gets the whole register — no request per hut.
 * `robots.txt` is `Disallow:` with nothing after it, i.e. everything permitted,
 * and we send an honest descriptive User-Agent as everywhere else.
 *
 * ⚠️ THE PAGE IS A JS-RENDERED SPA, BUT THE DATA IS STILL THERE. Fetching it
 * plainly gives zero `<img>` tags and no og:image, which is what killed the SAC
 * route — but here the whole payload sits HTML-escaped in a `data-page`
 * attribute. Decoding the entities and balancing the brackets gets structured
 * records without rendering anything, so no paid scraper is needed.
 *
 * ⚠️ LICENCE IS NOT STATED. Unlike Open Data Hub (CC BY) these photos come with
 * no licence grant, so they are treated exactly like a hotel's own `og:image`:
 * credited to rifugi.cai.it and linked back to the hut's page. That is the same
 * defensible-courtesy footing as most of the index, not the firmer ground the
 * Wikimedia and ODH photos sit on.
 */
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

const LIST = 'https://rifugi.cai.it/shelters';
const MEDIA = 'https://rifugi.cai.it/media/images';
const PAUSE_MS = 700;
const MAX_PAGES = 80; // 69 today; the guard stops a pagination bug looping
const NEAR_M = 250;
const MAX_PER_HUT = 4;

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
function namesAgree(ours: string, theirs: string): boolean {
  if (!theirs || isFallbackHutName(ours)) return false;
  const a = normalizePlaceName(ours);
  const b = normalizePlaceName(theirs);
  if (!a || !b) return false;
  const tokens = distinctiveTokens(a);
  if (tokens.length) return textNamesPlace(b, tokens);
  return a === b || b.includes(a) || a.includes(b);
}

interface Shelter {
  idCai: number;
  title: string;
  lat: number;
  lon: number;
  images: { url: string }[];
}

/** Pull `[lon, lat]` out of whichever shape the record uses. The register mixes
 *  a GeoJSON `geo.geometry.coordinates` with a flatter form on some rows. */
function coordsOf(rec: any): { lat: number; lon: number } | null {
  const c =
    rec?.geo?.geometry?.coordinates ??
    rec?.geo?.coordinates ??
    rec?.geometry?.coordinates ??
    rec?.coordinates;
  if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
    return { lon: Number(c[0]), lat: Number(c[1]) };
  }
  return null;
}

/** The paginated payload, decoded out of the `data-page` attribute. */
function parsePage(html: string): { rows: any[]; lastPage: number } {
  const d = html
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const lastPage = Number(/"last_page":(\d+)/.exec(d)?.[1] ?? 0);
  const marker = /"current_page":\d+,"data":/.exec(d);
  if (!marker) return { rows: [], lastPage };
  const start = d.indexOf('[', marker.index + marker[0].length - 1);
  if (start < 0) return { rows: [], lastPage };
  let depth = 0;
  for (let i = start; i < d.length; i++) {
    const c = d[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        try {
          return { rows: JSON.parse(d.slice(start, i + 1)), lastPage };
        } catch {
          return { rows: [], lastPage };
        }
      }
    }
  }
  return { rows: [], lastPage };
}

async function fetchRegister(log: (s: string) => void): Promise<Shelter[]> {
  const out: Shelter[] = [];
  let last = MAX_PAGES;
  for (let page = 1; page <= Math.min(last, MAX_PAGES); page++) {
    let html: string;
    try {
      const r = await fetch(`${LIST}?page=${page}`, {
        headers: { 'User-Agent': 'AlpineHutsApp/1.0 (hut photo index; build script)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) break;
      html = await r.text();
    } catch {
      break; // partial is fine; the next build picks up the rest
    }
    const { rows, lastPage } = parsePage(html);
    if (lastPage) last = lastPage;
    if (!rows.length) break;
    for (const rec of rows) {
      const pos = coordsOf(rec);
      const title = String(rec?.title ?? '').trim();
      if (!pos || !title) continue;
      const images = (rec?.media ?? [])
        .filter((m: any) => m?.id && m?.file_name && /\.(jpe?g|png|webp)$/i.test(m.file_name))
        .map((m: any) => ({ url: `${MEDIA}/${m.id}/${encodeURIComponent(m.file_name)}` }));
      if (!images.length) continue;
      out.push({ idCai: Number(rec.id_cai ?? 0), title, ...pos, images });
    }
    log(`  page ${page}/${last} — ${out.length} shelters with photos`);
    await sleep(PAUSE_MS);
  }
  return out;
}

export async function resolveCai(
  places: Hut[],
  log: (s: string) => void = () => {},
): Promise<Map<string, Photo[]>> {
  const register = await fetchRegister(log);
  const found = new Map<string, Photo[]>();
  if (!register.length) return found;

  const CELL = 0.01;
  const grid = new Map<string, Shelter[]>();
  for (const s of register) {
    const k = `${Math.floor(s.lat / CELL)},${Math.floor(s.lon / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(s);
  }

  for (const hut of places) {
    const cy = Math.floor(hut.lat / CELL);
    const cx = Math.floor(hut.lon / CELL);
    let best: { d: number; s: Shelter } | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const s of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          const d = metres(hut, s);
          if (d > NEAR_M || !namesAgree(hut.name, s.title)) continue;
          if (!best || d < best.d) best = { d, s };
        }
      }
    }
    if (!best) continue;
    const link = `https://rifugi.cai.it/shelters/${best.s.idCai}`;
    found.set(
      hut.id,
      best.s.images.slice(0, MAX_PER_HUT).map((img) => ({
        url: img.url,
        credit: 'Photo: rifugi.cai.it',
        link,
      })),
    );
  }
  return found;
}
