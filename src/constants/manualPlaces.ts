import type { Hut } from '../types/hut';

/**
 * Places we add BY HAND because OpenStreetMap does not carry them as lodging.
 *
 * ⚠️ This list is a liability and should stay tiny. Everything else in the app
 * comes from OSM, which means it self-corrects as OSM improves; a hand-entered
 * record never does, and it will silently go stale when the place closes,
 * renames or moves. Only add an entry after confirming the place genuinely is
 * not in OSM — searching by PROXIMITY to a verified coordinate, not by name,
 * because names differ by spelling, language and accent.
 *
 * A previous "it isn't in OSM" conclusion was wrong six times in a row for
 * exactly that reason. Twice the coordinate itself was wrong by several km,
 * which invalidates the whole check. Verify the coordinate first.
 *
 * `id` uses a `manual/` prefix so these are obvious in logs and can never
 * collide with an OSM id. Nothing parses the prefix except `placeScore`, which
 * only gives `node/` a small tiebreak, so a manual place simply doesn't get it.
 *
 * The generator merges these into the region's accommodations after fetching,
 * so they survive every regeneration.
 *
 * ⚠️ REMOVE AN ENTRY WHOSE REASON HAS GONE. `manual/steirischer-bodensee` was
 * dropped on 2026-09-14: it was added as "finish of the Schladminger Tauern
 * Höhenweg", and that turned out to be the wrong valley entirely — the stage
 * finishes at St. Nikolai im Sölktal, 17 km away. A hand-entered record whose
 * justification is false is the exact failure this list is meant to avoid.
 * Note that a removal only reaches the shipped data at the next
 * `npm run generate-huts`; until then the old pin stays in the region JSON.
 */
export interface ManualPlace extends Hut {
  /** Which region's bundle this belongs to — must actually contain the point. */
  regionId: string;
  /** Why this is hand-entered, so a later reader can re-check it. */
  why: string;
}

export const MANUAL_PLACES: ManualPlace[] = [
  {
    id: 'manual/gwercherwirt',
    regionId: 'bavarian-alps-east',
    name: 'Gasthof Gwercherwirt',
    lat: 47.5186419,
    lon: 11.8971947,
    // No elevation: OSM has no `ele` here and inventing one would put a made-up
    // number in front of a walker. The app renders an unknown elevation fine,
    // and leg ascent comes from BRouter's profile, not from this field.
    type: 'guesthouse',
    // Same generic booking portal every OSM-sourced place gets.
    bookingUrl: 'https://www.hut-reservation.org/',
    tags: { name: 'Gasthof Gwercherwirt', tourism: 'guest_house', 'manual:source': 'user' },
    why:
      'The Adlerweg stage stop at Pinegg (Brandenberg). Confirmed absent from OSM ' +
      'lodging data: nothing at all within 2 km of 47.51864, 11.89719.',
  },
  {
    id: 'manual/montespluga',
    regionId: 'graubunden-engadin',
    name: 'Montespluga',
    lat: 46.4892155,
    lon: 9.3380926,
    type: 'village',
    bookingUrl: 'https://www.hut-reservation.org/',
    tags: { name: 'Montespluga', place: 'hamlet', 'manual:source': 'user' },
    why:
      'Via Spluga stage between Splügen and Campodolcino. Not missing from OSM — ' +
      'it is tagged `place=hamlet`, and `fetchVillages` deliberately queries only ' +
      'village|town|city. Adding `hamlet` would pull in thousands of pins across ' +
      'every region, so this one hamlet is entered by hand instead. Revisit if ' +
      'more hamlets turn out to be needed.',
  },
  {
    id: 'manual/putzentalalm',
    regionId: 'salzburg-dachstein',
    name: 'Putzentalalm',
    lat: 47.2747806,
    lon: 13.8573324,
    type: 'alpine_hut',
    bookingUrl: 'https://www.hut-reservation.org/',
    tags: { name: 'Putzentalalm', tourism: 'alpine_hut', 'manual:source': 'user' },
    why:
      'Schladminger Tauern Höhenweg stage 5 finish. OSM DOES map a building 70 m ' +
      'away — way/207774209 "Ringdorfer Hütte" — but under a different name, so ' +
      'neither a name search nor a proximity search identified it as this alm. ' +
      'Whether they are the same establishment is unverified, so this is entered ' +
      'separately rather than repointed at the neighbour.',
  },
  {
    id: 'manual/hochwurzenhuette',
    regionId: 'salzburg-dachstein',
    name: 'Hochwurzenhütte',
    lat: 47.3600978,
    lon: 13.6396505,
    // ~1850 m at the top of the Hochwurzen. Left unset rather than guessed.
    type: 'alpine_hut',
    bookingUrl: 'https://www.hut-reservation.org/',
    tags: { name: 'Hochwurzenhütte', tourism: 'alpine_hut', 'manual:source': 'user' },
    why:
      'Start of the Schladminger Tauern Höhenweg. Genuinely absent: nothing at ' +
      'all within 2 km except valley hotels 1.85 km away. Without it the route ' +
      'started at Appartements Hochwurzen (1088 m) — 760 m too low.',
  },
  {
    id: 'manual/gite-les-arias',
    regionId: 'ecrins',
    name: "Gîte Les Arias",
    lat: 44.8694378,
    lon: 6.0901785,
    type: 'guesthouse',
    bookingUrl: 'https://www.hut-reservation.org/',
    tags: { name: 'Gîte Les Arias', tourism: 'guest_house', 'manual:source': 'user' },
    why:
      'The GR54 stop at Désert-en-Valjouffrey. OSM has a DIFFERENT business 70 m ' +
      'away (Auberge de l’Éterlou, way/225165574) — close enough that routing ' +
      'would not care, but naming the wrong establishment would mislead.',
  },
];

/** Manual places belonging to one region. */
export function manualPlacesFor(regionId: string): Hut[] {
  return MANUAL_PLACES.filter((p) => p.regionId === regionId).map(
    ({ regionId: _r, why: _w, ...hut }) => hut,
  );
}
