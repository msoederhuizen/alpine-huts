/**
 * Does the page a photo came from describe a building anywhere NEAR the hut?
 *
 * WHY THIS IS THE CHECK THAT MATTERS. Every filter before it asks about the
 * IMAGE — is it a map, a thumbnail, a stock photo, does the name appear. None
 * of them can answer the question that actually decides correctness: is this
 * the right BUILDING. A human review of 437 rejected 37%, and the residue was
 * always the same shape — a correct name in the wrong place. "Gîte L'Atelier"
 * in Auvers-sur-Oise, a Rimini beach hotel, "Benediktenhof" 104 km away in
 * Bad Tölz.
 *
 * Hotel and guesthouse pages very often publish a schema.org address, and some
 * publish coordinates outright. That is a POSITION, which turns this source
 * from name-matched into coordinate-checked — the same footing as
 * refuges.info, Overture and CAI, which are the sources that never went wrong.
 *
 * ⚠️ A POSTCODE RESOLVES TO ITS CENTRE, NOT THE BUILDING. So 3 km means
 * nothing and 100 km means everything; the bands are deliberately wide. A hut
 * legitimately sits some way from the village whose postcode it uses.
 *
 * ⚠️ UNKNOWN IS NOT A PASS. A page that will not load, or publishes no address,
 * is unverified — and in the 85-photo trial the verifiable ones were 40% wrong,
 * so an unverified photo should inherit that suspicion rather than the
 * innocence of the ones that passed.
 *
 * Resumable: results are written as they arrive and re-running skips what is
 * already decided.
 *
 *   npm run verify-photo-locations
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f: string) => join(ROOT, 'assets', 'data', f);
const OUT = join(ROOT, 'photo-locations.json');

/** Nominatim's usage policy REQUIRES a descriptive agent naming the app and a
 *  contact. That is compliance, not disguise — unlike pretending to be a
 *  browser, which this project does not do. */
const UA = 'AlpineHutsApp/1.0 (hut photo location check; github.com/msoederhuizen)';

/** ⚠️ FOUR. Six killed an earlier sweep by exhausting Windows sockets — every
 *  closed connection lingers in TIME_WAIT. Different hosts, so four costs none
 *  of them anything. */
const PAGE_WORKERS = 4;
/** Nominatim: one request per second, serialised, no exceptions. */
const GEO_PAUSE_MS = 1100;

const NEAR_KM = 25;
const FAR_KM = 100;

interface Verdict {
  name: string;
  verdict: 'OK' | 'SUSPECT' | 'WRONG' | 'UNKNOWN';
  km: number | null;
  where: string;
  how: 'geo' | 'postcode' | 'town' | '';
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
function km(a: number, b: number, c: number, d: number) {
  const dLat = rad(c - a);
  const dLon = rad(d - b);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const looksLikeStreet = (s?: string) => !s || /\d|stra(ss|ß)e|weg|gasse|platz|via |rue /i.test(s);

/** Coordinates straight from the page beat any geocode: no centroid, no
 *  ambiguity, no third-party request. */
function geoOf(html: string): [number, number] | null {
  const lat = html.match(/"latitude"\s*:\s*"?(-?\d{1,2}\.\d{3,})/i)?.[1];
  const lon = html.match(/"longitude"\s*:\s*"?(-?\d{1,3}\.\d{3,})/i)?.[1];
  if (!lat || !lon) return null;
  const a = Number(lat);
  const b = Number(lon);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

function addressOf(html: string) {
  return {
    postal: html.match(/"postalCode"\s*:\s*"([^"]{3,10})"/i)?.[1],
    town: html.match(/"addressLocality"\s*:\s*"([^"]{2,60})"/i)?.[1],
    country: html.match(/"addressCountry"\s*:\s*"([^"]{2,40})"/i)?.[1],
  };
}

async function main() {
  const found: Record<string, { url: string; source: string; name: string }> = JSON.parse(
    readFileSync(D('brave-images.json'), 'utf8'),
  );

  const coords = new Map<string, { lat: number; lon: number }>();
  for (const line of readFileSync(join(ROOT, 'search-list.csv'), 'utf8')
    .replace(/^﻿/, '')
    .split('\n')
    .slice(1)) {
    if (!line.trim()) continue;
    const m = /^([^,]+),(?:"(?:[^"]|"")*"|[^,]*),[^,]*,([^,]*),([^,]*),/.exec(line);
    if (m) coords.set(m[1], { lat: Number(m[2]), lon: Number(m[3]) });
  }

  const done: Record<string, Verdict> = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : {};
  const todo = Object.entries(found).filter(([id]) => !done[id] && coords.has(id));

  console.log(`${Object.keys(found).length.toLocaleString()} photos held`);
  console.log(`${Object.keys(done).length.toLocaleString()} already checked`);
  console.log(`${todo.length.toLocaleString()} to check\n`);
  if (!todo.length) return;

  // One geocode queue, strictly serialised — the page workers queue onto it.
  const geoCache = new Map<string, [number, number] | null>();
  let geoChain: Promise<unknown> = Promise.resolve();
  function geocode(q: string): Promise<[number, number] | null> {
    if (geoCache.has(q)) return Promise.resolve(geoCache.get(q)!);
    const run = geoChain.then(async () => {
      if (geoCache.has(q)) return geoCache.get(q)!;
      let got: [number, number] | null = null;
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
          { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) },
        );
        if (r.ok) {
          const j = (await r.json()) as { lat: string; lon: string }[];
          if (j.length) got = [Number(j[0].lat), Number(j[0].lon)];
        }
      } catch { /* leave null */ }
      geoCache.set(q, got);
      await sleep(GEO_PAUSE_MS);
      return got;
    });
    geoChain = run.catch(() => {});
    return run as Promise<[number, number] | null>;
  }

  let n = 0;
  let next = 0;
  const t0 = Date.now();

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= todo.length) return;
      const [id, photo] = todo[i];
      const here = coords.get(id)!;
      let v: Verdict = { name: photo.name, verdict: 'UNKNOWN', km: null, where: '', how: '' };

      try {
        const res = await fetch(photo.source, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) {
          const html = await res.text();
          let there = geoOf(html);
          let how: Verdict['how'] = there ? 'geo' : '';
          let where = there ? `${there[0].toFixed(3)}, ${there[1].toFixed(3)}` : '';

          if (!there) {
            const a = addressOf(html);
            const town = looksLikeStreet(a.town) ? undefined : a.town;
            const q = a.postal
              ? [a.postal, a.country].filter(Boolean).join(', ')
              : [town, a.country].filter(Boolean).join(', ');
            if (q.length > 2) {
              there = await geocode(q);
              how = a.postal ? 'postcode' : 'town';
              where = q;
            }
          }

          if (there && Number.isFinite(here.lat)) {
            const d = km(here.lat, here.lon, there[0], there[1]);
            v = {
              name: photo.name,
              km: d,
              where,
              how,
              verdict: d <= NEAR_KM ? 'OK' : d <= FAR_KM ? 'SUSPECT' : 'WRONG',
            };
          }
        }
      } catch { /* stays UNKNOWN */ }

      done[id] = v;
      if (++n % 25 === 0) {
        writeFileSync(OUT, JSON.stringify(done));
        const rate = n / ((Date.now() - t0) / 1000);
        const left = Math.round((todo.length - n) / Math.max(rate, 0.01) / 60);
        process.stdout.write(`\r  ${n}/${todo.length}   ~${left} min left   `);
      }
      await sleep(250);
    }
  }

  await Promise.all(Array.from({ length: PAGE_WORKERS }, worker));
  writeFileSync(OUT, JSON.stringify(done));

  const by: Record<string, number> = {};
  for (const x of Object.values(done)) by[x.verdict] = (by[x.verdict] ?? 0) + 1;
  console.log(`\n\n${'='.repeat(50)}`);
  for (const k of ['OK', 'SUSPECT', 'WRONG', 'UNKNOWN']) {
    if (by[k]) console.log(`  ${k.padEnd(9)} ${by[k].toLocaleString()}`);
  }
  const checked = Object.values(done).filter((x) => x.verdict !== 'UNKNOWN').length;
  const bad = (by.WRONG ?? 0) + (by.SUSPECT ?? 0);
  console.log(`\n  verifiable     ${checked.toLocaleString()} of ${Object.keys(done).length.toLocaleString()}`);
  if (checked) console.log(`  wrong of those ${bad.toLocaleString()}  ${Math.round((bad / checked) * 100)}%`);
  console.log(`\n-> ${OUT}`);
}

main();
