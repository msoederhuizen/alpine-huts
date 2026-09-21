/**
 * Open Data Hub (Südtirol / Alto Adige) — accommodation records that carry
 * their own PHOTOS, with a licence field, and GPS coordinates.
 *
 * ⚠️ THIS IS BETTER THAN A WEBSITE SOURCE. Everything else we have found
 * returns a URL which then has to be fetched, parsed and judged, and whose
 * photo we can only use because the site published an og:image for sharing.
 * Here the photo IS the record, and it states its own licence. Coordinates
 * mean the matching is the same structural kind that made Overture and
 * refuges.info trustworthy rather than a name search.
 *
 * No API key. Run: tsx scripts/measure-opendatahub.ts
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

const API = 'https://tourism.opendatahub.com/v1/Accommodation';
const PAGE = 1000;
const NEAR_M = 200;

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
  images: { url: string; holder?: string; author?: string }[];
  /** CC0 / CC BY-SA / … as the RECORD states it. ⚠️ Not the same as the
   *  per-image `License` field, which is null throughout — asking for that one
   *  made every photo look unlicensed when the record says CC0. */
  license?: string;
  licenseHolder?: string;
  site?: string;
}

async function fetchAll(): Promise<Acco[]> {
  const out: Acco[] = [];
  const fields = [
    'Id', 'AccoDetail.de.Name', 'AccoDetail.en.Name', 'AccoDetail.it.Name',
    'ContactInfos.de.Url', 'ImageGallery', 'GpsInfo', 'LicenseInfo',
  ].join(',');
  for (let page = 1; page <= 40; page++) {
    const url = `${API}?pagesize=${PAGE}&pagenumber=${page}&fields=${encodeURIComponent(fields)}`;
    let json: any;
    try {
      const r = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'AlpineHutsApp/1.0 (hut photo index)' },
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) break;
      json = await r.json();
    } catch {
      break;
    }
    const items: any[] = json?.Items ?? [];
    if (!items.length) break;
    for (const it of items) {
      const gps = (it.GpsInfo ?? []).find((g: any) => g?.Latitude && g?.Longitude);
      if (!gps) continue;
      const name =
        it['AccoDetail.de.Name'] ?? it['AccoDetail.en.Name'] ?? it['AccoDetail.it.Name'];
      if (!name) continue;
      const images = (it.ImageGallery ?? [])
        .map((g: any) => ({
          url: String(g?.ImageUrl ?? ''),
          holder: g?.LicenseHolder ?? g?.ImageSource ?? undefined,
          author: g?.CopyRight ?? undefined,
        }))
        .filter((g: { url: string }) => /^https?:\/\//i.test(g.url));
      out.push({
        name: String(name),
        lat: gps.Latitude,
        lon: gps.Longitude,
        images,
        license: it.LicenseInfo?.License ?? undefined,
        licenseHolder: it.LicenseInfo?.LicenseHolder ?? undefined,
        site: it['ContactInfos.de.Url'] ?? undefined,
      });
    }
    process.stdout.write(`  fetched ${out.length}\r`);
    const total = json?.TotalResults ?? 0;
    if (page * PAGE >= total) break;
    await sleep(300);
  }
  return out;
}

async function main() {
  console.log('fetching Open Data Hub accommodations (no key needed)...');
  const accos = await fetchAll();
  const withImages = accos.filter((a) => a.images.length).length;
  console.log(`\n${accos.length.toLocaleString()} records with coordinates, ${withImages.toLocaleString()} carry photos\n`);

  const idx: Record<string, unknown[]> = existsSync(PHOTO_INDEX)
    ? JSON.parse(readFileSync(PHOTO_INDEX, 'utf8')) : {};
  const refuges: Record<string, unknown[]> = existsSync(REFUGES)
    ? JSON.parse(readFileSync(REFUGES, 'utf8')) : {};
  const byId = new Map<string, Hut>();
  for (const f of readdirSync(REGIONS).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(REGIONS, f), 'utf8')) as Record<string, Hut[]>;
    for (const b of ['core', 'accommodations']) {
      for (const h of d[b] ?? []) if (h.name && !byId.has(h.id)) byId.set(h.id, h);
    }
  }
  const need = [...byId.values()].filter((h) => !refuges[h.id]?.length && !idx[h.id]?.length);

  // Grid index so this is not 12,000 x 16,000 comparisons.
  const CELL = 0.01;
  const grid = new Map<string, Acco[]>();
  for (const a of accos) {
    const k = `${Math.floor(a.lat / CELL)},${Math.floor(a.lon / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(a);
  }

  let matched = 0, withPhoto = 0, siteOnly = 0;
  const licences: Record<string, number> = {};
  const shown: string[] = [];
  for (const h of need) {
    const cy = Math.floor(h.lat / CELL), cx = Math.floor(h.lon / CELL);
    let best: { d: number; a: Acco } | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const a of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          const d = metres(h, a);
          if (d > NEAR_M || !namesAgree(h.name, a.name)) continue;
          if (!best || d < best.d) best = { d, a };
        }
      }
    }
    if (!best) continue;
    matched++;
    if (best.a.images.length) {
      withPhoto++;
      const lic = best.a.license ?? '(none stated)';
      licences[lic] = (licences[lic] ?? 0) + 1;
      if (shown.length < 10) {
        const credit = best.a.images[0].author ?? best.a.images[0].holder ?? best.a.licenseHolder ?? '?';
        shown.push(
          `${h.name.slice(0, 26).padEnd(27)} ~ ${best.a.name.slice(0, 24).padEnd(25)} ` +
          `${String(Math.round(best.d)).padStart(3)}m ${String(best.a.images.length).padStart(2)}p  ` +
          `${String(lic).padEnd(9)} ${String(credit).slice(0, 26)}`,
        );
      }
    } else if (best.a.site) siteOnly++;
  }

  console.log(`${need.length.toLocaleString()} of our places still have no photo`);
  console.log(`  matched in Open Data Hub      ${matched.toLocaleString()}`);
  console.log(`    ...of which carry PHOTOS    ${withPhoto.toLocaleString()}   <- direct, no scraping`);
  console.log(`    ...website only             ${siteOnly.toLocaleString()}`);
  console.log('\nphoto licences as stated by the source:');
  for (const [k, v] of Object.entries(licences).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(k).padEnd(28)} ${v}`);
  }
  console.log('\nexamples:');
  for (const s of shown) console.log(`  ${s}`);
}

main();
