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

/**
 * Which version of the reading below produced a verdict.
 *
 * ⚠️ BUMP THIS WHENEVER THE PARSE OR THE BANDS CHANGE, or the improvement never
 * reaches the rows that need it most. Results are resumable and keyed by id
 * alone, so without a version a re-run skips everything already decided — and
 * the rows decided by the WORSE parser are precisely the ones carrying its
 * mistakes. `brave-find-images.ts` documents the same trap on its re-check
 * block, and a bare key is what left `.tried` unable to say whether --place
 * helps.
 *
 * 1: regex over the whole page. Matched the first `postalCode` anywhere in the
 *    HTML, so a footer, a sister property or the operator's registered office
 *    could decide a hut's position.
 * 2: JSON-LD, scoped to the lodging's own node; a non-Alpine country is read as
 *    no evidence; beyond 800 km is read as a bad parse, not a wrong photo.
 */
const PARSER = 2;

interface Verdict {
  name: string;
  verdict: 'OK' | 'SUSPECT' | 'WRONG' | 'UNKNOWN';
  km: number | null;
  where: string;
  how: 'geo' | 'postcode' | 'town' | '';
  /** @see PARSER. Absent on rows written before this was versioned. */
  parser?: number;
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

/**
 * ⚠️ READ THE ADDRESS OUT OF THE LODGING'S OWN SCHEMA BLOCK, NOT OFF THE PAGE.
 * The first version regex-matched the first `postalCode` anywhere in the HTML,
 * and a hotel page routinely carries several addresses — a footer, a sister
 * property, a booking widget, the operator's registered office. It produced
 * "EX2 5JL, Switzerland" (a Beckenham postcode) and an Italian hut 8,729 km
 * from itself, which is not a wrong photo but a wrong read, and would have been
 * reported as the former.
 */
const LODGING = /^(Hotel|LodgingBusiness|BedAndBreakfast|Hostel|Resort|Motel|Campground|GuestHouse|Place|LocalBusiness|TouristAttraction)$/i;

interface Site { geo?: [number, number]; postal?: string; town?: string; country?: string }

/** Walk a parsed JSON-LD value for the first lodging-ish node with a location. */
function fromNode(node: unknown, out: Site, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 6 || out.geo) return;
  if (Array.isArray(node)) { for (const n of node) fromNode(n, out, depth + 1); return; }
  const o = node as Record<string, any>;
  const types = ([] as string[]).concat(o['@type'] ?? []);
  const isLodging = types.some((t) => LODGING.test(String(t)));

  if (isLodging) {
    const g = o.geo;
    const lat = Number(g?.latitude), lon = Number(g?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
      out.geo = [lat, lon];
      return;
    }
    const a = o.address;
    if (a && typeof a === 'object') {
      out.postal ??= a.postalCode ? String(a.postalCode).trim() : undefined;
      out.town ??= a.addressLocality ? String(a.addressLocality).trim() : undefined;
      out.country ??= a.addressCountry
        ? String(typeof a.addressCountry === 'object' ? a.addressCountry.name ?? '' : a.addressCountry).trim()
        : undefined;
    }
  }
  for (const k of ['@graph', 'mainEntity', 'itemListElement', 'item', 'hasPart']) {
    if (o[k]) fromNode(o[k], out, depth + 1);
  }
}

function siteOf(html: string): Site {
  const out: Site = {};
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { fromNode(JSON.parse(m[1].trim()), out); } catch { /* malformed block, skip it */ }
    if (out.geo) break;
  }
  return out;
}

/**
 * ⚠️ EVERY HUT IN THIS APP IS IN ONE OF THESE COUNTRIES. A page claiming any
 * other one has been misread — "98826, US" resolved to Leavenworth, Washington,
 * 8,491 km away, which says nothing about the photograph and everything about
 * the parse. Treated as no evidence rather than as evidence of a wrong photo.
 */
const OUR_COUNTRIES = /^(germany|deutschland|de|austria|österreich|osterreich|at|switzerland|schweiz|suisse|svizzera|ch|italy|italia|it|france|fr|slovenia|slovenija|si|spain|españa|es|portugal|pt|norway|norge|no)$/i;

async function main() {
  const found: Record<string, { url: string; source: string; name: string }> = JSON.parse(
    readFileSync(D('brave-images.json'), 'utf8'),
  );

  /**
   * Where each hut actually is, from the SHIPPED DATA rather than from
   * search-list.csv.
   *
   * ⚠️ THE CSV SILENTLY DROPPED 217 OF THE 1,522 BANKED PHOTOS. It is
   * regenerated as the search list changes, so a photo banked from an earlier
   * list has no row in it — and the `coords.has(id)` filter below then removed
   * those photos from `todo` before anything counted them, so they appeared in
   * no total, no verdict and no summary. That is weaker than UNKNOWN, which
   * this file deliberately treats as suspicion rather than a pass: an unlisted
   * photo was not even suspected. The bundle is every place the app ships and
   * covers all 1,522.
   */
  const coords = new Map<string, { lat: number; lon: number }>();
  {
    type Place = { id: string; lat: number; lon: number };
    const bundle = JSON.parse(readFileSync(D('huts-bundle.json'), 'utf8')) as {
      core?: Record<string, Place[]>;
      accommodations?: Record<string, Place[]>;
      villages?: Record<string, Place[]>;
    };
    for (const group of [bundle.core, bundle.accommodations, bundle.villages]) {
      for (const list of Object.values(group ?? {})) {
        for (const h of list) {
          if (Number.isFinite(h.lat) && Number.isFinite(h.lon)) {
            coords.set(h.id, { lat: h.lat, lon: h.lon });
          }
        }
      }
    }
  }

  const done: Record<string, Verdict> = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : {};

  // Forget what an older parser decided, so the improvement actually reaches
  // it — see PARSER. Announced rather than silent: this re-spends page fetches
  // and Nominatim calls, which the operator should see coming.
  let reopened = 0;
  for (const [id, v] of Object.entries(done)) {
    if ((v.parser ?? 1) < PARSER) {
      delete done[id];
      reopened++;
    }
  }

  // A photo whose place has no coordinates is RECORDED as unverifiable, not
  // dropped from the run — see the note on `coords`. It stays visible and
  // inherits the suspicion an UNKNOWN carries.
  let placeless = 0;
  for (const [id, photo] of Object.entries(found)) {
    if (coords.has(id) || done[id]) continue;
    done[id] = {
      name: photo.name,
      verdict: 'UNKNOWN',
      km: null,
      where: 'no coordinates for this place',
      how: '',
      parser: PARSER,
    };
    placeless++;
  }

  const todo = Object.entries(found).filter(([id]) => !done[id] && coords.has(id));

  console.log(`${Object.keys(found).length.toLocaleString()} photos held`);
  if (reopened) console.log(`${reopened.toLocaleString()} re-opened — decided by parser ${PARSER - 1} or older`);
  if (placeless) console.log(`${placeless.toLocaleString()} have no coordinates — recorded UNKNOWN, not skipped`);
  console.log(`${Object.keys(done).length.toLocaleString()} already checked`);
  console.log(`${todo.length.toLocaleString()} to check\n`);
  // Still persist, so a run with nothing to fetch records the placeless rows.
  if (!todo.length) {
    writeFileSync(OUT, JSON.stringify(done));
    return;
  }

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
      let v: Verdict = { name: photo.name, verdict: 'UNKNOWN', km: null, where: '', how: '', parser: PARSER };

      try {
        const res = await fetch(photo.source, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) {
          const site = siteOf(await res.text());
          let there = site.geo ?? null;
          let how: Verdict['how'] = there ? 'geo' : '';
          let where = there ? `${there[0].toFixed(3)}, ${there[1].toFixed(3)}` : '';

          // A country outside the Alps means the parse went wrong, not that the
          // photo is of somewhere else — so stop rather than geocode nonsense.
          const foreign = site.country && !OUR_COUNTRIES.test(site.country);

          if (!there && !foreign) {
            const town = looksLikeStreet(site.town) ? undefined : site.town;
            const q = site.postal
              ? [site.postal, site.country].filter(Boolean).join(', ')
              : [town, site.country].filter(Boolean).join(', ');
            if (q.length > 2) {
              there = await geocode(q);
              how = site.postal ? 'postcode' : 'town';
              where = q;
            }
          }

          if (there && Number.isFinite(here.lat)) {
            const d = km(here.lat, here.lon, there[0], there[1]);
            /**
             * ⚠️ BEYOND 800 KM THIS IS EVIDENCE ABOUT THE PARSE, NOT THE PHOTO.
             * The real wrong ones cluster at 100–400 km — a Black Forest hotel,
             * a Bavarian Forest pension, Benediktenhof at 104. Nothing on these
             * sites lists an alpine guesthouse on another continent, so a
             * four-figure distance means a postcode resolved somewhere absurd.
             * Recorded as unverified rather than counted as wrong.
             */
            v =
              d > 800
                ? { name: photo.name, verdict: 'UNKNOWN', km: null, where: `${where} (implausible ${Math.round(d)} km — bad read)`, how, parser: PARSER }
                : {
                    name: photo.name,
                    km: d,
                    where,
                    how,
                    verdict: d <= NEAR_KM ? 'OK' : d <= FAR_KM ? 'SUSPECT' : 'WRONG',
                    parser: PARSER,
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
