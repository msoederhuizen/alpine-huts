import type { Ionicons } from '@expo/vector-icons';
import type { ImageRequireSource } from 'react-native';
import type { HutType } from '../types/hut';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Accommodation types a hut-to-hut stay/filter deals with. `village` is
 *  deliberately absent — villages are trip start/end points, not a category
 *  of overnight stay to plan for or filter pins by. */
export const ACCOM_TYPES: HutType[] = [
  'alpine_hut',
  'guesthouse',
  'wilderness_hut',
  'shelter',
];

/** Human-readable label for a hut category. */
export function hutTypeLabel(type: HutType): string {
  switch (type) {
    case 'wilderness_hut':
      return 'Wilderness hut';
    case 'shelter':
      return 'Bivouac / shelter';
    case 'guesthouse':
      return 'Mountain guesthouse';
    case 'village':
      return 'Village';
    case 'alpine_hut':
    default:
      return 'Alpine hut';
  }
}

/**
 * Short plural label, for the always-on filter chips over the map.
 *
 * The chip row shows all four accommodation types by default, so it sits over
 * the map permanently — `hutTypeLabel`'s "Mountain guesthouse" and "Bivouac /
 * shelter" would push it to three lines. Plural because a chip names a category
 * being shown, not one place.
 */
export function hutTypeShortLabel(type: HutType): string {
  switch (type) {
    case 'wilderness_hut':
      return 'Wilderness huts';
    case 'shelter':
      return 'Bivouacs';
    case 'guesthouse':
      return 'Guesthouses';
    case 'village':
      return 'Villages';
    case 'alpine_hut':
    default:
      return 'Alpine huts';
  }
}

/**
 * A descriptive label for a hut OSM never gave a `name`, derived from its
 * `shelter_type`. 585 of ~9 800 entries are unnamed, and calling them all
 * "Unnamed shelter" hid a real distinction: 36 are `basic_hut` — bivouacs, the
 * kind you'd plan a night around — while 175 are `weather_shelter` and 174 are
 * `lean_to`, which you'd only duck into during a storm.
 *
 * Derived from tags rather than looked up: only 6 of the 585 carry ANY name-ish
 * tag (no `alt_name`, `operator` or `ref`), so there is no better name hiding in
 * the data to recover.
 */
export function unnamedHutLabel(
  type: HutType,
  tags: Record<string, string> = {},
): string {
  switch (tags.shelter_type) {
    case 'basic_hut':
      return 'Bivouac';
    case 'weather_shelter':
      return 'Weather shelter';
    case 'lean_to':
      return 'Lean-to shelter';
    case 'rock_shelter':
      return 'Rock shelter';
    case 'public_transport':
      return 'Transport shelter';
    case 'picnic_shelter':
      return 'Picnic shelter';
  }
  if (type === 'wilderness_hut') return 'Wilderness hut';
  if (type === 'alpine_hut') return 'Alpine hut';
  if (type === 'shelter') return 'Shelter';
  return 'Unnamed hut';
}

/** Whether a hut's name is one of the generic fallbacks rather than a real
 *  name — i.e. it's a candidate for locality disambiguation. */
export function isFallbackHutName(name: string): boolean {
  return /^(Unnamed (shelter|hut)|Bivouac|Weather shelter|Lean-to shelter|Rock shelter|Transport shelter|Picnic shelter|Shelter|Wilderness hut|Alpine hut)$/.test(
    name.trim(),
  );
}

/**
 * Names that mark a genuine staffed-or-sleepable mountain refuge, in the
 * languages of the Alpine arc. Used only ever to PROTECT a place from being
 * filtered out — never to pull new places in — so it can be generous.
 *
 * It exists because OSM tagging on small mountain buildings is unreliable:
 * "Capanna Damiano Marinelli" (a real CAI refuge) and "Bivacco Agostino
 * Parravicini" are both tagged `shelter_type=weather_shelter`. Trusting the tag
 * alone would delete them.
 */
export const MOUNTAIN_REFUGE_NAME_RE =
  /(berghaus|berggasthaus|berggasthof|berghotel|naturfreundeh|alpengasthaus|rifugio|capanna|agriturismo|h(ü|ue)tte|baita|malga|schutzhaus|ostello|bivacco|biwak|bivouac|casera|chamanna|cabane|refuge|refugi|refugio|refúgio|gîte|gite|albergue|abrigo|alberg|koča|koca|planinski dom|zavetišče|zavetisce|turisthytte|fjellstue|fjellstove|hytte|hytta|fjällstation|fjallstation|fjällstuga|fjallstuga|stugor)/i;

/**
 * The NARROWER subset: names that mean "this is a high mountain refuge", used to
 * exempt a place from the village-crowding filter.
 *
 * Deliberately smaller than {@link MOUNTAIN_REFUGE_NAME_RE}, and the distinction
 * matters. That one is generous on purpose — it only ever prevents deleting
 * something, so over-including is safe there. This one is a licence to sit in a
 * village high street and still be shown, which over-including gets wrong:
 * Naturfreundehaus Grindelwald has 33 accommodations within a kilometre and is
 * squarely in the village, yet `naturfreundeh` was rescuing it.
 *
 * The test for membership: would this kind of place legitimately cluster with
 * others at a genuine mountain location — a pass, a trailhead, a hut group? A
 * rifugio at Tre Cime, yes. An association guesthouse, hostel (`ostello`,
 * `albergue`), `gîte d'étape`, `agriturismo` or resort `Berghotel`, no — those
 * live in villages, and if one really is isolated it passes the neighbour test on
 * its own without needing an exemption.
 */
export const HIGH_REFUGE_NAME_RE =
  /(berghaus|berggasthaus|berggasthof|alpengasthaus|alpengasthof|berghütte|schutzhaus|rifugio|capanna|baita|malga|casera|bivacco|biwak|bivouac|cabane|chamanna|refuge|refugi|refugio|refúgio|abrigo|koča|koca|planinski dom|zavetišče|zavetisce|h(ü|ue)tte)/i;

/**
 * `shelter_type` values you cannot sleep in — a roof to wait out weather under,
 * not a place to plan a night around. Excluded from the map entirely.
 */
const NON_OVERNIGHT_SHELTER_TYPES = new Set([
  'weather_shelter',
  'lean_to',
  'rock_shelter',
  'public_transport',
  'picnic_shelter',
  'gazebo',
]);

/**
 * Whether somewhere is worth showing as a place to stay. False only for shelters
 * explicitly tagged as a non-overnight type AND lacking a refuge name — the name
 * check rescues the mis-tagged real huts described on
 * {@link MOUNTAIN_REFUGE_NAME_RE}.
 *
 * Shelters with NO `shelter_type` at all are kept: absence of a tag isn't
 * evidence you can't sleep there.
 */
export function isOvernightCapable(hut: {
  name?: string;
  tags?: Record<string, string>;
}): boolean {
  const shelterType = hut.tags?.shelter_type;
  if (!shelterType || !NON_OVERNIGHT_SHELTER_TYPES.has(shelterType)) return true;
  return MOUNTAIN_REFUGE_NAME_RE.test(hut.name ?? '');
}

/** Map-pin colour per hut category. */
export function hutPinColor(type: HutType): string {
  switch (type) {
    case 'wilderness_hut':
      return '#8a6d3b';
    case 'shelter':
      return '#4a72b0';
    case 'guesthouse':
      return '#8e44ad';
    case 'village':
      return '#555555';
    case 'alpine_hut':
    default:
      return '#2f6f4f';
  }
}

/** Map-pin icon per category — a staffed hut, a basic unstaffed hut, a
 *  bivouac/shelter, and a hotel/guesthouse all read differently at a glance,
 *  instead of one generic pin shape in different colours. */
export function hutPinIcon(type: HutType): IoniconName {
  switch (type) {
    case 'wilderness_hut':
      return 'home-outline'; // basic/unstaffed — outline reads "simpler"
    case 'shelter':
      return 'triangle'; // bivouac — a basic A-frame silhouette
    case 'guesthouse':
      return 'bed'; // hotel / mountain guesthouse
    case 'village':
      return 'location';
    case 'alpine_hut':
    default:
      return 'home'; // staffed hut
  }
}

/**
 * Pre-rasterized pin badges (colour + icon + tail, baked into a PNG by
 * `scripts/generate-pin-icons.cjs`) — used as `<Marker image={...}>` so
 * react-native-maps draws a native image annotation instead of snapshotting a
 * live custom View per pin. That per-pin view/snapshot machinery is what made
 * hundreds of on-screen pins slow; a `require()`'d image has none of it.
 *
 * ⚠️ If `hutPinColor`/`hutPinIcon` above ever change, regenerate the PNGs with
 * `node scripts/generate-pin-icons.cjs` (it mirrors those two functions by
 * hand — it doesn't call them, since it runs standalone in Node, outside RN).
 */
export function hutPinImage(type: HutType): ImageRequireSource {
  switch (type) {
    case 'wilderness_hut':
      return require('../../assets/pins/pin-wilderness_hut.png');
    case 'shelter':
      return require('../../assets/pins/pin-shelter.png');
    case 'guesthouse':
      return require('../../assets/pins/pin-guesthouse.png');
    case 'village':
      return require('../../assets/pins/pin-village.png');
    case 'alpine_hut':
    default:
      return require('../../assets/pins/pin-alpine_hut.png');
  }
}

/** Where the pin's tail-tip (the actual coordinate) sits within `hutPinImage`'s
 *  padded canvas — NOT {x:0.5,y:1}, because the generator adds a transparent
 *  margin around the badge for the drop shadow. Keep in sync with the
 *  generator's own `ANCHOR_X`/`ANCHOR_Y` if the badge/shadow ever change. */
export const HUT_PIN_ANCHOR = { x: 0.5, y: 0.9167 };
