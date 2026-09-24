import type { BBox } from '../constants/region';
import {
  isOvernightCapable,
  MOUNTAIN_REFUGE_NAME_RE,
  unnamedHutLabel,
} from '../utils/hutMeta';
import { isNonLodgingPoi, isSubFeatureName } from '../utils/lodging';
import type { Hut, HutType } from '../types/hut';
import { fetchElevations } from './elevation';

/** Public Overpass instances, tried in order if one is down/rate-limited.
 *  ⚠️ MUST stay GLOBAL mirrors only. The old first entry `overpass.osm.ch` is a
 *  Switzerland-only instance — it returns 200 with an EMPTY result set for any
 *  area outside Switzerland, and `runOverpass` only falls through to the next
 *  mirror on an ERROR (not on empty), so a Swiss mirror at the front silently
 *  broke every Italian (or any non-CH) region. Don't re-add a country-scoped
 *  mirror here. */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ⚠️ DO NOT ADD `overpass.openstreetmap.fr`. It was added here briefly because
// it answered ad-hoc queries while both mirrors above were failing — but under
// the generator's own User-Agent it returns:
//
//     HTTP 403  "This service is only available to white-listed usages"
//
// Verified as a UA check, not rate limiting: the same query at the same moment
// returned 200 with a different User-Agent string. That difference is not a
// licence to change ours — the instance is telling us we are not entitled to
// use it, and spoofing past that is abusing volunteer infrastructure. If we
// ever genuinely need a third endpoint, ask them for whitelisting or self-host.

/** Overpass's usage policy requires a meaningful User-Agent. Without one the
 *  public mirrors reject us outright — overpass-api.de returns 406 and
 *  kumi.systems 429 ("Please include a meaningful User-Agent string with your
 *  request") — which surfaced in the app as "Couldn't load huts". Verified: the
 *  same query returns 200 on every mirror once this header is sent. */
const USER_AGENT = 'AlpineHutsApp/0.1 (hut-to-hut hiking route planner)';

const BOOKING_URL = 'https://www.hut-reservation.org/';

/**
 * Name keywords that reliably mark a mountain guesthouse/inn (always included,
 * even when OSM tags them only as a restaurant). Kept in sync with the name
 * regex used in the Overpass query.
 */
// Mountain-inn name keywords for places NOT already tagged tourism=alpine_hut.
// Extended beyond German/Italian when France, Austria, Germany, Spain and
// Portugal were added — a Pyrenean "Refuge de …" or an Asturian "Refugio de …"
// is invisible to Berghaus/Rifugio keywords, so those regions would have come
// back nearly empty of unofficial huts. Kept in sync with `guestNames` below.
const GUESTHOUSE_NAME_RE =
  /(berghaus|berggasthaus|berggasthof|berghotel|naturfreundeh|alpengasthaus|rifugio|capanna|agriturismo|refuge|refugi|refugio|refúgio|gîte|gite|albergue|abrigo|schutzhaus|berghütte|alpengasthof|koča|koca|planinski dom|zavetišče|zavetisce|turisthytte|fjellstue|fjellstove|hytte|hytta|fjällstation|fjallstation|fjällstuga|fjallstuga|stugor)/i;

/**
 * Plain hotels with no other mountain signal (no keyword, no elevation) that we
 * still want on the map. Extend by hand as more are reported. Lowercased.
 */
const GUESTHOUSE_INCLUDE_NAMES = new Set(['golderli']);

// (A manual `LODGING_INCLUDE_IDS` allowlist briefly lived here to force in the
// Grindelwald Blümlisalp. It was removed once `isNamedLodgingBuilding` covered
// that case generically — a hand-maintained id list is a liability, and the real
// signal was `building=hotel` all along.)

/**
 * Generic lodging tags that we include only when they sit high enough to be a
 * mountain accommodation (many are just named "Hotel X", e.g. Hotel Gasterntal
 * at 1552 m). The elevation cutoff keeps mountain places while dropping valley/
 * town hotels (Kandersteg ~1176 m, Grindelwald ~1034 m, Interlaken ~568 m).
 */
const MOUNTAIN_LODGING_TOURISM = new Set(['hotel', 'guest_house', 'hostel']);
/**
 * Generic hotels/guest_houses/hostels count as mountain lodging above this.
 *
 * Lowered 1200→900. The cutoff was always a crude PROXY for "not a town hotel",
 * and it can't actually separate the two: Hotel Wetterhorn (1046 m, an isolated
 * Grindelwald trailhead inn) sits at essentially the same height as Grindelwald
 * village itself (~1034 m). Any threshold that excluded the town also excluded
 * the trailhead — which is why Gasthaus Zwirgi (980 m), Hotel Wetterhorn
 * (1046 m) and Blümlisalp were all missing.
 *
 * `dropCrowdedLodging` in utils/lodging.ts now does the town-exclusion job
 * directly and far better (>5 other accommodations within 1 km ⇒ a village high
 * street), so elevation only has to exclude the deep valley floors —
 * Interlaken ~568 m, Meiringen ~600 m, Lauterbrunnen ~800 m.
 */
const MOUNTAIN_ELE_MIN = 900;

/** Above this share of failed DEM lookups, `fetchAccommodations` throws instead
 *  of returning a silently-thinned list. A few genuine misses are normal; a
 *  third of them means the elevation service is down or rate-limited. */
const MAX_UNRESOLVED_ELEVATION_RATIO = 0.3;

/**
 * Optional `type/id -> metres` cache for DEM lookups, injected by the bundle
 * generator (`scripts/generate-huts.ts`) and left null in the app.
 *
 * Exists because the elevation API has a DAILY quota that a single regeneration
 * can exhaust: places lacking an OSM `ele` tag need a lookup each, and the
 * `building=hotel` rule added ~1 500 such places per region. A building's
 * altitude never changes, so anything resolved once should never be asked again.
 */
let elevationCache: Map<string, number> | null = null;
export function setElevationCache(cache: Map<string, number> | null): void {
  elevationCache = cache;
}

/**
 * Private holiday-rental name patterns to exclude from elevation-gated lodging.
 * High resort villages (Bettmeralp, Riederalp, Fiesch) are full of "Haus X" /
 * "Chalet X" / "Ferienwohnung" apartments that sit above 1200 m but aren't
 * hut-to-hut accommodation. Real inns ("Berghaus"/"Gasthaus"/"…hotel") are
 * unaffected — "Berghaus" is already matched as a named guesthouse first.
 */
const HOLIDAY_RENTAL_RE =
  /^(haus|chalet|apartment|appartement|studio)\b|ferien(haus|wohnung|zimmer|heim)|apartment|wohnung/i;

/**
 * POIs that can share a guesthouse's name but aren't lodging — a parking lot,
 * bus stop, info board or boat rental "at the Berghaus". Never include these.
 */
const NON_LODGING_AMENITY = new Set([
  'parking',
  'bicycle_parking',
  'boat_rental',
  'bus_stop',
  'bench',
  'bicycle_rental',
  'toilets',
  'drinking_water',
  'waste_basket',
  'vending_machine',
]);

/** True when a named element is a guesthouse we can classify from tags alone. */
function isNamedGuesthouse(tags: Record<string, string>): boolean {
  const name = tags.name?.trim();
  if (!name) return false;
  // The query matches on NAME, so anything named after a nearby hotel/refuge is
  // swept in — webcams especially ("Webcam Rifugio Lagazuoi"). Reject those at
  // the source so regenerated bundles are clean; `useHuts` applies the same
  // predicate at runtime for the already-shipped bundle.
  if (isNonLodgingPoi(tags)) return false;
  // "Teleferica Rifugio Stoppani" contains Rifugio and would pass the keyword
  // test below — it's the goods cableway, not the hut. See isSubFeatureName.
  if (isSubFeatureName(name)) return false;
  if (tags.amenity && NON_LODGING_AMENITY.has(tags.amenity)) return false;
  return (
    GUESTHOUSE_NAME_RE.test(name) ||
    GUESTHOUSE_INCLUDE_NAMES.has(name.toLowerCase())
  );
}

/**
 * A restaurant that also puts people up for the night. OSM records these two
 * ways: the common one is `amenity=restaurant` PLUS a `tourism` lodging tag
 * (e.g. Blümlisalp: `amenity=restaurant` + `tourism=hotel` + `rooms=20`), which
 * the `tourism` check below already covers. The rarer one is a restaurant with
 * `rooms=`/`accommodation=yes` and NO tourism tag — a Gasthaus that never got
 * fully tagged. Only ~3 per region, but they're exactly the village inns that
 * are useful on a hut-to-hut route.
 */
function isRestaurantWithRooms(tags: Record<string, string>): boolean {
  if (tags.amenity !== 'restaurant') return false;
  if (tags.accommodation === 'no') return false;
  return Boolean(tags.rooms || tags.accommodation || tags.beds);
}

/**
 * A named building mapped as a hotel/guest house but carrying NO `tourism` tag.
 *
 * Common where someone drew the building and typed the name but never added the
 * POI tags. Both places reported missing on Obere Gletscherstrasse in Grindelwald
 * are exactly this: Hotel Wetterhorn (no. 159) has `building=hotel` and nothing
 * else, and Blümlisalp (no. 145) has `building=hotel` + `amenity=restaurant`.
 * Requires a name, and is still elevation-gated like other generic lodging.
 */
const LODGING_BUILDING = new Set(['hotel', 'guest_house', 'hostel']);
function isNamedLodgingBuilding(tags: Record<string, string>): boolean {
  return Boolean(tags.building && LODGING_BUILDING.has(tags.building));
}

/**
 * A generic hotel/guest_house/hostel (or restaurant with rooms) whose inclusion
 * depends on elevation (mountain vs valley). Must be named and not a junk POI.
 */
function isElevationGatedLodging(tags: Record<string, string>): boolean {
  const name = tags.name?.trim();
  if (!name) return false;
  if (isNonLodgingPoi(tags)) return false;
  // "Piscina Hotel Union" and "Wellnessbereich Hotel Jagdhof" inherit the parent
  // hotel's `tourism`/`building` tag, so only the name gives them away.
  if (isSubFeatureName(name)) return false;
  if (tags.amenity && NON_LODGING_AMENITY.has(tags.amenity)) return false;
  // ⚠️ The holiday-rental exclusion must NOT veto a genuine refuge. It rejects
  // names starting "Chalet…", which is right for a Swiss holiday let but wrong in
  // France, where staffed huts are routinely "Chalet-refuge de …" and
  // "Chalet-hôtel …". A refuge-ish name wins.
  if (HOLIDAY_RENTAL_RE.test(name) && !MOUNTAIN_REFUGE_NAME_RE.test(name)) {
    return false;
  }
  return (
    MOUNTAIN_LODGING_TOURISM.has(tags.tourism) ||
    isRestaurantWithRooms(tags) ||
    isNamedLodgingBuilding(tags)
  );
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

const shelterTypes = 'basic_hut|weather_shelter|lean_to|rock_shelter|alpine_hut';
// Name keywords for mountain inns/huts NOT already tagged tourism=alpine_hut:
// German/Swiss (Berghaus…) + Italian (Rifugio/Capanna/Agriturismo, for the
// Italian regions). Kept in sync with GUESTHOUSE_NAME_RE.
const guestNames =
  'Berghaus|Berggasthaus|Berggasthof|Berghotel|Naturfreundeh|Alpengasthaus|Golderli|Rifugio|Capanna|Agriturismo|' +
  // France / Spain / Portugal / Austria+Germany additions — see
  // GUESTHOUSE_NAME_RE. Note the Overpass regex is applied case-insensitively
  // (`,i`), and accented forms are listed explicitly because Overpass regex has
  // no Unicode case folding.
  'Refuge|Refugi|Refugio|Refúgio|Gîte|Gite|Albergue|Abrigo|Schutzhaus|Berghütte|Alpengasthof|'+
  // Slovenia: 'koča' / 'planinski dom' are the standard hut words.
  'Koča|Koca|Planinski dom|Zavetišče|Zavetisce';

const bboxStr = (b: BBox) => `${b.south},${b.west},${b.north},${b.east}`;

/**
 * The primary query: ONLY huts and bivouac shelters — pure tag lookups that
 * Overpass answers fast. This is all the user thinks of as "huts" (green/brown/
 * blue pins) and it runs first and alone, so it's never throttled behind the
 * heavier accommodation query.
 */
function buildCoreQuery(box: BBox): string {
  const bbox = bboxStr(box);
  return `[out:json][timeout:60];
(
  node["tourism"="alpine_hut"](${bbox});
  way["tourism"="alpine_hut"](${bbox});
  node["tourism"="wilderness_hut"](${bbox});
  way["tourism"="wilderness_hut"](${bbox});
  node["amenity"="shelter"]["shelter_type"~"^(${shelterTypes})$"](${bbox});
  way["amenity"="shelter"]["shelter_type"~"^(${shelterTypes})$"](${bbox});
);
out center tags;`;
}

/**
 * The background query: named guesthouses (Berghaus/Rifugio/…) plus every
 * hotel/guest_house/hostel. Kept ones become purple pins. Runs only after the
 * core query so the two never compete for Overpass, and is non-fatal.
 */
function buildAccommodationsQuery(box: BBox): string {
  const bbox = bboxStr(box);
  // ⚠️ `timeout:180`, not 90. This is the heaviest query (an unanchored name
  // regex over every node and way in the box), and on the largest region —
  // Piedmont Alps, a full 1° × 1° — it exceeded 90 s and the server aborted it
  // on all 12 retries across two runs while every other region succeeded.
  //
  // The restaurant clauses use node/way rather than `nwr`: relation-mapped
  // restaurants are vanishingly rare, and scanning relations as well was enough
  // extra work to tip that same region over its limit.
  //
  // NB: comments inside the template literal below must not contain backticks —
  // one would close the string and turn the query into JavaScript.
  return `[out:json][timeout:180];
(
  node["name"~"${guestNames}",i](${bbox});
  way["name"~"${guestNames}",i](${bbox});
  node["tourism"~"^(hotel|guest_house|hostel)$"](${bbox});
  way["tourism"~"^(hotel|guest_house|hostel)$"](${bbox});
  // Restaurants that also let rooms but never got a tourism tag — see
  // isRestaurantWithRooms. (Combos WITH a tourism tag already match above.)
  node["amenity"="restaurant"]["name"]["rooms"](${bbox});
  way["amenity"="restaurant"]["name"]["rooms"](${bbox});
  node["amenity"="restaurant"]["name"]["accommodation"](${bbox});
  way["amenity"="restaurant"]["name"]["accommodation"](${bbox});
  // Named buildings mapped as lodging but with no tourism POI tag — see
  // isNamedLodgingBuilding.
  way["building"~"^(hotel|guest_house|hostel)$"]["name"](${bbox});
);
out center tags;`;
}

function parseElevation(raw?: string): number | undefined {
  if (!raw) return undefined;
  // `ele` is usually a plain number but can carry a unit ("2540 m").
  const value = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

function coordOf(el: OverpassElement): { lat: number; lon: number } | null {
  const c = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
  return c && c.lat != null && c.lon != null
    ? { lat: c.lat, lon: c.lon }
    : null;
}

/** Classify the categories we can decide from tags alone (no elevation lookup). */
function classifyFromTags(tags: Record<string, string>): HutType | null {
  if (tags.tourism === 'alpine_hut') return 'alpine_hut';
  if (tags.tourism === 'wilderness_hut') return 'wilderness_hut';
  // Shelters you can't sleep in (weather shelter, lean-to, rock overhang) aren't
  // hut-to-hut stops. Rejected at the source so regenerated bundles are clean;
  // `useHuts` applies the same predicate at runtime for the shipped bundle.
  if (tags.amenity === 'shelter') {
    return isOvernightCapable({ name: tags.name, tags }) ? 'shelter' : null;
  }
  if (isNamedGuesthouse(tags)) return 'guesthouse';
  return null;
}

function buildHut(el: OverpassElement, type: HutType, resolvedEle?: number): Hut {
  const tags = el.tags ?? {};
  const coord = coordOf(el)!;
  return {
    id: `${el.type}/${el.id}`,
    // Nameless in OSM: describe it from `shelter_type` rather than calling
    // everything "Unnamed shelter" (see `unnamedHutLabel`). `useHuts` applies the
    // same mapping at runtime, which is what fixes already-shipped bundles.
    name: tags.name?.trim() || unnamedHutLabel(type, tags),
    lat: coord.lat,
    lon: coord.lon,
    elevation: parseElevation(tags.ele) ?? resolvedEle,
    type,
    image: tags.image,
    wikimediaCommons: tags.wikimedia_commons,
    website: tags.website || tags['contact:website'] || tags.url || undefined,
    reservationWebsite: tags['reservation:website'] || undefined,
    wikidata: tags.wikidata || undefined,
    wikipedia: tags.wikipedia || undefined,
    bookingUrl: BOOKING_URL,
    tags,
  };
}

/** Abort after `ms`, or when the parent signal aborts, whichever comes first. */
function withTimeout(ms: number, parent?: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const relay = () => {
    clearTimeout(timer);
    ctrl.abort();
  };
  if (parent) {
    if (parent.aborted) relay();
    else parent.addEventListener('abort', relay);
  }
  return ctrl.signal;
}

/**
 * Caps how many Overpass requests are in flight at once, across every region's
 * core/accommodations/villages queries. Verified live: firing requests at the
 * public mirrors back-to-back starts returning 429 (rate limited) and 504
 * (timeout under load) after only a handful — and with 14 regions now loading
 * in parallel (up from the original 4), `useQueries` would otherwise fire
 * dozens of simultaneous requests at just two shared mirrors. Extra calls queue
 * FIFO and start as slots free up rather than all firing at once; the first
 * couple of regions still resolve fast (see `useHuts`'s lenient loading), the
 * rest stream in as their turn comes up.
 */
const MAX_CONCURRENT_OVERPASS = 2;
let activeOverpassCalls = 0;

/** Waiters, released FIFO as slots free up. */
const overpassWaitQueue: (() => void)[] = [];

/** Dispatch as many queued requests as the concurrency cap allows. */
function drainOverpassQueue(): void {
  while (
    activeOverpassCalls < MAX_CONCURRENT_OVERPASS &&
    overpassWaitQueue.length > 0
  ) {
    const resolve = overpassWaitQueue.shift()!;
    activeOverpassCalls++;
    resolve();
  }
}

function acquireOverpassSlot(): Promise<void> {
  return new Promise((resolve) => {
    overpassWaitQueue.push(resolve);
    drainOverpassQueue();
  });
}

function releaseOverpassSlot(): void {
  activeOverpassCalls--;
  drainOverpassQueue();
}

async function runOverpass(
  query: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<OverpassElement[]> {
  await acquireOverpassSlot();
  try {
    return await runOverpassNow(query, signal, timeoutMs);
  } finally {
    releaseOverpassSlot();
  }
}

async function runOverpassNow(
  query: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<OverpassElement[]> {
  const body = `data=${encodeURIComponent(query)}`;
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body,
        // Per-endpoint timeout so a hung mirror falls through to the next one
        // instead of leaving the map spinning forever.
        signal: withTimeout(timeoutMs, signal),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status} at ${endpoint}`);
      return ((await res.json()) as OverpassResponse).elements;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  // Every mirror failed — surface something actionable rather than the raw
  // "Aborted" that the timeout's AbortController produces.
  const detail =
    lastError instanceof Error && lastError.name !== 'AbortError'
      ? lastError.message
      : `no response within ${Math.round(timeoutMs / 1000)}s`;
  throw new Error(
    `Couldn't reach Overpass (tried ${OVERPASS_ENDPOINTS.length} mirrors): ${detail}`,
  );
}

/**
 * Fast core huts: staffed/unstaffed huts, bivouac shelters, name-matched
 * guesthouses and ele-tagged mountain hotels — everything decidable without an
 * elevation lookup. Throws if Overpass is unreachable (so react-query shows a
 * retry). This is what makes the map appear quickly.
 */
export async function fetchCoreHuts(
  box: BBox,
  signal?: AbortSignal,
): Promise<Hut[]> {
  // Short timeout: this is the blocking query, so fail fast to a retry rather
  // than leave the map spinning.
  const elements = await runOverpass(buildCoreQuery(box), signal, 30000);
  const huts: Hut[] = [];

  for (const el of elements) {
    if (!coordOf(el)) continue;
    const tags = el.tags ?? {};

    const type = classifyFromTags(tags);
    if (type) {
      huts.push(buildHut(el, type));
      continue;
    }
    if (isElevationGatedLodging(tags)) {
      const ele = parseElevation(tags.ele);
      if (ele != null && ele >= MOUNTAIN_ELE_MIN) {
        huts.push(buildHut(el, 'guesthouse'));
      }
    }
  }

  const byId = new Map(huts.map((h) => [h.id, h]));
  return Array.from(byId.values());
}

/**
 * Background accommodations: named guesthouses (kept by name) plus generic
 * hotels/guest_houses/hostels kept only at ≥ 1200 m — using the OSM `ele` tag
 * when present, else a DEM lookup. Runs after the core huts (sequenced in
 * useHuts) and returns an empty list on any failure — never blocks the map.
 */
export async function fetchAccommodations(
  box: BBox,
  signal?: AbortSignal,
): Promise<Hut[]> {
  const elements = await runOverpass(
    buildAccommodationsQuery(box),
    signal,
    // Must exceed the query's own `timeout:180`, or we'd abort client-side just
    // before the server was going to answer.
    200000,
  );

  const huts: Hut[] = [];
  const pending: OverpassElement[] = []; // lodging awaiting a DEM elevation

  for (const el of elements) {
    if (!coordOf(el)) continue;
    const tags = el.tags ?? {};

    const type = classifyFromTags(tags);
    if (type) {
      huts.push(buildHut(el, type)); // named guesthouse (or a named hut/shelter)
      continue;
    }
    if (isElevationGatedLodging(tags)) {
      const ele = parseElevation(tags.ele);
      if (ele != null) {
        if (ele >= MOUNTAIN_ELE_MIN) huts.push(buildHut(el, 'guesthouse'));
      } else {
        pending.push(el);
      }
    }
  }

  if (pending.length > 0) {
    // Reuse anything we've already resolved (see `setElevationCache`). Elevation
    // of a fixed building never changes, so re-asking is pure waste — and the
    // DEM has a DAILY quota that `building=hotel` matches (which almost never
    // carry an `ele` tag) can exhaust on their own.
    const cached = pending.map((el) => elevationCache?.get(`${el.type}/${el.id}`));
    const misses = pending.filter((_, i) => cached[i] == null);

    let fetched: (number | null)[] = [];
    if (misses.length > 0) {
      // Bank each batch into the persistent cache AS IT ARRIVES, not after the
      // whole call. A quota error on a later batch aborts `fetchElevations`, and
      // anything recorded only afterwards would be lost — see the note on
      // `onBatch`. This is what lets a heavy region finish across several runs
      // instead of restarting from zero every time.
      const bank = (offset: number, resolved: (number | null)[]) => {
        resolved.forEach((v, j) => {
          const el = misses[offset + j];
          if (v != null && el) elevationCache?.set(`${el.type}/${el.id}`, v);
        });
      };
      try {
        fetched = await fetchElevations(
          misses.map((el) => coordOf(el)!),
          signal,
          bank,
        );
      } catch (err) {
        if (signal?.aborted) throw err;
        // A quota error must reach the caller, not be flattened into nulls —
        // otherwise the ratio guard below reports a thinned result instead of
        // the real cause.
        if (err instanceof Error && err.message.startsWith('ELEVATION_QUOTA')) {
          throw err;
        }
        fetched = [];
      }
      // Remember what we learned, so a later run (or region overlap) is free.
      misses.forEach((el, i) => {
        const v = fetched[i];
        if (v != null) elevationCache?.set(`${el.type}/${el.id}`, v);
      });
    }

    // Stitch cache hits and fresh lookups back into `pending` order.
    let missIdx = 0;
    const elevations: (number | null)[] = pending.map((_, i) =>
      cached[i] != null ? cached[i]! : (fetched[missIdx++] ?? null),
    );

    // ⚠️ THROW rather than silently keep what resolved.
    //
    // An unresolved elevation is not neutral: these places are kept only if we
    // can show they're high enough, so every failed lookup silently DELETES a
    // real hotel. That turns a transient outage into quiet data loss, and it bit
    // twice on 2026-07-28 — first a flaky batch that cost 67 hotels in Julian &
    // Carnic, then Open-Meteo's DAILY quota running out mid-regeneration, which
    // cut Valais West from 337 places to 22. Both looked like plausible OSM
    // churn in the output; neither was.
    //
    // Failing loudly instead hands the problem to the generator's retry/PARTIAL
    // machinery, which already refuses to overwrite good data with a bad run.
    const unresolved = elevations.filter((e) => e == null).length;
    const missingRatio = pending.length ? unresolved / pending.length : 0;
    if (missingRatio > MAX_UNRESOLVED_ELEVATION_RATIO) {
      throw new Error(
        `Elevation lookup failed for ${unresolved}/${pending.length} places ` +
          `(${Math.round(missingRatio * 100)}%). Refusing to return a thinned ` +
          `result — check the elevation API (daily quota?) and retry.`,
      );
    }

    pending.forEach((el, i) => {
      const ele = elevations[i];
      if (ele != null && ele >= MOUNTAIN_ELE_MIN) {
        huts.push(buildHut(el, 'guesthouse', ele));
      }
    });
  }

  const byId = new Map(huts.map((h) => [h.id, h]));
  return Array.from(byId.values());
}

/**
 * Villages & towns in the area, as `village`-typed waypoints. Used by the route
 * generator as start points and as one-way end points (alpine villages have
 * postbus/rail access). Only fetched on the Plan screen.
 */
export async function fetchVillages(
  box: BBox,
  signal?: AbortSignal,
): Promise<Hut[]> {
  const bbox = bboxStr(box);
  // ⚠️ `city` matters as much as village/town. Without it Innsbruck — a stage on
  // two classic routes — was absent from the dataset entirely, and "Innsbruck"
  // silently resolved to the Innsbrucker Hütte, a hut in another massif. Any
  // route touching a city hit the same hole.
  const query = `[out:json][timeout:40];
(
  node["place"~"^(village|town|city)$"]["name"](${bbox});
);
out center tags;`;

  const elements = await runOverpass(query, signal, 30000);
  const villages: Hut[] = [];
  for (const el of elements) {
    const coord = coordOf(el);
    const tags = el.tags ?? {};
    if (!coord || !tags.name) continue;
    villages.push({
      id: `${el.type}/${el.id}`,
      name: tags.name.trim(),
      lat: coord.lat,
      lon: coord.lon,
      elevation: parseElevation(tags.ele),
      type: 'village',
      bookingUrl: BOOKING_URL,
      tags,
    });
  }
  const byId = new Map(villages.map((v) => [v.id, v]));
  return Array.from(byId.values());
}
