/**
 * Collapsing places that OSM maps more than once, and hiding village pins that
 * sit underneath a hut pin.
 *
 * WHY BOTH LIVE HERE: they're the two halves of one user-visible bug — "the pin
 * changes its icon when I zoom in". Neither is a rendering fault. In both cases
 * there are genuinely TWO markers a few metres apart with different types, and
 * which one MapKit draws changes with zoom (it suppresses lower display-priority
 * annotations that overlap a higher one). At 20 m apart that reads as a single
 * pin mutating, not as two pins.
 *
 * Measured in the shipped bundle, per region:
 *   - 8–13 guesthouses within 40 m of a village node
 *     ("Hotel Restaurant Stechelberg" 24 m from village "Stechelberg")
 *   - up to 21 hut↔hut pairs within 25 m carrying DIFFERENT types
 *     ("Rifugio Col Alt" mapped as both alpine_hut and guesthouse, 11 m apart)
 */
import type { Hut } from '../types/hut';

/** Two elements this close, with matching names, are one place mapped twice. */
const DUP_RADIUS_M = 60;
/** An element with no `name` this close to a named one is that place's building
 *  outline or POI node — not a second hut. Tighter, because two genuinely
 *  distinct unnamed shelters can legitimately stand near each other. */
const UNNAMED_RADIUS_M = 30;
/**
 * Spatial bucket size, in degrees, for both axes.
 *
 * Must exceed the search radius in METRES on both axes, since we only scan the
 * 3×3 neighbourhood. 0.002° is ~222 m of latitude everywhere, and ~150 m of
 * longitude at 46°N falling to ~111 m at 60°N — comfortably above 60 m even if
 * a Nordic region is ever added.
 */
const CELL_DEG = 0.002;

const M_PER_DEG_LAT = 111_320;

/** Equirectangular metres — exact enough at the tens of metres this module deals
 *  in, and much cheaper than haversine across an O(n·9) scan. */
export function metresBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dy = (aLat - bLat) * M_PER_DEG_LAT;
  const dx =
    (aLon - bLon) * M_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/**
 * Names reduced to comparable form: accents stripped, punctuation flattened to
 * single spaces, lowercased.
 *
 * The previous collapse compared raw lowercased names, so
 * "Plattkofelhütte - Rifugio Sasso Piatto" and "Plattkofelhütte Rifugio Sasso
 * Piatto" — the same refuge — did not match on a hyphen.
 */
export function normalizePlaceName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining accents left by NFD
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Levenshtein distance, but it stops as soon as it exceeds `max`. Only ever
 *  called with max = 1, so this is a couple of comparisons in practice. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

/** Words too short to identify anything on their own. */
const MIN_TOKEN_LEN = 3;

/**
 * Lodging words that name a BUILDING KIND, not a place, across the languages of
 * the regions we cover. A name that reduces to nothing but these identifies
 * nothing, so it may never match a longer name on its own — that's what keeps
 * "ex rifugio" (a ruin) from being absorbed into "Rifugio Passo delle Selle"
 * 22 m away.
 */
const GENERIC_LODGING_WORDS = new Set([
  'rifugio', 'refuge', 'refugi', 'refugio', 'refuge', 'hotel', 'hostel',
  'gasthaus', 'gasthof', 'berggasthaus', 'berghaus', 'berghotel', 'haus',
  'hutte', 'huette', 'huetten', 'capanna', 'cabane', 'albergo', 'baita',
  'chalet', 'pension', 'herberge', 'casa', 'maison', 'alm', 'alpe', 'locale',
  'bivacco', 'biwak', 'bivouac', 'shelter', 'unterkunft', 'ostello', 'koca',
  'dom', 'restaurant', 'camping', 'garni', 'auberge', 'gite', 'abrigo',
]);

/** A single word may stand for a whole place only if it's distinctive: long
 *  enough to be a proper name, and not merely the kind of building. */
function isDistinctiveToken(t: string): boolean {
  return t.length >= 5 && !GENERIC_LODGING_WORDS.has(t);
}

/**
 * The words in a name that could identify the place on their own — "Lagazuoi"
 * from "Rifugio Lagazuoi", nothing at all from a bare "Rifugio".
 *
 * Exported for the Flickr photo search (`src/api/flickr.ts`), which has the same
 * problem this file was written for: deciding whether two bits of text refer to
 * the same place. A hut whose name yields no distinctive token cannot be
 * verified against a photo caption, so that search declines to guess.
 */
export function distinctiveTokens(normalized: string): string[] {
  return normalized.split(' ').filter(isDistinctiveToken);
}

/** True when `text` names the place — every distinctive word of the name
 *  appears in it, allowing one typo per word, as `sameNamedPlace` does. */
export function textNamesPlace(text: string, nameTokens: string[]): boolean {
  if (!nameTokens.length) return false;
  const words = text.split(' ').filter((t) => t.length >= MIN_TOKEN_LEN);
  if (!words.length) return false;
  return nameTokens.every((t) => words.some((w) => withinEdits(t, w, 1)));
}

/**
 * Whether two normalized names denote the same place.
 *
 * Token containment rather than substring containment, tolerating one typo per
 * word: "Ütia de Scotoni - Scotoni-Hütte - Rifugio Scotoni" and "Rifugio
 * Scottoni" are the same Dolomites refuge 20 m apart, differing by a doubled t
 * and by carrying three language variants in one name. Substring matching can't
 * see through either.
 *
 * A one-word name counts only when the word is DISTINCTIVE — "Oberaar" matches
 * "Berghaus Oberaar", and "Turrahus" matches "Berggasthaus Turrahus", since a
 * generic prefix is exactly how the same building gets two OSM names. But "ex
 * rifugio" (a ruin beside Rifugio Passo delle Selle) reduces to the building
 * kind alone and is left as its own pin.
 *
 * Distance is doing most of the safety work here — two genuinely different
 * refuges essentially never stand within `DUP_RADIUS_M` of each other. What the
 * name test really guards against is merging a hut with the DIFFERENT thing next
 * to it: its winter room, an emergency bivouac, a ruin.
 */
function sameNamedPlace(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const tokens = (s: string) =>
    s.split(' ').filter((t) => t.length >= MIN_TOKEN_LEN);
  const ta = tokens(a);
  const tb = tokens(b);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length === 0) return false;
  if (short.length === 1 && !isDistinctiveToken(short[0])) return false;

  return short.every((t) => long.some((u) => withinEdits(t, u, 1)));
}

function cellKey(lat: number, lon: number, dLat: number, dLon: number): string {
  return `${Math.floor(lat / CELL_DEG) + dLat},${Math.floor(lon / CELL_DEG) + dLon}`;
}

/**
 * Keep one Hut per physical place, preferring whichever `scoreOf` rates highest.
 *
 * Replaces a grid-cell+exact-name grouping that missed most real duplicates for
 * two reasons: a cell is not a distance (two elements 11 m apart routinely land
 * either side of a boundary and were never compared), and exact string equality
 * fails on trivial punctuation differences. This compares actual metres against
 * the 3×3 neighbourhood, so there is no boundary to fall across.
 *
 * ⚠️ Unnamed elements are NEVER collapsed into each other — only into a named
 * neighbour. Two distinct unnamed bivouacs must both survive.
 */
export function collapseDuplicatePlaces(
  huts: Hut[],
  scoreOf: (h: Hut) => number,
): Hut[] {
  const kept = new Map<string, Hut>(); // hut id -> hut
  const grid = new Map<string, string[]>(); // cell -> kept hut ids

  const index = (h: Hut) => {
    const k = cellKey(h.lat, h.lon, 0, 0);
    const bucket = grid.get(k);
    if (bucket) bucket.push(h.id);
    else grid.set(k, [h.id]);
  };
  const unindex = (h: Hut) => {
    const k = cellKey(h.lat, h.lon, 0, 0);
    const bucket = grid.get(k);
    if (!bucket) return;
    const at = bucket.indexOf(h.id);
    if (at >= 0) bucket.splice(at, 1);
  };

  for (const h of huts) {
    const name = h.tags.name?.trim();
    const norm = name ? normalizePlaceName(name) : '';

    // Find an already-kept element that maps this same place.
    let duplicateOf: Hut | undefined;
    outer: for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        for (const id of grid.get(cellKey(h.lat, h.lon, dLat, dLon)) ?? []) {
          const other = kept.get(id);
          if (!other) continue;
          const otherName = other.tags.name?.trim();
          const m = metresBetween(h.lat, h.lon, other.lat, other.lon);
          const match =
            name && otherName
              ? m <= DUP_RADIUS_M &&
                sameNamedPlace(norm, normalizePlaceName(otherName))
              : // Exactly one of them is unnamed — never both (see the note above).
                !!(name || otherName) && m <= UNNAMED_RADIUS_M;
          if (match) {
            duplicateOf = other;
            break outer;
          }
        }
      }
    }

    if (!duplicateOf) {
      kept.set(h.id, h);
      index(h);
      continue;
    }
    // Same place: keep the more informative element, drop the other.
    if (scoreOf(h) > scoreOf(duplicateOf)) {
      kept.delete(duplicateOf.id);
      unindex(duplicateOf);
      kept.set(h.id, h);
      index(h);
    }
  }

  return Array.from(kept.values());
}

/**
 * Village ids that already have a hut pin drawn on top of them.
 *
 * The hut wins, deliberately: it's the pin that is ALREADY visible below
 * `VILLAGE_MIN_ZOOM`, so suppressing the village is what makes zooming in leave
 * the marker alone. Letting the village win would swap the icon at z12 — exactly
 * the bug. Nothing is lost for routing: the guesthouse standing at the village
 * centre can be added as a stop just as a village can.
 *
 * ⚠️ MUST be computed from the full hut list, never from what is currently
 * on-screen. Deciding this per viewport or per zoom would make a village
 * reappear as you pan, reintroducing the flicker in a new form.
 */
export function villagesShadowedByHut(
  villages: Hut[],
  huts: Hut[],
  radiusM: number = DUP_RADIUS_M,
): Set<string> {
  const grid = new Map<string, Hut[]>();
  for (const h of huts) {
    const k = cellKey(h.lat, h.lon, 0, 0);
    const bucket = grid.get(k);
    if (bucket) bucket.push(h);
    else grid.set(k, [h]);
  }

  const shadowed = new Set<string>();
  for (const v of villages) {
    search: for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        for (const h of grid.get(cellKey(v.lat, v.lon, dLat, dLon)) ?? []) {
          if (metresBetween(v.lat, v.lon, h.lat, h.lon) <= radiusM) {
            shadowed.add(v.id);
            break search;
          }
        }
      }
    }
  }
  return shadowed;
}
