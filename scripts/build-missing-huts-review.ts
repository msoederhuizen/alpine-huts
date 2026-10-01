/**
 * Build a page listing huts that outside sources know about and the app does not.
 *
 * ⚠️ THE DECISIVE COLUMN IS "DOES OSM HAVE IT", NOT "IS IT MISSING". A hut can be
 * absent from the app for two completely different reasons, needing two
 * completely different fixes:
 *
 *   OSM HAS IT  -> the generator missed it. Martin-Busch-Hütte is way/84977315,
 *                  tagged tourism=alpine_hut, and it is simply not in our data.
 *                  Fixable by regenerating, and it will come back on its own.
 *   OSM LACKS IT -> nothing to regenerate. It needs a hand-entered record, with
 *                  all the staleness that carries (see manualPlaces.ts).
 *
 * Guessing between those wastes either an hour of regeneration or a permanent
 * liability in the manual list, so this asks Overpass rather than assuming.
 *
 * ⚠️ POLITE, CACHED, AND BATCHED. Overpass throttles, and this project's rule is
 * roughly one full regeneration a day. The OSM answers are cached to disk, so a
 * re-run to restyle the page costs nothing; --recheck re-asks.
 *
 *   npm run review-missing-huts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REGIONS } from '../src/constants/region';
import { appPlaces } from './lib/app-places';
import { namesALodging } from './lib/place-matcher';
import { isRejected, readRejections } from './lib/reviewed-csv';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'missing-huts-review.html');
const CACHE = join(ROOT, 'assets', 'data', 'missing-huts-osm.json');
const RECHECK = process.argv.includes('--recheck');
const UA = 'AlpineHutsApp/1.0 (hut-to-hut hiking app; margot.soederhuizen@live.nl)';

/** Only report a hut this far from anything the app already has. */
const MIN_GAP_METRES = 500;

interface Candidate {
  name: string;
  lat: number;
  lon: number;
  source: string;
  elevation?: string;
  website?: string;
  phone?: string;
}

const RAD = Math.PI / 180;
function metres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(x));
}

/** Every hut an outside source knows, from whichever files are present. */
function candidates(): Candidate[] {
  const out: Candidate[] = [];

  const registerPath = process.argv.find((a) => a.endsWith('.json') && a.includes('huts find'));
  const fromDownloads = join(process.env.USERPROFILE ?? '', 'Downloads', 'huts find 2.json');
  const reg = registerPath ?? fromDownloads;
  if (existsSync(reg)) {
    for (const r of JSON.parse(readFileSync(reg, 'utf8')) as Array<Record<string, unknown>>) {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({
        name: String(r.name ?? ''),
        lat,
        lon,
        source: 'Alpenverein register',
        elevation: r.elevation ? String(r.elevation) : undefined,
        website: Array.isArray(r.websites) ? String(r.websites[0] ?? '') || undefined : undefined,
        phone: r.phone ? String(r.phone) : undefined,
      });
    }
  }

  const tyrol = join(ROOT, 'assets', 'data', 'tyrol-huts.json');
  if (existsSync(tyrol)) {
    for (const r of JSON.parse(readFileSync(tyrol, 'utf8')) as Candidate[]) {
      out.push({ ...r, source: 'tyrol.com' });
    }
  }
  return out;
}

/** Which region's bounds contain this point — empty means a genuine gap. */
function regionsFor(lat: number, lon: number): string[] {
  return REGIONS.filter(
    (r) =>
      r.bbox &&
      lat >= r.bbox.south &&
      lat <= r.bbox.north &&
      lon >= r.bbox.west &&
      lon <= r.bbox.east,
  ).map((r) => r.id);
}

const LODGING =
  '["tourism"~"^(alpine_hut|wilderness_hut|chalet|guest_house|hostel|hotel|camp_site)$"]';

/**
 * Ask OSM what lodging it has near each point.
 *
 * Batched into one query per chunk: Overpass is a shared public service and 87
 * separate requests would be rude where four will do.
 */
async function askOsm(points: Candidate[]): Promise<Record<string, string>> {
  const cached: Record<string, string> = existsSync(CACHE) && !RECHECK
    ? JSON.parse(readFileSync(CACHE, 'utf8'))
    : {};
  const key = (c: Candidate) => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
  const todo = points.filter((p) => !(key(p) in cached));
  if (!todo.length) return cached;

  console.log(`asking OpenStreetMap about ${todo.length} points…`);
  const CHUNK = 25;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    const clauses = chunk
      .map((c) => `nwr(around:250,${c.lat},${c.lon})${LODGING};nwr(around:250,${c.lat},${c.lon})["amenity"="shelter"];`)
      .join('');
    const body = `data=[out:json][timeout:180];(${clauses});out tags center;`;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(200_000),
      });
      const j = (await res.json()) as {
        elements: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }>;
      };
      for (const c of chunk) {
        let best: string = '';
        let bd = Infinity;
        for (const e of j.elements ?? []) {
          const lat = e.lat ?? e.center?.lat;
          const lon = e.lon ?? e.center?.lon;
          if (lat == null || lon == null) continue;
          const d = metres(c.lat, c.lon, lat, lon);
          if (d <= 250 && d < bd) {
            bd = d;
            best = `${e.type}/${e.id} · ${e.tags?.name ?? '(unnamed)'} · ${e.tags?.tourism ?? e.tags?.amenity ?? '?'} · ${Math.round(d)} m`;
          }
        }
        cached[key(c)] = best;
      }
      writeFileSync(CACHE, JSON.stringify(cached, null, 1));
      process.stdout.write(`\r  ${Math.min(i + CHUNK, todo.length)}/${todo.length}   `);
    } catch {
      // Leave this chunk uncached so a re-run picks it up.
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('');
  return cached;
}

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function main() {
  const places = appPlaces();
  const all = candidates();

  // One row per hut, even when several sources know it.
  const rows: Array<Candidate & { gap: number; nearest: string; regions: string[] }> = [];
  for (const c of all) {
    if (!c.name || !namesALodging(c.name)) continue;
    let nearest = '';
    let gap = Infinity;
    for (const p of places) {
      const d = metres(c.lat, c.lon, p.lat, p.lon);
      if (d < gap) {
        gap = d;
        nearest = p.name ?? '(unnamed)';
      }
    }
    if (gap <= MIN_GAP_METRES) continue;
    // Already collected from another source?
    const twin = rows.find((r) => metres(r.lat, r.lon, c.lat, c.lon) < 100);
    if (twin) {
      if (!twin.source.includes(c.source)) twin.source += ` + ${c.source}`;
      twin.website ??= c.website;
      twin.phone ??= c.phone;
      continue;
    }
    rows.push({ ...c, gap, nearest, regions: regionsFor(c.lat, c.lon) });
  }

  const osm = await askOsm(rows);
  const key = (c: Candidate) => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;

  // Recoverable first: OSM has it, so a regeneration brings it back.
  const scored = rows.map((r) => ({ r, osm: osm[key(r)] ?? '' }));
  const inScope = (s: { r: { regions: string[] } }) => s.r.regions.length > 0;
  // Recoverable first, then the ones needing a decision, then out of scope.
  const rank = (s: { r: { regions: string[] }; osm: string }) =>
    !inScope(s) ? 2 : s.osm ? 0 : 1;
  scored.sort((a, b) => rank(a) - rank(b) || b.r.gap - a.r.gap);
  const recoverable = scored.filter((s) => inScope(s) && s.osm).length;

  const body = scored
    .map(({ r, osm: hit }) => {
      /**
       * ⚠️ OUT OF SCOPE BEATS "IN OSM", AND GETTING THAT ORDER WRONG MISLED A
       * WHOLE ROUND OF REVIEW. Ranking the OSM hit first counted the DAV's
       * lowland section huts — Eifel, Harz, Franconia, the Vienna woods — as
       * "we missed it, regenerate", when the nearest place the app holds is
       * 200 to 316 km away and the app is about the Alps. OSM having a thing
       * says nothing about whether this app should carry it.
       */
      const cls = !r.regions.length ? 'outside' : hit ? 'osm' : 'manual';
      const label = !r.regions.length ? 'OUTSIDE EVERY REGION' : hit ? 'IN OSM — WE MISSED IT' : 'NOT IN OSM';
      const contact = [
        r.website ? `<a href="${esc(r.website)}" target="_blank" rel="noreferrer">${esc(r.website)}</a>` : '',
        r.phone ? esc(r.phone) : '',
        r.elevation ? esc(r.elevation) : '',
      ].filter(Boolean).join(' · ');
      return `<tr class="${cls}">
        <td><span class="badge ${cls}">${label}</span></td>
        <td>
          <div class="name">${esc(r.name)}</div>
          <div class="meta">${esc(r.source)} · ${r.regions.join(', ') || 'no region'} ·
            nearest app place <b>${esc(r.nearest)}</b> at ${(r.gap / 1000).toFixed(1)} km</div>
          ${contact ? `<div class="meta">${contact}</div>` : ''}
          ${hit ? `<div class="meta osmhit">OSM: ${esc(hit)}</div>` : ''}
        </td>
        <td class="links">
          <a href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=17/${r.lat}/${r.lon}" target="_blank" rel="noreferrer">OSM</a>
          <a href="https://www.google.com/maps?q=${r.lat},${r.lon}" target="_blank" rel="noreferrer">Maps</a>
        </td>
      </tr>`;
    })
    .join('\n');

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Missing huts</title>
<style>
  :root { --ink:#1b1b1b; --muted:#6b6b6b; --line:#e6e6e6; --bg:#fbfaf8; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
  header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); padding:16px 20px; z-index:2; }
  h1 { margin:0 0 4px; font-size:18px; }
  p.sub { margin:0 0 10px; color:var(--muted); max-width:70ch; }
  .filters { display:flex; gap:6px; flex-wrap:wrap; }
  button { border:1px solid var(--line); background:#fff; border-radius:999px; padding:5px 11px; font-size:12px; cursor:pointer; color:var(--ink); }
  button[aria-pressed="true"] { background:var(--ink); color:#fff; border-color:var(--ink); }
  table { width:100%; border-collapse:collapse; }
  td { border-bottom:1px solid var(--line); padding:10px 12px; vertical-align:top; }
  .badge { display:inline-block; font-size:10px; font-weight:700; letter-spacing:.04em; padding:3px 7px; border-radius:4px; white-space:nowrap; }
  .badge.osm { background:#1b6b3a; color:#fff; }
  .badge.manual { background:#b8860b; color:#fff; }
  .badge.outside { background:#777; color:#fff; }
  .name { font-weight:600; }
  .meta { color:var(--muted); font-size:12px; }
  .osmhit { color:#1b6b3a; }
  .links { white-space:nowrap; }
  .links a { margin-right:8px; color:#1a5fb4; }
  a { color:#1a5fb4; }
  @media (max-width:760px){ table,tbody,tr,td{display:block} tr{border-bottom:1px solid var(--line);padding:8px 0} td{border:0;padding:2px 12px} }
</style>
<header>
  <h1>Huts the app is missing — ${scored.length}</h1>
  <p class="sub"><b>${recoverable}</b> of these are already in OpenStreetMap, correctly tagged — the app's
     generator simply did not pick them up, so regenerating recovers them and they stay current by themselves.
     The rest would need a hand-entered record. Every row links to its coordinates on both maps so you can check it.</p>
  <div class="filters">
    <button data-f="all" aria-pressed="true">All (${scored.length})</button>
    <button data-f="osm" aria-pressed="false">In OSM — recoverable (${recoverable})</button>
    <button data-f="manual" aria-pressed="false">Not in OSM (${scored.filter((s) => inScope(s) && !s.osm).length})</button>
    <button data-f="outside" aria-pressed="false">Outside every region (${scored.filter((s) => !inScope(s)).length})</button>
  </div>
</header>
<table><tbody>
${body}
</tbody></table>
<script>
  const btns=[...document.querySelectorAll('button[data-f]')];
  btns.forEach((b)=>b.addEventListener('click',()=>{
    btns.forEach((o)=>o.setAttribute('aria-pressed',String(o===b)));
    const f=b.dataset.f;
    document.querySelectorAll('tbody tr').forEach((tr)=>{
      tr.style.display = f==='all' || tr.classList.contains(f) ? '' : 'none';
    });
  }));
</script>`;

  writeFileSync(OUT, html);

  /**
   * ⚠️ A SPREADSHEET FOR THE ONES OSM DOES NOT HAVE, PRE-FILLED.
   *
   * Those need a hand-entered record, and the only things a person actually has
   * to supply are the two a machine cannot: whether the place is real and still
   * open, and WHAT KIND of place it is — the register lists apartments and
   * valley hotels alongside genuine refuges, and `type` decides whether it ever
   * appears as a hut-to-hut stop. Name, coordinates, website and telephone are
   * already known, so asking for them again would be asking someone to retype
   * data we hold.
   *
   * CSV rather than a form, because the hut database this project already runs
   * on is a spreadsheet: it opens in the tool that is already in use.
   */
  if (process.argv.includes('--csv')) {
    /**
     * ⚠️ ALREADY-REFUSED ROWS ARE EXCLUDED, AND THAT IS THE WHOLE POINT OF THE
     * REJECTIONS FILE. A refused place is never added, so it stays "missing"
     * and would be listed here again, every run, with an empty `keep?` cell
     * that means yes. On 2026-10-01 a regenerated version of this CSV held 15
     * rows and ALL 15 were ones the reviewer had already turned down.
     *
     * An empty CSV now honestly means there is nothing left to decide.
     */
    const rejected = readRejections();
    const fresh = scored.filter((s) => inScope(s) && !s.osm);
    const needInput = fresh.filter((s) => !isRejected(rejected, { name: s.r.name, lat: s.r.lat, lon: s.r.lon }));
    const skipped = fresh.length - needInput.length;
    if (skipped) console.log(`\n${skipped} rows left out — already refused in an earlier review`);
    const q = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const guess = (n: string) =>
      /biwak|bivacco|bivouac/i.test(n) ? 'shelter'
      : /selbstversorg|winterraum|unbewirt/i.test(n) ? 'wilderness_hut'
      : /hütte|huette|haus|hospiz|rifugio|capanna|alm\b/i.test(n) ? 'alpine_hut'
      : 'guesthouse';
    const lines = [
      ['keep? (y/n)', 'type', 'name', 'latitude', 'longitude', 'elevation', 'website', 'phone', 'region', 'nearest app place', 'km away', 'check on a map', 'source'].join(','),
      ...needInput.map(({ r }) =>
        [
          '', guess(r.name), r.name, r.lat, r.lon, r.elevation ?? '', r.website ?? '', r.phone ?? '',
          r.regions[0] ?? '', r.nearest, (r.gap / 1000).toFixed(1),
          `https://www.google.com/maps?q=${r.lat},${r.lon}`, r.source,
        ].map((v) => q(String(v))).join(','),
      ),
    ];
    const csvPath = join(ROOT, 'missing-huts-to-check.csv');
    // BOM, so Excel opens the umlauts as umlauts rather than mojibake.
    writeFileSync(csvPath, '﻿' + lines.join('\r\n'));
    console.log(`\n-> ${csvPath}   (${needInput.length} rows to confirm)`);
  }

  console.log(`${scored.length} missing huts`);
  console.log(`  already in OSM (regeneration recovers them): ${recoverable}`);
  console.log(`  not in OSM, inside a region:                 ${scored.filter((s) => inScope(s) && !s.osm).length}`);
  console.log(`  outside every region's bounds:               ${scored.filter((s) => !inScope(s)).length}`);
  console.log(`\n-> ${OUT}`);
}

main();
