/**
 * Export the N places worth spending a web search on, for a search API.
 *
 * ⚠️ NOT "the first N missing photos". A search is only worth issuing where all
 * of these hold, and every exclusion is something this project measured the
 * hard way:
 *
 *   no photo yet
 *   no website from ANY source — we already hold one for ~4,000 places and
 *       have tried it; a search cannot improve on a URL we have
 *   a real name — `isFallbackHutName` catches "Alpine hut", "Bivouac",
 *       "Wilderness hut". Searching those returns the entire Alps
 *   at least one distinctive token — a name made only of generic words
 *       ("Berghaus", "Sennhütte") matches hundreds of places and is how wrong
 *       photos get attached
 *
 * Ranked by distance to the nearest classic-route stop. That ranking replaced
 * one based on the `type` tag after measuring that the tag does NOT predict
 * whether anyone visits: GR20 refuges are tagged `guesthouse`, and a type-based
 * cut dropped places sitting ON the route at 0.0 km.
 *
 *   tsx scripts/export-brave-list.ts [count] [outfile]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import { distinctiveTokens, normalizePlaceName } from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNT = Number(process.argv[2] ?? 999);
const OUT = process.argv[3] ?? join(ROOT, 'brave-search-list.csv');

const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const idx: Record<string, unknown[]> = read(join(ROOT, 'assets/data/photo-index.json'));
const refuges: Record<string, unknown[]> = read(join(ROOT, 'assets/data/refuges-photos.json'));
const overture: Record<string, unknown> = read(join(ROOT, 'assets/data/overture-websites.json'));

const REGIONS = join(ROOT, 'assets', 'data', 'regions');
const byId = new Map<string, Hut>();
const regionOf = new Map<string, string>();
for (const f of readdirSync(REGIONS).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
  const d = JSON.parse(readFileSync(join(REGIONS, f), 'utf8')) as Record<string, Hut[]>;
  for (const b of ['core', 'accommodations']) {
    for (const h of d[b] ?? []) {
      if (!h.name || byId.has(h.id)) continue;
      byId.set(h.id, h);
      regionOf.set(h.id, f.replace('.json', ''));
    }
  }
}

const usableSite = (raw?: string) => {
  if (!raw) return null;
  const t = raw.trim().split(/[\s,;]/)[0];
  return t && /^([a-z]+:\/\/)?[^/\s.]+\.[^/\s]+/i.test(t) ? t : null;
};

const noPhotoNoSite = [...byId.values()].filter(
  (h) => !refuges[h.id]?.length && !idx[h.id]?.length && !usableSite(h.website) && !overture[h.id],
);
const searchable = noPhotoNoSite.filter(
  (h) => !isFallbackHutName(h.name) && distinctiveTokens(normalizePlaceName(h.name)).length > 0,
);

// ── rank by distance to the nearest classic-route stop ──────────────────────
const classicSrc = readFileSync(join(ROOT, 'src/constants/classicRoutes.ts'), 'utf8');
const stopIds = new Set(
  [...classicSrc.matchAll(/'((?:node|way|relation)\/\d+)'/g)].map((m) => m[1]),
);
const stops = [...stopIds].map((id) => byId.get(id)).filter((h): h is Hut => !!h);
const rad = (d: number) => (d * Math.PI) / 180;
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

const ADDR = ['addr:village', 'addr:hamlet', 'addr:suburb', 'addr:place', 'addr:city'];
const DIAL: Record<string, string> = {
  '33': 'France', '39': 'Italy', '41': 'Switzerland', '43': 'Austria',
  '49': 'Germany', '386': 'Slovenia', '34': 'Spain', '376': 'Andorra',
};
const ISO: Record<string, string> = {
  FR: 'France', IT: 'Italy', CH: 'Switzerland', AT: 'Austria',
  DE: 'Germany', SI: 'Slovenia', ES: 'Spain', AD: 'Andorra',
};
/**
 * Country, but ONLY when it is actually known.
 *
 * ⚠️ NO BOUNDING BOXES. This used to fall back to coarse lat/lon boxes and they
 * were wrong exactly where it matters — at the borders, which is where most of
 * these places are. Measured output: "Refuge de Carozzu Italy" (it is in
 * Corsica), "Rifugio Coldai Austria" (the Dolomites), "Gîte d'étape le Moulin
 * Switzerland" (Mont Blanc). A wrong country word does not merely fail to help,
 * it actively steers the search away from the right answer.
 *
 * The tag and the dialling code are exact. When neither exists, say nothing and
 * let the region carry the geography instead.
 */
function countryOf(h: Hut): string {
  const tag = h.tags?.['addr:country'];
  if (tag && ISO[tag]) return ISO[tag];
  const phone = String(h.tags?.phone ?? h.tags?.['contact:phone'] ?? '').replace(/[^\d+]/g, '');
  const m = /^\+(\d{1,3})/.exec(phone);
  if (m) for (const len of [3, 2, 1]) { const k = m[1].slice(0, len); if (DIAL[k]) return DIAL[k]; }
  return '';
}

/**
 * The region name as search words: `tirol-otztal-zillertal` → `tirol otztal
 * zillertal`. These are OUR curated names, chosen because they describe a real
 * walking area, which makes them a better geographic hint than a guessed
 * country and an honest one — a place in `corsica` genuinely is in Corsica.
 */
const regionWords = (slug: string) => slug.replace(/-/g, ' ');

const rows = searchable
  .map((h) => {
    const locality = ADDR.map((k) => h.tags?.[k]).find(Boolean) ?? '';
    const country = countryOf(h);
    const region = regionOf.get(h.id) ?? '';
    // Locality is the sharpest hint when present, country next when it is
    // actually known, and the region always — it is never wrong, because we
    // assigned it.
    const where = [locality, country || regionWords(region)].filter(Boolean).join(' ');
    return {
      id: h.id,
      name: h.name,
      type: h.type,
      lat: h.lat.toFixed(6),
      lon: h.lon.toFixed(6),
      locality,
      country,
      region,
      km_to_route: (stops.length ? Math.min(...stops.map((s) => km(h, s))) : 999).toFixed(1),
      // Ready to send as-is. The quoted name pins the phrase; the place words
      // stop it matching an identically named hut 400 km away.
      query: `"${h.name}" ${where}`.trim(),
    };
  })
  .sort((a, b) => Number(a.km_to_route) - Number(b.km_to_route) || a.name.localeCompare(b.name))
  .slice(0, COUNT);

const cell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const cols = ['id', 'name', 'type', 'lat', 'lon', 'locality', 'country', 'region', 'km_to_route', 'query'] as const;
// ⚠️ BOM. Excel reads a UTF-8 CSV as ANSI without one, and these names are
// full of umlauts — "Breitlahnhütte" arrives as "BreitlahnhÃ¼tte" and the file
// is useless for the lookup it exists for. The opposite of the JSON rule,
// where a BOM breaks JSON.parse.
writeFileSync(
  OUT,
  '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n'),
  'utf8',
);

console.log(`${byId.size.toLocaleString()} named places`);
console.log(`${noPhotoNoSite.length.toLocaleString()} have no photo AND no website from any source`);
console.log(`${searchable.length.toLocaleString()} of those have a searchable name`);
console.log(`  dropped as unsearchable: ${(noPhotoNoSite.length - searchable.length).toLocaleString()} (fallback name, or only generic words)\n`);
console.log(`exported ${rows.length.toLocaleString()}, nearest a classic route first\n`);

const tally = (key: 'type' | 'country') => {
  const t: Record<string, number> = {};
  for (const r of rows) t[r[key] || '?'] = (t[r[key] || '?'] ?? 0) + 1;
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
};
console.log('  by type:');
for (const [k, v] of tally('type')) console.log(`    ${k.padEnd(16)} ${String(v).padStart(4)}`);
console.log('\n  by country:');
for (const [k, v] of tally('country')) console.log(`    ${k.padEnd(16)} ${String(v).padStart(4)}`);
console.log(`\n  furthest from a route in this set: ${rows[rows.length - 1]?.km_to_route} km`);
console.log('\n  first five queries:');
for (const r of rows.slice(0, 5)) console.log(`    ${r.query}`);
console.log(`\n-> ${OUT}`);
