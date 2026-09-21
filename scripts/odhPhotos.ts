/**
 * Build-time: photos from Open Data Hub, matched by coordinate and name.
 *
 * ⚠️ THE BEST-LICENSED SOURCE WE HAVE AFTER WIKIMEDIA. Every other route ends
 * in somebody's `og:image`, which we may show because they published it to
 * travel with their link — defensible, but a courtesy we are leaning on. These
 * records state CC BY or CC BY-SA outright and name the photographer, so
 * crediting them is simply doing what the licence asks.
 *
 * ⚠️ THE LICENCE IS ON THE RECORD, NOT THE IMAGE. Each ImageGallery entry has
 * its own `License` field and it is null throughout — reading that one made all
 * 283 photos look unlicensed, when `LicenseInfo.License` on the parent record
 * says CC BY. The photographer is on the image, as `CopyRight`.
 *
 * Despite the Südtirol origin the platform now carries Swiss data too
 * (HotellerieSuisse, discover.swiss), which is where most of our matches land:
 * Engstligenalp, Oeschinensee, Eiger. Exactly the mountain hotels Wikimedia
 * ignores and Overture only gave a website for.
 *
 * No API key.
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

const API = 'https://tourism.opendatahub.com/v1/Accommodation';
const PAGE = 1000;
/** Same two-tier rule as the Overture matching: past NEAR_M only an identical
 *  name counts, because loose overlap at range collects the neighbours. */
const NEAR_M = 200;
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

interface Acco {
  name: string;
  lat: number;
  lon: number;
  images: { url: string; author?: string }[];
  license?: string;
  site?: string;
}

async function fetchAll(log: (s: string) => void): Promise<Acco[]> {
  const out: Acco[] = [];
  const fields = [
    'Id', 'AccoDetail.de.Name', 'AccoDetail.en.Name', 'AccoDetail.it.Name',
    'ContactInfos.de.Url', 'ImageGallery', 'GpsInfo', 'LicenseInfo',
  ].join(',');
  for (let page = 1; page <= 40; page++) {
    let json: { Items?: unknown[]; TotalResults?: number } | null = null;
    try {
      const r = await fetch(
        `${API}?pagesize=${PAGE}&pagenumber=${page}&fields=${encodeURIComponent(fields)}`,
        {
          headers: { Accept: 'application/json', 'User-Agent': 'AlpineHutsApp/1.0 (hut photo index)' },
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!r.ok) break;
      json = await r.json();
    } catch {
      break; // partial data is still usable; the next build fills the rest
    }
    const items = (json?.Items ?? []) as Record<string, any>[];
    if (!items.length) break;
    for (const it of items) {
      const gps = (it.GpsInfo ?? []).find((g: any) => g?.Latitude && g?.Longitude);
      const name =
        it['AccoDetail.de.Name'] ?? it['AccoDetail.en.Name'] ?? it['AccoDetail.it.Name'];
      if (!gps || !name) continue;
      const images = (it.ImageGallery ?? [])
        .map((g: any) => ({
          url: String(g?.ImageUrl ?? ''),
          author: (g?.CopyRight ?? g?.LicenseHolder ?? undefined) || undefined,
        }))
        .filter((g: { url: string }) => /^https?:\/\//i.test(g.url));
      if (!images.length) continue; // a record with no photo is of no use here
      out.push({
        name: String(name),
        lat: gps.Latitude,
        lon: gps.Longitude,
        images,
        license: it.LicenseInfo?.License ?? undefined,
        site: it['ContactInfos.de.Url'] ?? undefined,
      });
    }
    log(`  fetched ${out.length} with photos`);
    if (page * PAGE >= (json?.TotalResults ?? 0)) break;
    await sleep(300);
  }
  return out;
}

export async function resolveOpenDataHub(
  places: Hut[],
  log: (s: string) => void = () => {},
): Promise<Map<string, Photo[]>> {
  const accos = await fetchAll(log);
  const found = new Map<string, Photo[]>();
  if (!accos.length) return found;

  // ~1 km cells, so this is a handful of comparisons per place rather than
  // 12,000 x 16,000.
  const CELL = 0.01;
  const grid = new Map<string, Acco[]>();
  for (const a of accos) {
    const k = `${Math.floor(a.lat / CELL)},${Math.floor(a.lon / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(a);
  }

  for (const hut of places) {
    const cy = Math.floor(hut.lat / CELL);
    const cx = Math.floor(hut.lon / CELL);
    let best: { d: number; a: Acco } | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const a of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          const d = metres(hut, a);
          if (d > NEAR_M) continue;
          const exact = normalizePlaceName(hut.name) === normalizePlaceName(a.name);
          if (!(d <= NEAR_M && namesAgree(hut.name, a.name)) && !exact) continue;
          if (!best || d < best.d) best = { d, a };
        }
      }
    }
    if (!best) continue;
    const lic = best.a.license;
    const photos = best.a.images.slice(0, MAX_PER_HUT).map((img) => ({
      url: img.url,
      // CC BY asks for the creator by name. Where the record names one, that is
      // the credit; otherwise fall back to the platform.
      credit: img.author && lic ? `${img.author} · ${lic}` : lic ? `Open Data Hub · ${lic}` : 'Photo: Open Data Hub',
      author: img.author,
      license: lic,
      link: best!.a.site,
    }));
    if (photos.length) found.set(hut.id, photos);
  }
  return found;
}
