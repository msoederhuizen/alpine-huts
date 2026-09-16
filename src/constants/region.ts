import type { Region as MapRegion } from 'react-native-maps';

/** A bounding box in WGS84 degrees — the geographic scope of one hikeable
 *  mountain area. Everything (Overpass hut/village/lift queries, the map's
 *  initial camera) is derived from the currently-selected region's box. */
export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Region {
  /** Stable id, used in react-query keys + the persisted selection. */
  id: string;
  name: string;
  country: string;
  /** A short "where is it" hint shown under the name in the region picker, so
   *  people recognise the area (recognisable towns/peaks, `·`-separated). */
  blurb: string;
  bbox: BBox;
}

/**
 * Selectable mountain areas across Switzerland, Italy, France, Austria, Germany,
 * Spain and Portugal, while keeping each individual box to roughly the original
 * Bernese Oberland's size so its Overpass query stays fast: a single huge box
 * spanning multiple countries would time out and return an unmanageable pin
 * count.
 *
 * ⚠️ VERIFY GAPS WITH `npx tsx scripts/audit-coverage.ts` after any change here.
 * The tiling is currently gap-free, but that claim was wrong three times before
 * the audit existed — a hotel in Hasliberg turned out to sit ~420 m outside every
 * region, and adding the non-Alpine countries opened six more seams that the
 * audit caught. Boxes deliberately overlap at shared borders rather than risk a
 * sliver gap; overlapping huts are deduplicated by OSM id, so that's harmless.
 *
 * All OSM data (huts tagged `tourism=alpine_hut` etc.), BRouter routing and
 * Open-Meteo elevation are global, so every region gets every feature with no
 * special-casing. The one thing that IS language-specific is hut-name matching —
 * see `GUESTHOUSE_NAME_RE` in api/overpass.ts and `MOUNTAIN_REFUGE_NAME_RE` in
 * utils/hutMeta.ts, which need the local word for "hut" (refuge, refugio,
 * abrigo, koča, …) whenever a new language is added, or that country comes back
 * nearly empty of huts OSM didn't formally tag.
 *
 * No longer Alps-only: the Pyrenees, Cantabrians, Peneda-Gerês, Black Forest and
 * Pohorje are all in. The Jura and Apennines are still out — extend here if
 * wanted, then re-run the coverage audit.
 */
export const REGIONS: Region[] = [
  // --- Switzerland ---------------------------------------------------------
  {
    id: 'bernese-oberland',
    name: 'Bernese Oberland',
    country: 'Switzerland',
    blurb: 'Grindelwald · Jungfrau · Gstaad',
    // Widened west for Gstaad/Diablerets; north 46.75→46.82 to close a real
    // coverage GAP over Hasliberg/Brünig. Central Switzerland starts at lon 8.3
    // and this sits at ~8.17, so nothing covered it — Hotel Wetterhorn
    // (46.7538, 8.167) fell ~420 m outside every region and was invisible.
    // West 7.15→7.02 (2026-08-25): Château-d'Oex (46.4736, 7.1339) sat 1.2 km
    // outside EVERY region, which is why the Via Alpina could not reach its
    // published finish. Also picks up Rossinière and the Pays-d'Enhaut.
    bbox: { south: 46.35, west: 7.02, north: 46.82, east: 8.3 },
  },
  {
    id: 'valais-west',
    name: 'Valais West',
    country: 'Switzerland',
    blurb: 'Verbier · Grand St-Bernard · Martigny',
    bbox: { south: 45.85, west: 6.8, north: 46.46, east: 7.55 }, // Verbier, Grand St-Bernard, Martigny
  },
  {
    id: 'valais-east',
    name: 'Valais East',
    country: 'Switzerland',
    blurb: 'Zermatt · Saas-Fee · Goms',
    // South 45.95→45.83 closes a ~34 km² coverage gap over Val Formazza /
    // Antrona (Italian Ossola) that fell between this box, Ticino (west edge
    // 8.35) and Aosta (east edge 7.9). Found by scripts/audit-coverage.ts.
    bbox: { south: 45.83, west: 7.55, north: 46.55, east: 8.35 },
  },
  {
    id: 'ticino',
    name: 'Ticino',
    country: 'Switzerland',
    blurb: 'Locarno · Bellinzona · southern valleys',
    bbox: { south: 45.85, west: 8.35, north: 46.55, east: 9.3 },
  },
  {
    id: 'central-switzerland',
    name: 'Central Switzerland',
    country: 'Switzerland',
    blurb: 'Uri · Glarus · Titlis',
    bbox: { south: 46.55, west: 8.3, north: 47.05, east: 9.2 }, // Uri, Glarus, Titlis
  },
  {
    id: 'graubunden-north',
    name: 'Graubünden North',
    country: 'Switzerland',
    blurb: 'Davos · Prättigau · Appenzell',
    bbox: { south: 46.6, west: 9.0, north: 47.45, east: 9.95 }, // Prättigau, Davos, Surselva, Appenzell/Alpstein
  },
  {
    id: 'graubunden-engadin',
    name: 'Graubünden & Engadin',
    country: 'Switzerland',
    blurb: 'St. Moritz · Engadin · Bernina',
    // West 9.35→9.18 closes a ~309 km² coverage gap over Avers / Splügen /
    // upper Bregaglia, which fell between Ticino (east 9.3), Central
    // Switzerland (east 9.2) and Graubünden North (south 46.6).
    bbox: { south: 46.25, west: 9.18, north: 46.85, east: 10.4 },
  },
  // --- Italy -----------------------------------------------------------------
  {
    id: 'dolomites',
    name: 'Dolomites',
    country: 'Italy',
    blurb: 'Cortina · Bolzano · Sella',
    bbox: { south: 46.3, west: 10.9, north: 46.86, east: 12.35 }, // ~231 huts
  },
  {
    id: 'dolomiti-bellunesi',
    name: 'Pale di San Martino & Dolomiti Bellunesi',
    country: 'Italy',
    blurb: 'San Martino di Castrozza · Feltre · Belluno',
    // The southern Dolomites, below the main `dolomites` tile and east of
    // `trentino` — both of which stop short of it. Alta Via 2's whole second
    // half (Rosetta, Pradidali, Treviso, Boz, Dal Piaz, Feltre) and Alta Via 1's
    // finish (Pramperet, Bianchet, Belluno) live here and were in NO bbox at all.
    // Overlaps its neighbours on purpose so no stage falls through a seam.
    bbox: { south: 45.95, west: 11.5, north: 46.35, east: 12.5 },
  },
  {
    id: 'aosta-valley',
    name: 'Aosta Valley & Gran Paradiso',
    country: 'Italy',
    blurb: 'Gran Paradiso · Courmayeur · Cervinia',
    bbox: { south: 45.5, west: 6.85, north: 45.95, east: 7.9 }, // ~229 huts
  },
  {
    id: 'ortler-stelvio',
    name: 'Ortler & Stelvio',
    country: 'Italy',
    blurb: 'Stelvio · Bormio · Sulden',
    bbox: { south: 46.2, west: 10.35, north: 46.86, east: 10.95 }, // ~120 huts
  },
  {
    id: 'trentino',
    name: 'Trentino & Adamello-Brenta',
    country: 'Italy',
    blurb: 'Madonna di Campiglio · Brenta · Adamello',
    bbox: { south: 45.85, west: 10.4, north: 46.45, east: 11.55 }, // bridges Ortler-Stelvio and Dolomites
  },
  {
    id: 'lombardy-alps',
    name: 'Lombardy Alps',
    country: 'Italy',
    blurb: 'Valtellina · Bergamo Prealps · Orobie',
    bbox: { south: 45.75, west: 9.3, north: 46.35, east: 10.5 }, // Valtellina, Orobie/Bergamo Prealps
  },
  {
    id: 'julian-carnic-alps',
    name: 'Julian & Carnic Alps',
    country: 'Italy',
    blurb: 'Friuli · Tarvisio · east of the Dolomites',
    bbox: { south: 46.3, west: 12.35, north: 46.86, east: 13.5 }, // Friuli, east of the Dolomites
  },
  {
    id: 'piedmont-alps',
    name: 'Piedmont Alps',
    country: 'Italy',
    blurb: 'Monviso · Susa Valley · Cottian Alps',
    bbox: { south: 44.55, west: 6.6, north: 45.55, east: 7.6 }, // Cottian & Graian Alps, Monviso, Susa Valley
  },
  // --- France ----------------------------------------------------------------
  // Tiles kept to roughly the same span as the Swiss/Italian ones so each
  // Overpass query stays inside its timeout; the accommodations query is the
  // heavy one and a full 1°×1° box already needs `timeout:180`.
  {
    id: 'mont-blanc-chablais',
    name: 'Mont Blanc & Chablais',
    country: 'France',
    blurb: 'Chamonix · Aravis · Portes du Soleil',
    bbox: { south: 45.75, west: 6.2, north: 46.45, east: 7.05 },
  },
  {
    id: 'vanoise',
    name: 'Vanoise & Tarentaise',
    country: 'France',
    blurb: 'Pralognan · Maurienne · Val d’Isère',
    bbox: { south: 45.2, west: 6.02, north: 45.85, east: 7.2 },
  },
  {
    id: 'ecrins',
    name: 'Écrins & Oisans',
    country: 'France',
    blurb: 'La Bérarde · Meije · Vallouise',
    bbox: { south: 44.6, west: 5.9, north: 45.3, east: 6.65 },
  },
  {
    id: 'queyras-brianconnais',
    name: 'Queyras & Briançonnais',
    country: 'France',
    blurb: 'Briançon · Saint-Véran · Ubaye',
    bbox: { south: 44.4, west: 6.4, north: 45.05, east: 7.1 },
  },
  {
    id: 'mercantour',
    name: 'Mercantour',
    country: 'France',
    blurb: 'Vallée des Merveilles · Tinée · Verdon',
    bbox: { south: 43.85, west: 6.6, north: 44.58, east: 7.6 },
  },
  {
    id: 'corsica',
    name: 'Corsica',
    country: 'France',
    blurb: 'GR20 · Monte Cinto · Calenzana → Conca',
    // The mountainous spine only, NOT the whole island. Every GR20 refuge sits
    // between ~1000 and 2000 m, while the coast is wall-to-wall sea-level resort
    // hotels that the 900 m floor rejects anyway — including them would spend
    // thousands of DEM lookups to discard thousands of results.
    bbox: { south: 41.6, west: 8.65, north: 42.65, east: 9.5 },
  },
  {
    id: 'vercors-chartreuse',
    name: 'Vercors & Chartreuse',
    country: 'France',
    blurb: 'Grenoble · Belledonne · Vercors plateaux',
    bbox: { south: 44.7, west: 5.2, north: 45.5, east: 6.05 },
  },
  {
    id: 'pyrenees-bearn',
    name: 'Pyrénées – Béarn',
    country: 'France',
    blurb: 'Ossau · Aspe · Pays Basque',
    bbox: { south: 42.7, west: -1.85, north: 43.3, east: -0.55 },
  },
  {
    id: 'pyrenees-centrales',
    name: 'Pyrénées Centrales',
    country: 'France',
    blurb: 'Gavarnie · Luchon · Néouvielle',
    bbox: { south: 42.6, west: -0.55, north: 43.15, east: 0.75 },
  },
  {
    id: 'pyrenees-ariege',
    name: 'Pyrénées – Ariège & Cerdagne',
    country: 'France',
    blurb: 'Ariège · Canigou · Cerdagne',
    bbox: { south: 42.3, west: 0.75, north: 42.95, east: 2.3 },
  },
  // --- Austria ---------------------------------------------------------------
  {
    id: 'vorarlberg-lechtal',
    name: 'Vorarlberg & Lechtal',
    country: 'Austria',
    blurb: 'Silvretta · Arlberg · Bregenzerwald',
    bbox: { south: 46.85, west: 9.5, north: 47.6, east: 10.9 },
  },
  {
    id: 'tirol-otztal-zillertal',
    name: 'Tirol – Ötztal & Zillertal',
    country: 'Austria',
    blurb: 'Innsbruck · Stubai · Zillertal',
    bbox: { south: 46.85, west: 10.9, north: 47.5, east: 12.05 },
  },
  {
    id: 'hohe-tauern',
    name: 'Hohe Tauern',
    country: 'Austria',
    blurb: 'Grossglockner · Krimml · Kaprun',
    bbox: { south: 46.85, west: 12.05, north: 47.45, east: 13.25 },
  },
  {
    id: 'salzburg-dachstein',
    name: 'Salzburg & Dachstein',
    country: 'Austria',
    blurb: 'Dachstein · Tennengebirge · Schladming',
    bbox: { south: 47.3, west: 12.8, north: 47.95, east: 14.25 },
  },
  {
    id: 'carinthia',
    name: 'Carinthia & Carnic Alps',
    country: 'Austria',
    blurb: 'Nockberge · Karawanken · Gailtal',
    bbox: { south: 46.4, west: 12.7, north: 47.32, east: 14.7 },
  },
  {
    id: 'lower-austria-alps',
    name: 'Lower Austria & Ennstal',
    country: 'Austria',
    blurb: 'Rax · Schneeberg · Gesäuse',
    bbox: { south: 47.3, west: 14.25, north: 48.1, east: 16.05 },
  },
  // --- Germany ---------------------------------------------------------------
  {
    id: 'allgau-werdenfels',
    name: 'Allgäu & Werdenfels',
    country: 'Germany',
    blurb: 'Oberstdorf · Zugspitte · Ammergau',
    bbox: { south: 47.3, west: 10.0, north: 47.9, east: 11.35 },
  },
  {
    id: 'bavarian-alps-east',
    name: 'Bavarian Alps – East',
    country: 'Germany',
    blurb: 'Karwendel · Chiemgau · Berchtesgaden',
    bbox: { south: 47.4, west: 11.35, north: 47.9, east: 13.1 },
  },
  {
    id: 'black-forest',
    name: 'Black Forest',
    country: 'Germany',
    blurb: 'Feldberg · Belchen · Kinzigtal',
    bbox: { south: 47.6, west: 7.65, north: 48.7, east: 8.6 },
  },
  // --- Spain -----------------------------------------------------------------
  {
    id: 'picos-de-europa',
    name: 'Picos de Europa',
    country: 'Spain',
    blurb: 'Cares gorge · Naranjo de Bulnes · Covadonga',
    bbox: { south: 42.9, west: -5.35, north: 43.4, east: -4.3 },
  },
  {
    id: 'cantabrian-west',
    name: 'Cantabrian Mountains – West',
    country: 'Spain',
    blurb: 'Somiedo · Ancares · Muniellos',
    bbox: { south: 42.7, west: -7.3, north: 43.35, east: -5.35 },
  },
  {
    id: 'pirineos-aragon',
    name: 'Pirineos – Aragón',
    country: 'Spain',
    blurb: 'Ordesa · Posets · Canfranc',
    bbox: { south: 42.35, west: -0.95, north: 42.9, east: 0.6 },
  },
  {
    id: 'pirineos-catalunya',
    name: 'Pirineus – Catalunya',
    country: 'Spain',
    blurb: 'Aigüestortes · Cadí · Vall de Núria',
    bbox: { south: 42.25, west: 0.6, north: 42.85, east: 2.1 },
  },
  // --- Portugal --------------------------------------------------------------
  {
    id: 'peneda-geres',
    name: 'Peneda-Gerês',
    country: 'Portugal',
    blurb: 'Serra da Peneda · Gerês · Soajo',
    bbox: { south: 41.55, west: -8.45, north: 42.05, east: -7.6 },
  },
  // --- Slovenia --------------------------------------------------------------
  // Overlaps Italy's Julian & Carnic tile (east edge 13.5) and Austria's
  // Carinthia (south edge 46.4) at their shared borders, which is intended —
  // huts in the overlap are deduplicated by OSM id.
  {
    id: 'julian-alps-slovenia',
    name: 'Julian Alps',
    country: 'Slovenia',
    blurb: 'Triglav · Bovec · Bohinj',
    bbox: { south: 46.15, west: 13.35, north: 46.62, east: 14.25 },
  },
  {
    id: 'kamnik-karavanke',
    name: 'Kamnik–Savinja Alps & Karavanke',
    country: 'Slovenia',
    blurb: 'Kamnik · Logarska dolina · Jezersko',
    bbox: { south: 46.2, west: 14.25, north: 46.7, east: 15.15 },
  },
  {
    id: 'pohorje',
    name: 'Pohorje & Kozjak',
    country: 'Slovenia',
    blurb: 'Maribor · Rogla · Drava valley',
    bbox: { south: 46.35, west: 15.15, north: 46.68, east: 15.85 },
  },
  {
    // The southern half of the Slovenian Mountain Trail, which ends at the sea.
    // Snežnik (45.577, 14.451) and Ankaran (45.579, 13.736) were outside every
    // box, so the trail could only ever load its Alpine section.
    id: 'sneznik-karst',
    name: 'Snežnik & the Karst',
    country: 'Slovenia',
    blurb: 'Snežnik · Postojna · Ankaran',
    // North edge is 46.2, NOT the 45.95 this box first had: that left an
    // enclosed 2 175 km² gap between here and the Julian Alps (south 46.15),
    // which `audit-coverage.ts` caught immediately. Meets kamnik-karavanke
    // (south 46.2) too.
    bbox: { south: 45.4, west: 13.6, north: 46.2, east: 14.65 },
  },

  // --- Nordic ----------------------------------------------------------------
  // Well outside the Alps, and the first boxes above 60°N. Note that a degree of
  // longitude is only ~42 km at 68°N (vs ~76 km at 46°N), so these look wide but
  // are actually SMALLER on the ground than an Alpine tile — Overpass is fine.
  {
    // The popular northern Kungsleden, Abisko → Nikkaluokta, not all 440 km.
    // That is the section our itinerary lists and the section people walk.
    id: 'kungsleden-north',
    name: 'Kungsleden (North)',
    country: 'Sweden',
    blurb: 'Abisko · Kebnekaise · Nikkaluokta',
    bbox: { south: 67.7, west: 18.0, north: 68.5, east: 19.4 },
  },
  {
    id: 'jotunheimen',
    name: 'Jotunheimen',
    country: 'Norway',
    blurb: 'Gjendesheim · Galdhøpiggen · Bygdin',
    bbox: { south: 61.25, west: 8.15, north: 61.78, east: 9.0 },
  },
];

/** The map camera framing a whole region. */
export function bboxToMapRegion(b: BBox): MapRegion {
  return {
    latitude: (b.south + b.north) / 2,
    longitude: (b.west + b.east) / 2,
    latitudeDelta: b.north - b.south,
    longitudeDelta: b.east - b.west,
  };
}

/** Whether a point lies within a region's box (with a small margin, so a hut
 *  just outside the drawn box still counts as "in" this region). */
export function bboxContains(b: BBox, lat: number, lon: number): boolean {
  const m = 0.05;
  return (
    lat >= b.south - m &&
    lat <= b.north + m &&
    lon >= b.west - m &&
    lon <= b.east + m
  );
}

/** Whether two boxes overlap at all (share any area). */
function bboxesOverlap(a: BBox, b: BBox): boolean {
  return (
    a.west <= b.east &&
    a.east >= b.west &&
    a.south <= b.north &&
    a.north >= b.south
  );
}

/** How far (km) beyond a picked subregion huts are still shown, so the map
 *  doesn't cut off dead at a subregion boundary.
 *
 *  This is a PER-HUT crop distance, not a "load the whole neighbouring region"
 *  distance — that distinction is the whole point. Selecting whole neighbours
 *  was pulling 3–7 regions and ~2 600 huts for a single pick (Ticino pulled in
 *  Bernese Oberland, because the boxes deliberately overlap at their shared
 *  borders so box-to-box distance is 0 even for tiles that aren't really
 *  adjacent). All that extra data has to be JSON-parsed and merged on the JS
 *  thread during the map's first render, before anything paints. Cropping to a
 *  10 km border strip keeps the edge coverage but cuts the working set ~3×. */
export const HALO_KM = 10;

/** Grow a box by `km` on every side. Flat-earth approximation — plenty accurate
 *  at Alpine scale; uses the mid-latitude for the longitude→km conversion. */
function growBBox(b: BBox, km: number): BBox {
  const dLat = km / 111;
  const midLat = (b.south + b.north) / 2;
  const dLon = km / (111 * Math.cos((midLat * Math.PI) / 180));
  return {
    south: b.south - dLat,
    north: b.north + dLat,
    west: b.west - dLon,
    east: b.east + dLon,
  };
}

/** What to actually load for a selection: which region files are worth parsing,
 *  and the boxes a hut must fall inside to be kept. */
export interface LoadScope {
  /** Region files that intersect the crop — the only ones parsed/fetched. */
  regions: Region[];
  /** One grown box PER PICKED REGION. A hut qualifies if it's in ANY of them.
   *  Deliberately a list, not a union: picking Bernese Oberland + Dolomites
   *  would make a union box that swallows the whole of Switzerland and northern
   *  Italy in between. */
  crops: BBox[];
}

/**
 * The concrete load scope for a user selection — the picked areas plus a
 * {@link HALO_KM} border strip. Bounded and cheap, so there's nothing to thin
 * or lazily juggle: whatever this returns is simply rendered.
 */
export function effectiveScope(selectedIds: string[]): LoadScope {
  const ids = new Set(selectedIds);
  const picked = REGIONS.filter((r) => ids.has(r.id));
  if (picked.length === 0) return { regions: [], crops: [] };
  const crops = picked.map((r) => growBBox(r.bbox, HALO_KM));
  // Only regions that actually reach into the crop are worth parsing at all.
  const regions = REGIONS.filter((r) =>
    crops.some((c) => bboxesOverlap(r.bbox, c)),
  );
  return { regions, crops };
}

/** Whether a point falls inside the scope's border-cropped area. */
export function inScope(scope: LoadScope, lat: number, lon: number): boolean {
  for (const c of scope.crops) {
    if (lat >= c.south && lat <= c.north && lon >= c.west && lon <= c.east) {
      return true;
    }
  }
  return false;
}

/** The single box enclosing every given region (used to frame the map when
 *  more than one region is shown). Falls back to the first region if empty. */
export function unionBBox(regions: Region[]): BBox {
  const rs = regions.length ? regions : [REGIONS[0]];
  return rs.reduce<BBox>(
    (acc, r) => ({
      south: Math.min(acc.south, r.bbox.south),
      west: Math.min(acc.west, r.bbox.west),
      north: Math.max(acc.north, r.bbox.north),
      east: Math.max(acc.east, r.bbox.east),
    }),
    { south: 90, west: 180, north: -90, east: -180 },
  );
}

/** The region a point falls in (first match), or undefined if none — e.g. to
 *  pick which region's lifts to fetch for a route starting at that point. */
export function regionForPoint(lat: number, lon: number): Region | undefined {
  return REGIONS.find((r) => bboxContains(r.bbox, lat, lon));
}
