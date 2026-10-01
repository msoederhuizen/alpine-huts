/**
 * Hand-verified corrections, applied on top of OSM and both contact overlays.
 *
 * ⚠️ THIS IS FOR ERRORS NO RULE CAN CATCH, and it is the last word. The
 * importers match on POSITION and refuse to guess, which stops them attaching a
 * row to the wrong building — but it cannot help when the SOURCE ROW ITSELF is
 * wrong. The spreadsheet's "Loferer Alm" row carries the Schmidt-Zabierow
 * Hütte's website; matched to the nearest place 11 m away, which is the correct
 * place, it still produced a wrong link. Only a human who knows the hut can see
 * that, so only a human can fix it.
 *
 * ⚠️ IT IS A LIABILITY AND SHOULD STAY SMALL, for the same reason as
 * `manualPlaces.ts`: everything else self-corrects as OSM and the sources
 * improve, and a hand-entered value never does. Every entry carries the
 * evidence it was checked against, so a later reader can re-check it rather
 * than trust it.
 *
 * ⚠️ VERIFY BY POSITION, NEVER BY NAME. Each entry below was confirmed by
 * putting the app's coordinate and the operator's own map pin side by side —
 * that is how "Pension Enzian" turned out to be the Barmer Haus, 28 m apart,
 * and how the four Watzmann huts were confirmed to be four genuinely different
 * buildings rather than duplicates.
 *
 * Applied in `regionData()` in `src/data/hutBundle.ts`, the one place every
 * screen loads huts through, so nothing can read around them.
 */

export interface PlaceCorrection {
  /** For a reader skimming the list; not used for matching. */
  was: string;
  /** Replace the place's name. */
  name?: string;
  /** Replace the place's website. */
  website?: string;
  /**
   * Overlay/OSM fields to remove, because they describe a different business.
   * Names are the app's own: `website`, `phone`, `operator`, `warden`, `ele`,
   * `booking`, `dog`, `station`, `bus`, `car`.
   */
  drop?: string[];
  /** The evidence, so this can be re-checked rather than believed. */
  why: string;
}

export const PLACE_CORRECTIONS: Record<string, PlaceCorrection> = {
  'way/60054244': {
    was: 'Pension Enzian',
    name: 'Barmer Haus',
    why:
      'Not a wrong match — a stale OSM name. The operator\'s own pin for "Barmer Haus" ' +
      'sits 28 m from this building, and the dav-barmen.de website and Wuppertal ' +
      'telephone number the import added are the DAV Barmen section\'s, which owns it. ' +
      'So the data is right and only the name was wrong.',
  },

  'way/205215988': {
    was: 'Berghotel Haus Gertraud',
    drop: ['website', 'phone', 'ele'],
    why:
      'The spreadsheet\'s "Loferer Alm" row matched here at 11 m — the right place — but ' +
      'that row carries the Schmidt-Zabierow Hütte\'s website, telephone number and ' +
      '1966 m altitude. Every field it contributed describes a different hut, so all ' +
      'three are dropped rather than corrected; nothing here is a verified value.',
  },

  'node/2864099227': {
    was: 'Praxmarer',
    website: 'https://www.pension-praxmarer.at/',
    drop: ['phone'],
    why:
      'The Appartements Schmalzerhof row matched at 33 m. They are two different ' +
      'businesses (pension-praxmarer.at and appartements-schmalzerhof.at), so the ' +
      'website is replaced with Praxmarer\'s own and the telephone number, which came ' +
      'from the same row, is dropped.',
  },

  'way/139931718': {
    was: 'Berghotel Gasthof Gstrein',
    drop: ['phone', 'ele'],
    why:
      'The "Haus Eberhard" row matched at 55 m. Both are in Vent and both are real, but ' +
      'they are different houses (gstrein-vent.at and haus-eberhard.at). The website ' +
      'here was already OSM\'s and is correct; the telephone number and altitude came ' +
      'from the Haus Eberhard row and are dropped. Haus Eberhard itself is not in OSM.',
  },

  'way/92739248': {
    was: 'Alpenrose',
    website: 'https://alpenrose-sellrain.com/en/',
    why: 'OSM carries alpenrose-sellrain.at; the house\'s current site is the .com domain.',
  },

  // --- names: the source or the operator uses a better one than OSM ---------

  'way/619115930': {
    was: 'Birkkarhüttl',
    name: 'Birkkarspitze Biwak Hütte',
    why:
      'The operator\'s own pin 3 m away calls it this. OSM\'s "Birkkarhüttl" is the ' +
      'diminutive of the OLD hut, which is also what its Commons photo showed — see ' +
      'the photo blocklist.',
  },

  'way/125812029': {
    was: 'Tribulaunhaus',
    name: 'Tribulaunhütte',
    why:
      'Both the Alpenverein register and the spreadsheet call it a Tribulaunhütte, and ' +
      'tribulaunhuette.at — already its website — is the house\'s own domain. Note the ' +
      'Italian Tribulaunhütte (node/9917807792) is a DIFFERENT hut 2 km south; the two ' +
      'genuinely share a name.',
  },

  'way/122426014': {
    was: 'Fiegls Gasthaus auf der Windachalm',
    name: 'Fieglhütte',
    why: 'The Alpenverein register calls it Fieglhütte, matched at 1 m.',
  },

  'node/7823748585': {
    was: 'Bivacco della Pace',
    drop: ['website'],
    why:
      'Already correctly named. The import wrote a WIKIPEDIA ARTICLE as its website ' +
      '(de.wikipedia.org/wiki/Friedensbiwak) — an encyclopedia entry is not the hut\'s ' +
      'own site, and the app renders that field as "visit the website".',
  },

  'node/8018256030': {
    was: 'Radelsee-Haus - Rifugio Lago Rodella',
    website: 'https://www.radlseehuette.it/en_EN/home.html',
    why: 'The house\'s own English landing page, rather than the domain root.',
  },
};

/**
 * Places removed from the app entirely.
 *
 * ⚠️ A HIDE IS NOT A DELETE, and it has to be this way round. The region
 * bundles are regenerated from OSM, so an entry deleted from a bundle comes
 * straight back on the next `npm run generate-huts`. Hiding by id survives
 * regeneration and is reversible, which matters when the reason turns out to be
 * wrong — a closed hut sometimes reopens.
 */
export const HIDDEN_PLACES: Record<string, string> = {
  'way/124355190':
    'Landgut Hotel Plannerhof, Planneralm — closed. The business is now plannerinn.at ' +
    'and sits in the village, so it is not a hut-to-hut stop either way. Six other ' +
    'guesthouses within 300 m remain.',

  'way/181358061':
    'A second, unnamed "Alpine hut" 2 m from the Ignaz-Mattis-Hütte (node/417326836) — ' +
    'the same building mapped twice in OSM, which is the co-located-duplicate pattern ' +
    'that makes map pins appear to change icon on zoom. The named node is kept.',
};
