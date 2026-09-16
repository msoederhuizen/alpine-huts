import type { Hut } from '../types/hut';

/**
 * Famous long-distance routes you can load with one tap, instead of building an
 * itinerary yourself.
 *
 * ── How a route becomes loadable ────────────────────────────────────────────
 * `stages` holds the itinerary as a human gave it — that's the authoritative
 * record and it never depends on our data. `stageIds` holds OSM ids for those
 * stages, and a route is only offered in the UI once it HAS them.
 *
 * ⚠️ STAGE IDS ARE NEVER DERIVED FROM NAMES AT RUNTIME. Substring matching
 * against this dataset is actively dangerous: it resolved Alta Via 1 stages to a
 * cableway ("Teleferica Rifugio Sommariva al Pramperet"), a road ("Strada Lago
 * Combal Rifugio Elisabetta") and a junction ("Bivio rifugio Bonatti"); and when
 * checking the routes below it matched "Elm" → Gelmerhütte, "Isola" → Rifugio
 * Amici d'Armisola, and "Boz" → Rifugio Angelino Bozzi (which is in the Ortler,
 * not the Dolomiti Bellunesi). Sending a walker to a cableway pylon or the wrong
 * massif for the night is not an acceptable failure mode.
 *
 * So each id below was checked individually: it must be a real lodging type and
 * its elevation must match the published refuge. To add ids to a pending route,
 * do the same — resolve, verify, then fill in `stageIds`.
 *
 * Loaded routes are EDITABLE STARTING POINTS, not surveyed itineraries. Day
 * splits vary with fitness and hut availability.
 */
export interface ClassicRoute {
  id: string;
  name: string;
  /** Primary country, used to group the menu. */
  country: string;
  /** All countries it crosses, for the subtitle. */
  countries?: string[];
  /** Range/area. */
  where: string;
  /**
   * Total length, stored as the AUTHOR WROTE IT ("~120 km", "80–120 km",
   * "390 km (Swiss section)") rather than as a number.
   *
   * A number forced a false precision: Jotunheimen was given as "80–120 km" and
   * got flattened to 100, which is a figure nobody stated. These are guidebook
   * approximations, and rendering them verbatim keeps them honest.
   */
  length: string;
  /** Typical duration, as given (e.g. "8–10 days"). */
  days: string;
  /**
   * Difficulty AS GIVEN — omitted when the author didn't state one.
   *
   * ⚠️ Do not fill this in by inference. It was briefly populated with guesses
   * for the 12 routes that came without a grading, which is precisely the field
   * you must not invent on a hiking app: someone may choose a route on it.
   */
  difficulty?: string;
  /** One line on what the walk is like. */
  blurb: string;
  /** The itinerary, in walking order, as authored. Always present. */
  stages: string[];
  /**
   * Verified OSM ids for the stages. ABSENT = route not loadable yet, either
   * because its region's offline data hasn't been generated or because the stages
   * haven't been resolved and checked. Need not be 1:1 with `stages` — trailheads
   * and road-ends often aren't huts.
   */
  stageIds?: string[];
  /**
   * Routing-only waypoints for a leg, keyed by the `stageIds` entry the leg
   * arrives AT. These are NOT stops and never become a day.
   *
   * ⚠️ Keyed by stage ID, not by index. An index would silently shift the moment
   * one stop failed to resolve, attaching a waypoint to the wrong leg — and the
   * result would still route, just wrongly.
   *
   * Use when a published stage takes a high line the router won't pick: it
   * prefers the valley because the valley genuinely is shorter and easier.
   */
  stageVias?: Record<string, { lat: number; lon: number; note: string }[]>;
  /** Region whose data the stages live in (informational for pending routes). */
  regionId?: string;
}

export const CLASSIC_ROUTES: ClassicRoute[] = [
  // ══ READY ═════════════════════════════════════════════════════════════════
  {
    id: 'alta-via-1',
    name: 'Alta Via 1',
    country: 'Italy',
    where: 'Dolomites',
    length: "~120 km",
    days: '8–10 days',
    difficulty: "Moderate",
    blurb: 'The classic first Dolomite hut trek.',
    stages: [
      'Lago di Braies → Rifugio Biella',
      'Rifugio Biella → Rifugio Fanes',
      'Rifugio Fanes → Rifugio Lagazuoi',
      'Lagazuoi → Rifugio Nuvolau',
      'Nuvolau → Rifugio Città di Fiume',
      'Città di Fiume → Rifugio Coldai',
      'Coldai → Rifugio Vazzoler',
      'Vazzoler → Rifugio Carestiato',
      'Carestiato → La Pissa / Belluno',
    ],
    regionId: 'dolomites',
    // Every id verified as tourism=alpine_hut with a matching published
    // elevation. The finish resolves via `dolomiti-bellunesi`; La Pissa itself
    // is a roadside bus stop and isn't mapped as anything we can link to, so the
    // town is the finish.
    stageIds: [
      // ⚠️ WAS OMITTED as "a road-end, not a hut" — wrong. The historic hotel on
      // the lake shore (1503 m, 400 m from the trailhead) is in the data and is
      // where walkers actually sleep the night before, so stage 1 now loads.
      'way/103317094', // Hotel Pragser Wildsee – Lago di Braies, 1503 m
      'way/121491779', // Rifugio Biella – Seekofelhütte, 2327 m
      'way/237733853', // Rifugio Fanes, 2060 m
      'way/200336118', // Rifugio Lagazuoi, 2752 m
      'way/200226208', // Rifugio Nuvolau, 2575 m
      'way/200217396', // Rifugio Città di Fiume, 1917 m
      'way/200218638', // Rifugio Adolfo Sonino al Coldai, 2135 m
      'way/183195927', // Rifugio Mario Vazzoler, 1714 m
      'way/183203075', // Rifugio Bruto Carestiato, 1834 m
      // ⚠️ NOT 1:1 with `stages`. The published itinerary compresses the finish
      // into one line ("Carestiato → La Pissa / Belluno"), but that is 40.6 km
      // on the ground — three days, not one. These two huts are the real
      // overnight stops on it, and both are in `dolomiti-bellunesi`. Adding them
      // makes the loaded route walkable; `stages` still records the itinerary as
      // written.
      'way/183315385', // Rifugio Sommariva al Pramperet, 1857 m
      'way/183317591', // Rifugio Furio Bianchet, 1245 m
      'node/64778091', // Belluno, 386 m (the "La Pissa / Belluno" finish)
    ],
  },
  {
    id: 'via-alpina-green-ch',
    name: 'Via Alpina (Green Trail)',
    country: 'Switzerland',
    where: 'Sargans to Montreux',
    // ⚠️ 390 km IS NOT OUR ROUTE, so it is not the figure to measure against.
    // That total covers all twenty published stages starting at Gaflei in
    // Liechtenstein and finishing over the Rochers de Naye. This itinerary, at
    // the user's direction (2026-09-14), starts at SARGANS — dropping stage 1,
    // 28 km — and finishes Gstaad → Château-d'Oex → Montreux instead of
    // Gstaad → L'Etivaz → Rossinière → Rochers de Naye → Montreux. Gaflei,
    // L'Etivaz and the Rochers de Naye are all absent from OSM lodging anyway.
    //
    // Against the fifteen stages we DO share (2–16, Sargans→Gstaad, 300 km
    // published) we measure 301.2 km: **+0%**, with twelve of fifteen legs
    // within 3%. The old "−15%" was this mismatch plus three unrouted passes,
    // never a routing fault.
    length: "~346 km (Sargans start, via Château-d'Oex)",
    days: '18+ days',
    difficulty: "Moderate–Challenging",
    blurb: 'The Swiss traverse — Sargans to Montreux, part of the 5 000 km Via Alpina.',
    stages: [
      'Sargans', 'Weisstannen', 'Elm', 'Linthal', 'Urner Boden', 'Altdorf',
      'Engelberg', 'Engstlenalp', 'Meiringen', 'Grindelwald', 'Lauterbrunnen',
      'Griesalp', 'Kandersteg', 'Adelboden', 'Lenk', 'Gstaad', "Château-d'Oex",
      'Montreux',
    ],
    regionId: 'bernese-oberland',
    // Village stage towns verified by EXACT name match against the bundle.
    // ALL 14 published stages now load, as of 2026-08-25.
    // ⚠️ Two stops here were long recorded as "not in the data". Both claims
    // were wrong, in different ways, and both cost months:
    //   • Montreux is in `mont-blanc-chablais`; the old note only checked
    //     `valais-west` and concluded it was absent.
    //   • Château-d'Oex really was outside every bbox — by 1.2 km. Widening
    //     `bernese-oberland` west 7.15→7.02 captured it and Rossinière.
    // Waypoints from the user's GPX tracks. Each is the track's own high point,
    // and each was the MINIMAL set — adding the further tops the tracks cross
    // changed nothing once these were pinned.
    //
    //   Linthal→Urnerboden      10.7 → 15.3 km / +982 m   (GPX 15.9 / +989)
    //   Engstlenalp→Meiringen   17.9 → 21.7 km / +574 m   (GPX 22.0 / +566)
    //   Lenk→Gstaad             17.3 → 21.9 km / +1019 m  (GPX 22.4 / +1022)
    //
    // All three had the same shape: right endpoints, far too little climb. The
    // Engstlenalp leg is the clearest — it gained 113 m of ascent over 17.9 km,
    // which is a valley line, where the stage crosses 2247 m.
    stageVias: {
      'node/240109196': [
        { lat: 46.93707, lon: 8.97973, note: 'Klausenpass approach, 1261 m' },
      ],
      'node/60336653': [
        { lat: 46.75379, lon: 8.28393, note: 'Above Engstlenalp, 2239 m' },
      ],
      'node/187228808': [
        { lat: 46.42806, lon: 7.37312, note: 'Trütlisbergpass, 2064 m' },
      ],
    },
    // ⚠️ Gstaad→Château-d'Oex has NO waypoint, deliberately. Its GPX is an
    // out-and-back (33.9 km; distance to Château-d'Oex falls monotonically to
    // 8 m at 17.1 km along, then rises again), so only the first half is the
    // leg: 17.1 km / +131 m / peak 1105 m — a valley walk. We route 15.1 km /
    // +176 m, and waypoints at 4, 7.7, 11 and 14 km along the outbound ALL leave
    // it unchanged, which is the proof we already follow that corridor. The 2 km
    // is the recorded track meandering, not a different line. Forcing it would
    // pin a route for no gain.
    //
    // Château-d'Oex→Montreux measures 29.5 km / +2000 m and has no published
    // figure at all: the itinerary covers that ground as Rossinière → Rochers de
    // Naye → Montreux (19 + 13 km) from a different start, and both of those
    // stops are absent from OSM lodging.
    stageIds: [
      'node/30811583', // Sargans
      // Published stage 2 finishes here, splitting what we ran as a single
      // 35.7 km Sargans→Elm leg into the 13 + 22 km the itinerary walks.
      'node/240119932', // Weisstannen, 1004 m
      // ⚠️ Elm was previously OMITTED, which left Sargans→Linthal as a single
      // ~90 km "day". It is in the bundle (central-switzerland / graubunden-north)
      // and resolves fine — it had simply been missed.
      'node/32863355', // Elm
      'node/32863361', // Linthal
      // ⚠️ NOT 1:1 with `stages` (same precedent as Alta Via 1's finish). The
      // published list compresses Linthal→Engelberg into one line, but that is
      // 64 km on the ground — the checker flagged it. These are the official
      // Via Alpina overnight stops on it (Klausenpass, then Surenenpass), and
      // both are in `central-switzerland`.
      'node/240109196', // Urnerboden, 1372 m
      'node/240093137', // Altdorf UR, 458 m
      'node/59644573', // Engelberg
      // Likewise Engelberg→Meiringen was one 30 km line; Engstlenalp is the
      // official stop between them, over the Jochpass.
      'node/469872370', // Hotel Engstlenalp, 1836 m
      'node/60336653', // Meiringen
      'node/21311918', // Grindelwald
      'node/240072007', // Lauterbrunnen
      'node/814698079', // Griesalp (Grand Hotel), 1411 m
      'node/18478561', // Kandersteg
      'node/18477535', // Adelboden
      'node/26795520', // Lenk
      // ⚠️ WAS 'node/240080699' — Gsteig bei Gstaad, a DIFFERENT village ~10 km
      // south. The published stage is Gstaad; this is exactly the near-miss the
      // file header warns about, and it looked right in a list.
      'node/187228808', // Gstaad
      // Château-d'Oex arrived with the 2026-08-25 bbox widening (west 7.15→7.02)
      // and is the published stage, so the Rougemont stand-in is gone.
      'node/240129561', // Château-d'Oex, 958 m
      // Rossinière splits the final run to the lake, which the published list
      // compresses into one line but is two days over Les Avants.
      'node/197507412', // Montreux, 390 m (the published finish)
    ],
  },

  // ══ PENDING — region data not generated yet ════════════════════════════════
  // These need `npm run generate-huts` to finish for their region, then the
  // stages resolved and verified. See [[pending-accommodations-refetch]].
    {
    id: 'alta-via-2',
    name: 'Alta Via 2',
    country: 'Italy',
    where: 'Dolomites',
    length: "~160 km",
    days: '13 hiking days (14 with arrival/departure)',
    difficulty: "Difficult (includes via ferrata options)",
    blurb: 'The harder Dolomites traverse, Bressanone to Feltre.',
    regionId: 'dolomites',
    // Per-stage against huttohuthikingdolomites.com/alta-via-2-ultimate-guide
    // (the user's source), 2026-09-14. Twelve published stages; the comparable
    // total is 150.3 vs 150 km — **+0%** — and nine of twelve are within 5%.
    //
    // ⚠️ ALIGN THE STAGES BEFORE COMPARING. Day 13 is "Rifugio Boz → Croce
    // d'Aune/Feltre", ONE 19 km stage ending at Croce d'Aune with Feltre as the
    // town beyond. Pairing that 19 km with our Croce d'Aune→Feltre leg instead
    // of Boz→Croce d'Aune produced a phantom −37% and hid a clean +6%. Our
    // Croce d'Aune→Feltre (11.9 km) is an ADDITION with no published figure.
    //
    // ✅ "Hotel Cristallo" is the Passo San Pellegrino stage stop: it sits at
    // 1922 m and the pass is ~1918 m, and the legs either side are −1% and −2%.
    //
    // ✅ Brixen→Plosehütte is NOT the +50% it looked. The guide's 7 km is simply
    // wrong for a walk: a GPX of the stage measures 9.0 km, and its start is
    // 2.8 km from our Bressanone stop — so our 10.5 km covers more ground than
    // the track, not less. Our peak is 2449 m, the track's is 2449 m: the same
    // climb to the Plose. Nothing to fix.
    //
    // ⚠️ Rifugio Rosetta→Treviso WAS the one genuine gap: 9.7 km / +356 m against
    // a track of 12.2 km / +837 m. It is fixed by `stageVias` below — note it
    // needed BOTH tops. One alone gave 14.5 km, overshooting; the pair gives
    // 12.5 km / +845 m / peak 2696 against the track's 12.2 / +837 / 2694.
    //
    // Left as-is: Utia de Puez→Pisciadù +11%, Treviso→Cereda −10%. Both are
    // small, and the guide's own per-stage figures round to whole kilometres.
    stageVias: {
      'way/210004305': [
        { lat: 46.24662, lon: 11.84682, note: 'Passo di Ball area, 2481 m' },
        { lat: 46.25083, lon: 11.86452, note: 'Passo delle Lede, 2694 m' },
      ],
    },
    // Itinerary per huttohuthikingdolomites.com's Alta Via 2 guide, adopted
    // 2026-08-21 in place of the shorter list this route shipped with. Its three
    // differences are all improvements, and two of them fixed real problems:
    //   • Pisciadù instead of Boé on the Sella (a standard variant).
    //   • Passo San Pellegrino added — our Castiglioni→Mulaz leg was 27.7 km.
    //   • Rifugio Cereda added — our Pradidali→Boz leg was 26.4 km.
    // It drops Pradidali and Dal Piaz, which the original list had; both are
    // real AV2 huts on variant routings, so they're recorded here rather than
    // lost: Pradidali way/129947081 (2278 m), Dal Piaz way/495498456 (1973 m).
    stages: [
      'Bressanone',
      'Rifugio Plose',
      'Rifugio Genova',
      'Rifugio Puez',
      'Rifugio Pisciadù',
      'Rifugio Castiglioni Marmolada',
      'Passo San Pellegrino',
      'Rifugio Volpi al Mulaz',
      'Rifugio Rosetta',
      'Rifugio Treviso',
      'Rifugio Cereda',
      'Rifugio Boz',
      "Passo Croce d'Aune",
      'Feltre',
    ],
    stageIds: [
      'node/64777005', // Brixen - Bressanone, 560 m (town — start)
      'node/439594940', // Plosehütte - Rifugio Plose
      'node/11056910068', // Schlüterhütte - Rifugio Genova, 2306 m
      'way/152266832', // Utia de Puez, 2475 m
      'way/42227260', // Rifugio Franco Cavazza al Pisciadù, 2587 m
      'way/107176085', // Rifugio Marmolada Castiglioni
      // The pass itself carries no lodging node; this is one of the cluster of
      // hotels ON it (1913-1928 m), standing in for "sleep at the pass".
      'way/199553711', // Hotel Cristallo, Passo San Pellegrino, 1922 m
      'way/199052486', // Rifugio G. Volpi al Mulaz, 2570 m
      'way/240938276', // Rifugio Rosetta "Giovanni Pedrotti", 2580 m
      'way/210004305', // Rifugio Treviso, 1631 m
      'node/1952320234', // Rifugio Cereda
      'way/180141573', // Rifugio Bruno Boz, 1718 m
      'node/12000743878', // Albergo Croce d'Aune, 1028 m
      'node/64778115', // Feltre (town — finish)
    ],
  },
  {
    id: 'tour-du-mont-blanc',
    name: 'Tour du Mont Blanc',
    country: 'France',
    countries: ['France', 'Italy', 'Switzerland'],
    where: 'Mont Blanc massif',
    length: "164 km",
    days: '10 days',
    difficulty: "Moderate",
    blurb: 'The great circuit of Mont Blanc, through three countries.',
    regionId: 'mont-blanc-chablais',
    // bookatrekking's full 10-day version, adopted 2026-08-26 in place of the
    // village-hopping list this route shipped with. It is a proper hut itinerary
    // — Truc, Elisabetta, Monte Bianco, Bertone, La Peule, Arpette — rather than
    // a chain of valley towns, and it runs anticlockwise through Bourg-Saint-
    // Maurice instead of cutting over the Croix du Bonhomme to Les Chapieux.
    stages: [
      'Les Houches', 'Auberge du Truc', 'Les Chapieux',
      'Rifugio Elisabetta', 'Rifugio Monte Bianco', 'Rifugio Bertone',
      'Alpage de La Peule', "Relais d'Arpette", 'Trient', 'Gîte Le Moulin',
      'Chamonix',
    ],
    stageIds: [
      'node/1744277791', // Les Houches — start
      'node/13124891039', // Auberge du Truc, 1750 m
      // ⚠️ NOT Bourg-Saint-Maurice. Routing via the town dropped the walker into
      // the valley and made these two legs 35.4 km and 32.6 km against a
      // published 22.3 and 14.3. Les Chapieux keeps the line over the Col du
      // Bonhomme, where the TMB actually goes.
      'way/131095501', // Auberge Refuge de la Nova, Les Chapieux, 1554 m
      // ⚠️ Pick the HUT, not the road. Two ways named "Strada Lago Combal
      // Rifugio Elisabetta" sit 1.5 km away and are exactly the decoy this
      // file's header warns about.
      'way/60798744', // Rifugio Elisabetta Soldini Montanaro, 2194 m
      'node/353085969', // Rifugio Monte Bianco, 1680 m (Val Veny)
      // ⚠️ way/147963960 is "Rifugio Giorgio Bertone vecchio" — the OLD hut.
      // ✅ Monte Bianco→Bertone is VERIFIED, don't re-flag it. Its routed/straight
      // ratio is 2.8× — the highest left in the dataset — which looked like a
      // detour. It isn't: the stage drops into Courmayeur and climbs back out, so
      // a short straight line is exactly what the geometry should produce. A GPX
      // via Courmayeur is 10.9 km / +791 m; we route 10.9 km / +746 m. Detour
      // ratio is a screening signal, not evidence.
      'way/147963963', // Rifugio Bertone
      'node/2820208447', // La Peule, 2071 m
      'way/227347699', // Relais d'Arpette, 1631 m
      'node/4280862572', // Auberge du Mont Blanc, Trient, 1274 m
      'way/97323985', // Gîte d'étape le Moulin, 1340 m
      'node/26696275', // Chamonix-Mont-Blanc — finish
    ],
    // Day 10 is ONE day, over Lac Blanc. Left alone the router took the valley
    // floor — 10.5 km with +68 m, against a published 19.4 km / +1310 m — so the
    // climb is forced with a waypoint rather than by inventing an overnight stop
    // at the refuge. The Planpraz descent is a lift (`lift/gondola|Planpraz` in
    // the rides data), so the lift toggle covers it.
    // ⚠️ The last two days were the only legs left adrift, and BOTH were missing
    // a SECOND high point, not their first. Checked against the user's tracks
    // (whose endpoints are the villages Trient and Montroc, 276–368 m from the
    // lodgings we use — close enough to compare directly):
    //
    //   · Trient→Le Moulin ran 12.6 km / +944 m against 14.2 / +1154. It already
    //     reached 2205 m, so the obvious "it misses the Col de Balme" reading was
    //     wrong. The track crosses TWO tops — 2217 m then 2186 m — and pinning
    //     both gives 15.0 km / +1217 m: +6% on each, erring consistently.
    //   · Le Moulin→Chamonix ran 15.6 km / +1116 m against 20.6 / +1412 WITH the
    //     Lac Blanc waypoint already applied. Lac Blanc is only the first summit;
    //     the track then drops and climbs again to 2078 m above Planpraz before
    //     descending. Adding that: 18.5 km / +1397 m — ascent within 1%.
    //
    // ⚠️ A leg that already has a waypoint can still be missing one. Both of
    // these looked "already fixed" because their first high point matched.
    stageVias: {
      'way/97323985': [
        { lat: 46.02892, lon: 6.96615, note: 'Above the Col de Balme, 2217 m' },
        { lat: 46.01823, lon: 6.94063, note: 'Aiguillette des Posettes, 2186 m' },
      ],
      'node/26696275': [
        { lat: 45.9817, lon: 6.8919, note: 'Refuge du Lac Blanc, 2352 m' },
        { lat: 45.93946, lon: 6.84917, note: 'Planpraz shoulder, 2078 m' },
      ],
    },
  },
  {
    id: 'walkers-haute-route',
    name: "Walker's Haute Route",
    country: 'Switzerland',
    countries: ['Switzerland', 'France'],
    where: 'Chamonix to Zermatt',
    length: "~210 km",
    days: '12–14 days',
    difficulty: "Challenging",
    blurb: 'Mont Blanc to the Matterhorn, high above the Rhône valley.',
    regionId: 'valais-west',
    stages: [
      'Chamonix', 'Argentière', 'Trient', 'Champex', 'Le Châble',
      'Cabane du Mont Fort', 'Prafleuri', 'Arolla', 'La Sage', 'Cabane de Moiry',
      'Zinal', 'Gruben', 'St. Niklaus', 'Europahütte', 'Zermatt',
    ],
    // Per-leg against komoot (the user's source), 2026-09-14. Ten of fourteen
    // within 8%; four were checked against GPX tracks and two are now pinned by
    // waypoints (see `stageVias`). One remains open:
    //
    // ⚠️ Cabane Mont Fort → Prafleuri is 11.3 km against a GPX 14.2 and komoot
    // 14.3 — but its PEAK matches at 2984 m vs 2987, and a waypoint at the GPX
    // high point changes nothing. So we cross the same high col by a shorter
    // line; the published stage links three cols (Termin, Louvie, Prafleuri) and
    // we are probably cutting one. Needs an intermediate col, not a summit —
    // don't guess one, see the Besseggen note in [[classic-routes-backlog]].
    //
    // ✅ Europahütte → Zermatt is VERIFIED: 19.5 km / +1014 m / peak 2348 m
    // against a GPX 21.6 / +1018 / 2359. Ascent and peak match; the 10% on
    // distance is the Europaweg's exact line, not a wrong pass.
    stageIds: [
      'node/1399742788', // Chamonix
      'node/285882627', // Argentière
      'node/411002702', // Trient
      'node/240105235', // Champex-Lac
      'node/304014579', // Le Châble
      'node/309759750', // Cabane Mont Fort, 2457 m
      'way/208112909', // Cabane de Prafleuri, 2662 m
      'node/600048453', // Arolla, 2006 m
      'node/291050648', // La Sage
      // Was missing entirely — the published route crosses the Col de Torrent to
      // Moiry, then the Sorebois pass to Zinal. Without it, La Sage→Zinal was one
      // implausible day.
      'node/4399562394', // Cabane de Moiry, 2825 m
      'node/308504436', // Zinal, 1675 m
      'node/240047919', // Gruben
      'node/240035309', // Sankt Niklaus (OSM spells it out; stage says "St.")
      'way/296802400', // Europahütte, 2220 m
      'node/80387968', // Zermatt, 1608 m
    ],
    // The last day is the EUROPAWEG — across the Charles Kuonen suspension
    // bridge and along the balcony to Zermatt — and it is ONE day. Left alone
    // the router dropped to the valley floor through Randa and Täsch: 13.1 km
    // with only +239 m, which is the road, not the trail. Täschalp sits on the
    // high traverse and holds the line without becoming an overnight stop.
    stageVias: {
      'node/80387968': [
        { lat: 46.0591, lon: 7.8102, note: 'Täschalp, 2169 m — on the Europaweg' },
      ],
      // ⚠️ Day 1 over LAC BLANC, at the user's explicit choice — "different than
      // the input but fine". komoot's own stage is a 9.4 km valley walk; this is
      // the high variant. Left alone the leg ran 12.4 km peaking at 1279 m, i.e.
      // the valley floor. Now 18.8 km / +1428 m peaking at 2355 m against Refuge
      // du Lac Blanc's 2352 m. Longer than the GPX's 12.9 km because our start is
      // the Auberge de jeunesse in Les Pèlerins, ~3.8 km short of the track's
      // Chamonix-centre start.
      'node/285882627': [
        { lat: 45.98001, lon: 6.891, note: 'Refuge du Lac Blanc, 2352 m' },
      ],
      // ⚠️ COL DE SOREBOIS. Without it the leg took a line peaking at 3139 m —
      // higher than the col and over ground the stage does not cross — and came
      // out at 10.2 km / +342 m against komoot's 15.7 km. With the col it is
      // 15.8 km / +604 m peaking at 2836 m, and the Col de Sorebois is 2835 m.
      // Note the GPX stops 2 km short of Zinal, so its 11.6 km understates the
      // stage; komoot's 15.7 is the figure that matches.
      'node/308504436': [
        { lat: 46.14883, lon: 7.58663, note: 'Col de Sorebois, 2835 m' },
      ],
      // ⚠️ AN EARLY TRACK ANCHOR, NOT A NAMED COL — and that distinction is the
      // point. The leg matched on PEAK (2984 vs 2987) while running 20% short,
      // because the stage links FOUR cols and our line already crossed three;
      // waypoints at Louvie (2938 m), P2947 or Prafleuri (2987 m) changed it not
      // at all. Only the first section was being skipped.
      //
      // Pinning the Col Termin (2648 m) — the missing prominence maximum — fixed
      // the topology but overshot to 16.2 km / +1254 m against a track of
      // 14.2 / +1122. Sampling the track every 2 km instead found that a plain
      // anchor 2 km in gives **14.4 km / +1036 m / peak 2984**: +1% on distance,
      // and the ascent within the 20–30 m filtering band. An anchor at 4 km sits
      // beside Col Termin and overshoots identically, so it is that approach
      // BRouter takes badly, not the col itself.
      //
      // ⚠️ Local maxima are where to look FIRST, not the only place to look.
      // When the best summit waypoint still misses, sample the track at a fixed
      // interval — the right anchor here is on a traverse, not on a top.
      'way/208112909': [
        { lat: 46.072, lon: 7.27848, note: 'Traverse above Cabane Mont Fort, 2503 m' },
      ],
    },
  },
  {
    id: 'adlerweg',
    name: 'Adlerweg',
    country: 'Austria',
    where: 'Tyrol',
    // ⚠️ SCOPED TO WHAT WE ACTUALLY CARRY. This read "~413 km", which is the
    // FULL Adlerweg (33 stages, North + East Tirol). `stages` below is etappes
    // 1–12 only — so the route once loaded ~170 km of walking under a 413 km
    // label, a 2.5× overstatement of the trip someone is choosing.
    //
    // ⚠️ This figure is now the GPX-FIRST REFERENCE (the user's tracks where they
    // exist, visittirol's stage table otherwise, plus the endpoint gaps we walk
    // and the tracks don't) — 187.8 km — NOT our own measurement. We route
    // 178.7 km against it, −5%. Earlier versions of this field held our
    // measurement instead, which made the route agree with itself by
    // construction and could never surface a gap.
    //
    // ⚠️ It has been wrong four times, each for a reason worth knowing: 175 km
    // came from a run that had silently fallen back to public brouter.de and
    // stock hiking-beta; 184 km was measured while the T3 ceiling still sent
    // stage 11 on an 18 km detour; 166 km was a stale copy from before the
    // ceiling moved; 179 km was our own total masquerading as a reference.
    length: "~188 km (stages 1–12, GPX-referenced)",
    days: '12 days',
    blurb: 'The Eagle Walk across Tyrol — stages 1–12 of the ~413 km route.',
    regionId: 'tirol-otztal-zillertal',    // ⚠️ THE GPX TRACKS ARE THE REFERENCE FOR THIS ROUTE, not visittirol — the
    // user's instruction, and the tracks disagree with the site on four of the
    // six stages they cover. Where a track's endpoint sits >500 m from our stop,
    // the comparison below ADDS that gap, because we walk it and the track
    // doesn't:
    //
    //   e03 Kaindl→Kufstein    ours 10.7 | GPX 12.3 (ends 44 m off)      −14%
    //   e04 Kufstein→Buchacker ours 17.8 | GPX  9.6 + 6.4 km start gap   +11%
    //   e05 Buchacker→Pinegg   ours 15.9 | GPX 16.5 (ends 260 m off)      −4% ✅
    //   e06 Pinegg→Steinberg   ours 16.1 | GPX 18.0 + 1.0 km end gap     −15%
    //   e08 Erfurter→Lamsenjoch ours 22.1 | GPX 17.0 + 2.1 km start gap  +15%
    //   e11 Karwendel→Halleranger ours 13.9 | GPX 13.8                    +0% ✅
    //
    // Switching reference moved e04 from +67% to +11% and e05 from −11% to −4%,
    // but moved e06 the other way (−9% → −15%) and made e08 measurable at all.
    // A different reference is not automatically a kinder one.
    //
    // GPX-first total for stages 1–12: 187.8 km against our 178.7 — −5%.
    //
    // Stages 6–12 against visittirol (km | ascent), kept for the legs with no
    // track — the site only serves 1–5 to a fetch:
    //   e06 Pinegg→Steinberg      17.8 | +1100  ours 13.0 | + 702   ⚠ −27%/−36%
    //   e07 Waldhäusl→Erfurter    18.0 | +1590  ours 15.8 | +1419     −12%/−11%
    //   e08 Erfurter→Lamsenjoch     —  |   —    ours 22.1 | +1136   NO REFERENCE
    //   e09 Lamsenjoch→Falkenhütte 12.5 | + 810  ours 11.3 | + 771     −9%/−5% ✅
    //   e10 Falkenhütte→Karwendel   9.0 | + 440  ours  8.8 | + 414     −2%/−6% ✅
    //   e11 Karwendel→Halleranger  14.0 | +1440  ours 13.9 | +1434     −1%/−0% ✅
    //   e12 Halleranger→HAFELEKAR  13.0 | +1150  ours 17.9 | + 855   ⚠ see below
    //
    // ⚠️ e12 IS NOT OUR LAST LEG. The published stage runs Hallerangerhaus →
    // Pfeishütte → Hafelekar → Nordkette and ENDS AT THE CABLE-CAR TOP STATION;
    // you ride down. We split it in two and walk to Innsbruck itself, so our
    // 17.9 km is longer by the descent — but our combined ascent is 855 m
    // against 1150, which says we skip the climb over the Hafelekar ridge.
    // Comparing our 7.5 km first half to the whole 13.0 km stage (the "−43%"
    // this shows as) compares different things.
    //
    // ⚠️ e06 is the one clear defect left: short AND low on both axes.
    // e08 has no published figure at all and is our longest Adlerweg leg.
    // e07's shortfall is proportional on both axes and its published stage
    // starts 1 km from our stop, so it is probably fine.
    //
    // Per-stage against visittirol (which only exposes stages 1–5):
    //   1 St. Johann→Gaudeamus   12.2 vs 13.0   2 Gaudeamus→Kaindl  14.9 vs 15.1
    //   3 Kaindl→Kufstein         8.0 vs 12.5   4 Kufstein→Buchacker 17.9 vs 10.7
    //   5 Buchacker→Pinegg       13.3 vs 18.0
    //
    // ⚠️ STAGE 4's 10.7 km IS BELOW ITS OWN STRAIGHT LINE (Kufstein to Buchacker
    // is 12.6 km apart), which looked like a wrong figure. It isn't, and OUR
    // KUFSTEIN NODE IS NOT THE PROBLEM either — that was checked directly:
    //
    //   · e03's track ENDS 44 m from node/26902437. Right arrival point.
    //   · e04's track STARTS 6.3 km away, 144 m from node/33204772
    //     "Unterlangkampfen" — a village on the Inn valley railway.
    //
    // So the stage is titled "Kufstein → Gasthof Buchacker" but is walked from
    // Unterlangkampfen; the itinerary TRANSFERS that 6.3 km. We walk it, and
    // that is the entire +67%. Same shape as the Stubaier's Elfer lift and this
    // route's own Hafelekar finish: a published stage that omits a valley
    // connection the walker rides.
    //
    // Don't "fix" this by moving the stop to Unterlangkampfen — that would make
    // the app skip 6.3 km of real walking without telling anyone.
    //
    // ⚠️ The straight-line test is still worth applying — a stage below its own
    // great-circle distance is always worth questioning — but it flags a
    // MISMATCH BETWEEN THE FIGURE AND OUR STOPS, not necessarily a bad figure.
    // I first read it as proof the guide was wrong. It wasn't.
    //
    // The three legs are now pinned from the user's GPX tracks:
    //   3 Kaindl→Kufstein   8.0 → 10.7 km / peak 1292 → 1446 (track 12.3 / 1432)
    //   4 Kufstein→Buchacker   17.9 km, ascent 1103 → 1408, peak 1466 → 1639
    //                          (track +1317 / 1642 over its shorter span)
    //   5 Buchacker→Pinegg  13.3 → 15.9 km, ascent +55 → +890 (track 16.5 / +823)
    // Leg 5 was the striking one: 55 m of climb over 13.3 km, a valley line where
    // the stage crosses 1762 m.
    stageVias: {
      // e03: sampled every 3 km from the track. One waypoint at its high point
      // gave 10.7 km against a GPX 12.3; these three give 12.8 (+4%). Denser
      // sampling converges on the same 12.8, so three is the whole gain.
      'node/26902437': [
        { lat: 47.57816, lon: 12.23693, note: 'GPX @3 km, 1335 m' },
        { lat: 47.57471, lon: 12.20688, note: 'GPX @6 km, 1169 m' },
        { lat: 47.58309, lon: 12.19511, note: 'GPX @9 km, 816 m' },
      ],
      'node/95823780': [
        { lat: 47.54949, lon: 12.05881, note: 'Hundsalmjoch, 1642 m' },
        { lat: 47.54018, lon: 12.03776, note: 'Ascent toward Buchacker, 1623 m' },
      ],
      'manual/gwercherwirt': [
        { lat: 47.5142, lon: 11.96086, note: 'Ridge above Brandenberg, 1742 m' },
      ],
      // e06: two summit waypoints took it 13.0 → 16.1 km against an effective
      // reference of 19.0 (track 18.0 + the 1.0 km its end sits from our
      // Steinberg stop). Sampling every 2 km instead gives 18.3 km / +1094 m —
      // −4%. This is the most heavily pinned leg in the file; see the note on
      // waypoint density below.
      'node/240048593': [
        { lat: 47.52055, lon: 11.88462, note: 'GPX @2 km, 828 m' },
        { lat: 47.51683, lon: 11.89064, note: 'GPX @4 km, 949 m' },
        { lat: 47.50431, lon: 11.88059, note: 'GPX @6 km, 953 m' },
        { lat: 47.50549, lon: 11.85903, note: 'GPX @8 km, 1223 m' },
        { lat: 47.50814, lon: 11.84376, note: 'GPX @10 km, 1113 m' },
        { lat: 47.5154, lon: 11.83536, note: 'GPX @12 km, 962 m' },
        { lat: 47.51258, lon: 11.81471, note: 'GPX @14 km, 894 m' },
        { lat: 47.51824, lon: 11.80474, note: 'GPX @16 km, 1038 m' },
      ],
      // e08: 22.1 km unpinned against an effective 19.1 (track 17.0 + the 2.1 km
      // its start sits from the Erfurter Hütte). Three anchors bring it to 20.8;
      // denser sampling does not go below that, so the residual +9% is BRouter's
      // own line from the hut to where the track begins.
      'way/29269844': [
        { lat: 47.43439, lon: 11.70588, note: 'GPX @4 km, 926 m' },
        { lat: 47.43043, lon: 11.65922, note: 'GPX @8 km, 1040 m' },
        { lat: 47.40766, lon: 11.62197, note: 'GPX @12 km, 1230 m' },
      ],
    },
    // ✅ e08 Erfurter→Lamsenjochhütte needs NOTHING despite reading 22.1 km with
    // no published figure to check. Its GPX confirms the line: peak 1951 vs the
    // track's 1946, ascent +1136 vs +1111. The track STARTS 2.1 km from our
    // Erfurter Hütte, which accounts for most of the 22.1 vs 17.0 difference.
    // Matching peak AND ascent with an explained endpoint offset is enough.
    //
    // The Tirol section as visittirol.nl publishes it (etappes 1–12).
    stages: [
      'St. Johann in Tirol', 'Gaudeamushütte', 'Kaindlhütte', 'Kufstein',
      'Gasthof Buchacker', 'Pinegg', 'Steinberg am Rofan', 'Erfurter Hütte',
      'Lamsenjochhütte', 'Falkenhütte', 'Karwendelhaus', 'Hallerangerhaus',
      'Pfeishütte', 'Innsbruck',
    ],
    // ⚠️ This route reported 1/12 for weeks. That was a WRONG FIRST ANCHOR, not
    // missing huts: "St. Johann" matched *Das Johann* in Vorarlberg, 169 km away,
    // so every later stage failed the chain test even though all of them are
    // exact name matches. Check stage 1 before believing any of the rest.
    //
    // Gruttenhütte, Solsteinhaus and Ehrwald are gone: they are not on the
    // published Tirol stages, they were resolver guesses of mine.
    stageIds: [
      'node/32463266', // St. Johann in Tirol, 659 m (NOT "Das Johann")
      'way/83191775', // Gaudeamushütte, 1263 m
      'way/83191820', // Kaindlhütte, 1293 m
      'node/26902437', // Kufstein
      'node/95823780', // Almgasthof Buchacker
      // Hand-entered — genuinely absent from OSM lodging, see manualPlaces.ts.
      'manual/gwercherwirt', // Gasthof Gwercherwirt, Pinegg
      // The published stage 6 finishes at Steinberg am Rofan and stage 7 starts
      // from the Jausenstation Waldhäusl 1 km away, so the OVERNIGHT is the
      // village. It only became available once the villages refetch completed;
      // Waldhäusl (way/127671485) stood in for it until then.
      'node/240048593', // Steinberg am Rofan, 1010 m
      'way/95667789', // Erfurter Hütte, 1834 m
      'way/29269844', // Lamsenjochhütte, 1953 m
      'way/26960869', // Falkenhütte, 1846 m
      'way/26959900', // Karwendelhaus, 1765 m
      'way/119196451', // Hallerangerhaus, 1768 m
      'way/117889584', // Pfeishütte, 1950 m
      // ⚠️ The stage is the CITY of Innsbruck, not the Innsbrucker Hütte — which
      // is a hut in the Stubai on the far side of it. Pointing there sent the
      // Karwendel Höhenweg 156 km against a published 65.
      'node/34840064', // Innsbruck, 574 m
    ],
  },
  {
    id: 'berliner-hoehenweg',
    name: 'Berliner Höhenweg',
    country: 'Austria',
    where: 'Zillertal Alps',
    // ⚠️ THE +22% THAT WASN'T — and the explanation was wrong too. This read
    // "70 km" from an unknown source. bookatrekking, the itinerary this came
    // from, publishes "approximately 85 kilometres" and "more than 6600 m" of
    // ascent for exactly these eight stages. We measure 87 km / +7079 m: +2%.
    //
    // ⚠️ I previously "explained" the gap by noting our six HUT-TO-HUT legs sum
    // to 70.7 km, and called the 70 km figure hut-to-hut. That arithmetic was a
    // coincidence and the conclusion was unfounded — the source says 85 km for
    // the whole thing, valley legs included. A tidy explanation that happens to
    // fit is not evidence; the source was one fetch away the whole time.
    //
    // ✅ ALL EIGHT LEGS ARE NOW REFERENCED, and NOT ONE needs a waypoint. Seven
    // are against the user's GPX tracks, one against a visittirol stage page:
    //   Mayrhofen→Karl-von-Edel     8.7 vs  8.2 km (track 7.5 + 0.7 km start gap)
    //   Karl-von-Edel→Kasseler     13.2 vs 13.3    Kasseler→Greizer   9.6 vs 9.8
    //   Greizer→Berliner           10.7 vs 10.8    Berliner→Furtschagl 8.5 vs 8.1
    //   Furtschaglhaus→Friesenberg 14.9 vs 14.3    Friesenberg→Gams  14.7 vs 14.2
    //   Gamshütte→Finkenberg        6.5 vs  6.8
    // Total 86.8 vs 85.5 km — **+1.5%** — which also corroborates bookatrekking's
    // "approximately 85 kilometres" almost exactly.
    //
    // ⚠️ Berliner→Furtschaglhaus crosses the SCHÖNBICHLER HORN: the track peaks
    // at 3077 m and our line at 3115. This is the leg once suspected of detouring
    // AROUND it — it never did. Several legs here were checked with 2 km sampling
    // that left our line unchanged, i.e. we already follow the recorded corridor.
    //
    // ⚠️ Greizer→Berliner shows the references disagreeing: visittirol publishes
    // 10.2 km, the track measures 10.8, we sit at 10.7. The track wins — see the
    // Bärentrek note about operator tables.
    length: "~85 km",
    days: '7–8 days',
    difficulty: "Difficult",
    blurb: 'A high circuit of the Zillertal, hut to hut.',
    regionId: 'tirol-otztal-zillertal',
    stages: [
      'Mayrhofen', 'Karl von Edelhütte', 'Kasseler Hütte', 'Greizer Hütte',
      'Berliner Hütte', 'Furtschaglhaus', 'Friesenberghaus', 'Gamshütte',
      'Finkenberg',
    ],
    // All nine resolve by exact name. They were reported missing for weeks only
    // because the resolver probed the LAST word — "hutte" — and drowned.
    //
    // ⚠️ The old warning here — "hiking-beta won't cross the Schönbichler Horn,
    // so it detours; total 147 km vs a published 70; do not present its distance
    // as an estimate" — is RESOLVED and kept only as history. The T3 ceiling that
    // caused it is gone (the walker sets `maxSac`, default T6), and the 70 km it
    // was measured against was the hut-to-hut figure anyway. See `length`.
    //
    // ⚠️ Furtschaglhaus→Friesenberghaus takes a LOW variant without a waypoint:
    // 13.9 km / +718 m, where the GPX of the stage is 14.3 km / +973 m (both at
    // comparable smoothing). Right length, too flat — a lower line of similar
    // distance. The via below pulls it onto the recorded one at 14.9 km / +895 m.
    // That trades +4% distance for closing two thirds of the ascent gap, which
    // is the dimension that was actually wrong — an extra 175 m of climbing is
    // roughly 30 minutes a walker would otherwise not be told about.
    stageVias: {
      'way/178754385': [
        { lat: 47.03897, lon: 11.68674, note: 'Schlegeis side, on the climb to Friesenberghaus (2284 m)' },
      ],
    },
    stageIds: [
      // Published direction: Mayrhofen anticlockwise, opening with the climb to
      // the Karl-von-Edel-Hütte. Olpererhütte is NOT on the published itinerary —
      // day 6 runs Furtschaglhaus→Friesenberghaus direct.
      //
      // ⚠️ Karl-von-Edel-Hütte was reported "not in the data". It was there all
      // along as way/141323531; a name search for "edelh" missed it because OSM
      // hyphenates it "Edel-Hütte". Search by proximity, not by name.
      'node/240087857', // Mayrhofen, 633 m — start
      'way/141323531', // Karl-von-Edel-Hütte, 2238 m
      'way/59484532', // Kasseler Hütte, 2177 m (the Zillertal one — there is a
                      // second Kasseler Hütte in hohe-tauern, 2274 m)
      'way/124262161', // Greizer Hütte, 2227 m
      'node/7884886401', // Berliner Hütte, 2042 m
      'way/149548194', // Furtschaglhaus, 2295 m
      'way/178754385', // Friesenberghaus, 2498 m
      'way/39727697', // Gamshütte, 1921 m
      'node/240073341', // Finkenberg — finish
    ],
  },
  {
    id: 'stubaier-hoehenweg',
    name: 'Stubaier Höhenweg',
    country: 'Austria',
    where: 'Stubai Alps',
    // ⚠️ WAS "100 km" AND THAT WAS THE ERROR, not the route. bookatrekking — the
    // source this itinerary came from — publishes 78.6 km over these nine stages.
    // Measured against the right figure the route is +6%, not −17%, and the
    // months spent hunting a missing 17 km were spent hunting nothing.
    // ⚠️ Check the SOURCE's total before trusting a `length` you didn't take from
    // it. Three routes here carried a figure from somewhere else entirely.
    length: "78.6 km",
    days: '8–9 days',
    blurb: 'A full circuit of the Stubai valley head.',
    regionId: 'tirol-otztal-zillertal',
    // Per-stage against bookatrekking, 2026-09-14 — eight of nine within 8%:
    //   Neustift→Starkenburger      6.1 vs  5.7    Franz-Senn→N.Regensburger  9.2 vs  9.2
    //   Starkenburger→Franz-Senn   15.5 vs 15.5    N.Regensburger→Dresdner   12.5 vs 13.5
    //   Dresdner→Sulzenau           5.1 vs  5.2    Sulzenau→Nürnberger        4.5 vs  4.5
    //   Nürnberger→Bremer           5.8 vs  5.8    Bremer→Innsbrucker        11.5 vs 10.4
    //
    // ⚠️ The one real gap is the LAST leg: Innsbrucker→Neustift 12.8 vs 8.8 km.
    // The published stage is "Innsbrucker Hütte → Elferlifte/Neustift" — it ends
    // at the ELFER LIFT station, not in the village, so the 4 km we add is the
    // walk down that the itinerary rides. Not an error; a different endpoint.
    //
    // ⚠️ THE −17% IS NOT IN THESE THREE LEGS — don't re-suspect them. All three
    // were checked against the user's AllTrails GPX and match to 0.1 km:
    //
    //   Starkenburger→Franz-Senn   15.4 km (GPX 15.4), peak 2562 m vs GPX 2580
    //   Sulzenau→Nürnberger         4.5 km (GPX 4.5), +472 m vs +420–454
    //   Nürnberger→Bremer           5.8 km (GPX 5.8), +604 m vs +544–656
    //
    // The short middle legs were flagged here as "suspiciously short, the
    // published stage goes over the Niederl / Simmingjöchl" — they are simply
    // short stages, and we already cross those passes. Adding a waypoint at the
    // GPX high point changes the first leg not at all, which is the proof that
    // it already takes that line.
    //
    // So the gap to a published 100 km sits in the six UNVERIFIED legs, and the
    // method is sound: three independent legs reproducing exactly rules out any
    // systematic under-measurement. See [[classic-routes-backlog]] for what to
    // ask for next.
    stages: [
      'Neustift', 'Starkenburger Hütte', 'Franz-Senn-Hütte',
      'Neue Regensburger Hütte', 'Dresdner Hütte', 'Sulzenauhütte',
      'Nürnberger Hütte', 'Bremer Hütte', 'Innsbrucker Hütte', 'Neustift',
    ],
    stageIds: [
      'way/103199000', // Sporthotel Neustift, 979 m (the village base)
      'way/84674198', // Starkenburger Hütte, 2237 m
      'way/84547654', // Franz-Senn-Hütte, 2147 m
      'way/168890140', // Neue Regensburger Hütte, 2286 m
      'way/103209591', // Dresdner Hütte, 2308 m
      'way/117966153', // Sulzenauhütte, 2191 m
      'way/172609525', // Nürnberger Hütte, 2278 m
      'way/477497580', // Bremer Hütte, 2413 m
      'way/27028455', // Innsbrucker Hütte, 2369 m
      // Day 9 closes the circuit back down to Neustift via the Elferlifte. This
      // makes the route a ROUND TRIP — Neustift appears first and last, which the
      // app handles (one id can map to several day numbers).
      'way/103199000', // Sporthotel Neustift, 979 m — closes the loop
    ],
  },
  {
    id: 'schladminger-tauern',
    name: 'Schladminger Tauern Höhenweg',
    country: 'Austria',
    where: 'Schladminger Tauern',
    // ⚠️ WAS "87 km" — the fifth `length` in this file found to be wrong, and
    // the −13% it produced was never a routing defect. huttentochten publishes
    // HOURS only, no distances; the 87 came from somewhere else. The user's
    // seven AllTrails tracks sum to 78.1 km, and we measure 77.0: **−1%**.
    length: "78.1 km",
    days: '7 days',
    blurb: 'Lake-strewn ridges south of Schladming.',
    regionId: 'salzburg-dachstein',
    // ⚠️ STOPS AND VIAS COME FROM THE USER'S GPX SET, which overruled the
    // earlier huttentochten stop list. Per-stage after that, every leg is within
    // 8% and five are within 1%:
    //   Hochwurzen→Giglachsee   11.5 vs 12.5   Giglachsee→Keinprecht  7.2 vs 7.2
    //   Keinprecht→Golling       8.9 vs  8.9   Golling→Preintaler     8.4 vs 8.3
    //   Preintaler→Breitlahn    11.3 vs 10.6   Breitlahn→Schober     17.3 vs 18.4
    //   Schober→St. Nikolai     12.3 vs 12.2
    //
    // ⚠️ Do NOT infer a missing pass from the published TIMES. They are
    // internally inconsistent: 7 h for stage 7, which is 12 km losing 530 m.
    // Measuring against them suggested five legs were short; the tracks showed
    // only one was.
    stages: [
      'Hochwurzenhütte', 'Giglachsee Hütte', 'Keinprecht-Hütte',
      'Gollinghütte', 'Preintalerhütte', 'Breitlahnhütte', 'Rudolf-Schober-Hütte',
      'St. Nikolai im Sölktal',
    ],
    // HOCHWURZENHÜTTE (~1850 m, at the top of the Hochwurzen) is absent from
    // OSM; only the valley "Appartements Hochwurzen" (1088 m) is in the data, so
    // it stays hand-entered. Its coordinate sits 33 m from the stage-1 track.
    //
    // ⚠️ THE FINISH WAS IN THE WRONG VALLEY. It read "Sölktal" and resolved to
    // the Steirischer Bodensee — which is real, and is a Sölktal, but the
    // KLEINSÖLK one. Rudolf-Schober sits in GROSSSÖLK, so the last day crossed a
    // ridge between two valleys: 17.6 km straight, 39.9 km routed, and the route
    // totalled 114 km against a published 87. The published stage 7 finishes at
    // St. Nikolai im Sölktal, down the Grosssölk valley, and a GPX of it
    // measures 12.2 km / +777 m — we route 12.3 km / +664 m.
    //
    // The lesson is not "check the valley". It is that a stage named only by its
    // VALLEY ("Sölktal") can't be verified, and resolving one anyway produced a
    // stop 17 km from where walkers actually sleep. A stage that doesn't name a
    // place needs the source consulted, not a best guess.
    // ⚠️ Stage 4 ran through the VALLEY. Gollinghütte→Preintalerhütte measured
    // 11.2 km / +595 m with a peak of 1657 m — the two huts are at 1644 and
    // 1657 m, so the line never climbed above either of them and simply
    // contoured round. The published stage crosses a 2598 m saddle. Pinned to
    // the GPX's own high point it is 8.4 km / +1001 m / peak 2610 m against a
    // track of 8.3 km / +975–1023 m / peak 2598: right on all three.
    //
    // ⚠️ Stage 2 needed no waypoint — it needed the right STOP. It read −14%
    // (6.2 vs 7.2 km) and a waypoint at the track's 2433 m Rotmandl changed
    // nothing, because our line already peaked at 2451 m and crossed it. The
    // gap was the START: we began at the Ignaz-Mattis-Hütte, 978 m from where
    // the track begins. Moving to the Giglachsee Hütte made it 7.2 vs 7.2.
    //
    // Before adding a waypoint, check the ENDPOINTS. A leg can be the right
    // shape and the wrong length simply because it starts in the wrong place.
    stageVias: {
      'node/460355329': [
        { lat: 47.28913, lon: 13.78843, note: 'Saddle above the Gollingwinkel, 2598 m' },
      ],
    },
    stageIds: [
      'manual/hochwurzenhuette', // Hochwurzenhütte (hand-entered)
      // ⚠️ THE GIGLACHSEE HÜTTE, NOT THE IGNAZ-MATTIS-HÜTTE — and the GPX set
      // disagrees with itself here, so this is worth stating. Stage 1 is TITLED
      // "Hochwurzen – Ignaz Mattis Hut", but its final coordinate sits 10 m from
      // node/417326835 "Giglachsee Hütte" (1955 m) and 978 m from the
      // Ignaz-Mattis-Hütte (1986 m); stage 2 then starts from "Giglachseen".
      // Two alpine huts share the lake shore and their OSM ids differ by one
      // digit. The user's instruction was to take the endpoints over the earlier
      // stops, so the COORDINATE wins over the title.
      'node/417326835', // Giglachsee Hütte, 1955 m
      'node/960531683', // Keinprechthütte, 1872 m
      'node/460361180', // Gollinghütte, 1642 m
      'node/460355329', // Preintalerhütte, 1657 m
      // Stage 5's finish. Its absence is why Preintaler→Schober measured 33.5 km:
      // that was two published days walked as one. Its hand-entered coordinate
      // matches the stage 6 GPX's first point to five decimals.
      // ⚠️ BREITLAHNHÜTTE REPLACES PUTZENTALALM. The GPX set's main stages 5 and
      // 6 run Preintalerhütte → Breitlahnhütte → Rudolf-Schober (10.6 + 18.4 km);
      // the Putzentalalm chain is labelled "Alternative Route" on stage 6. This
      // also retires a hand-entered stop in favour of a real OSM one 20 m from
      // the track — `manual/putzentalalm` stays in manualPlaces.ts because the
      // alternative is real and the user supplied it, but no route uses it now.
      'way/177949546', // Breitlahnhütte, 1071 m
      'way/230413934', // Rudolf-Schober-Hütte, 1667 m
      // The VILLAGE, matching how every other village finish here is recorded
      // (Scharnitz, Belluno, Innsbruck). "Zum Gamsjäger" (node/1359132413,
      // 1125 m) is the actual guesthouse 30 m away, and its elevation matches
      // the GPX's final point at 1124 m — which is what confirms this location.
      'node/240070701', // Sankt Nikolai im Sölktal
    ],
  },
  {
    id: 'karwendel-hoehenweg',
    name: 'Karwendel Höhenweg',
    country: 'Austria',
    where: 'Karwendel',
    // huttentochten's six stages sum to 66.9 km; the "65 km" carried before was
    // close but unsourced. (huttentochten.nl 302s to a session check and cannot
    // be fetched — this table came from the user reading the page.)
    length: "66.9 km",
    days: '6 days',
    blurb: 'Limestone walls and remote valleys north of Innsbruck.',
    regionId: 'tirol-otztal-zillertal',
    // Per-stage reference, and what we measure (2026-09-14):
    //   1 Reith→Nördlinger      6.5 km +1130 | ours  5.3 +1114
    //   2 Nördlinger→Solstein   6.7 km + 370 | ours  6.4 + 414
    //   3 Solsteinhaus→Pfeis   16.5 km +1500 | ours 14.5 + 744   ⚠
    //   4 Pfeishütte→Bettelwurf 8.9 km + 590 | ours  9.1 + 609
    //   5 Bettelwurf→Halleranger 9.0 km +800 | ours  5.9 + 190   ⚠
    //   6 Halleranger→Scharnitz 19.3 km + 30 | ours 20.0 + 105
    //
    // ⚠️ LEGS 3 AND 5 WERE REAL DEFECTS, now fixed from the user's GPX tracks —
    // both were short on distance AND far short on climb, the signature of a
    // lower line skipping the high crossing:
    //
    //   · Leg 5 was the worst on the route: 5.9 km / +190 m against a track of
    //     9.8 km / +942 m, peaking at 2185 m where the stage crosses 2723 m. One
    //     waypoint fixes it completely — 9.8 km / +847 m / peak 2716 m.
    //   · Leg 3 ran 14.5 km / +744 m against a track of 18.0 km / +1800 m,
    //     peaking at 1920 m. Its track crosses six tops; pinning two of them
    //     (2231 m and 2284 m) gives 17.6 km / +1656 m. The other four are
    //     redundant — the route already passes through them once those two are
    //     set, which is why only two are kept.
    //
    // Note the two references disagree: huttentochten says leg 3 is 16.5 km /
    // +1500 m, the track says 18.0 / +1800. We sit between them, nearer the
    // track. Where a table and a track disagree, the track wins.
    //
    // ✅ LEG 1 IS NOT WRONG — settled 2026-09-15 with the user's GPX, and worth
    // stating because it reads −18% and will look broken to the next reader.
    // Track 6.5 km / +1134 m / peak 2231; ours 5.3 km / +1114 m / peak 2241.
    // Ascent within 2%, peak within 10 m, and sampling the track at 2 km AND
    // 3 km intervals leaves our line completely unchanged — so we already follow
    // that corridor. The track's first kilometre zigzags back and forth
    // repeatedly (switchbacks, or recording noise); BRouter draws it straight.
    // Same shape as Via Alpina's Gstaad→Château-d'Oex. No waypoint helps and
    // none is wanted: pinning it would lock a route for no gain.
    stageVias: {
      'way/117889584': [
        { lat: 47.30532, lon: 11.34982, note: 'Erlsattel ridge, 2231 m' },
        { lat: 47.31227, lon: 11.38561, note: 'Stempeljoch approach, 2284 m' },
      ],
      'way/119196451': [
        { lat: 47.34421, lon: 11.51962, note: 'Lafatscher Joch ridge, 2723 m' },
      ],
    },
    stages: [
      'Reith bei Seefeld', 'Nördlinger Hütte', 'Solsteinhaus', 'Pfeishütte',
      'Bettelwurfhütte', 'Hallerangerhaus', 'Scharnitz',
    ],
    // ⚠️ Reported as 1/6 for weeks — a WRONG FIRST ANCHOR, not missing huts.
    // "Reith" is a substring of "B-reith-orn", so it matched Hotel Breithorn in
    // the Swiss Valais, 340 km away, and every later stage then failed the chain
    // test despite being an exact name match.
    // ⚠️ REPLACED WHOLESALE. The old chain (Lamsenjoch → Falkenhütte →
    // Karwendelhaus → Innsbruck) is not this route — it is the Adlerweg's middle,
    // and it measured 121 km against a published 65 because it doubled back
    // across the range. huttentochten.nl's six stages run cleanly west to east
    // and finish down the Isar valley to Scharnitz.
    stageIds: [
      'node/240105011', // Reith bei Seefeld, 1130 m — start
      'way/166643728', // Nördlinger Hütte, 2238 m
      'way/26716681', // Solsteinhaus, 1828 m
      'way/117889584', // Pfeishütte, 1950 m
      'way/148049142', // Bettelwurfhütte, 2077 m
      'way/119196451', // Hallerangerhaus, 1768 m
      'node/75680891', // Scharnitz — finish
    ],
  },
  // ⚠️ These two REPLACE the old 'slovenian-mountain-trail' entry (removed
  // 2026-08-25). That route was unusable as authored: 600 km listed as 11
  // "stages", two of which ("Kamnik Alps", "Triglav National Park") were section
  // headings rather than places to sleep, so it could never resolve to a walkable
  // chain. These are real published itineraries with real overnight stops.
  {
    id: 'julian-alps-traverse',
    name: 'Julian Alps Traverse',
    country: 'Slovenia',
    where: 'Kranjska Gora to Tolmin',
    // ⚠️ THE +56% WAS A COMPARISON ARTEFACT. bookatrekking's published total of
    // 44.8 km is EXACTLY the sum of its five stated stages (9 + 8 + 8 + 7.8 +
    // 12 = 44.8). Its sixth stage, Planinski dom → Tolmin, carries no distance at
    // all — only "+1000 m / −2000 m". So the total never covered the whole walk,
    // and measuring our six legs against it compared six days to five.
    //
    // Against the five comparable stages we are 49.0 vs 44.8 km — **+9%**. The
    // Krn day adds 21.4 km, giving ~70 km for the route as it loads.
    length: "~70 km (published 44.8 km covers 5 of 6 stages)",
    days: '8 days',
    blurb: 'Over the Vršič pass and under Triglav, north to south.',
    regionId: 'julian-alps-slovenia',
    stages: [
      'Kranjska Gora', 'Poštarski dom na Vršiču',
      'Pogačnikov dom na Kriških podih', 'Koča na Doliču',
      'Koča pri Triglavskih jezerih', 'Planinski dom pri Krnskih jezerih',
      'Tolmin',
    ],
    // Every hut's bundled elevation matches the published figure exactly
    // (1688 / 2050 / 2151 / 1685 / 1385 m), which is the check that matters.
    // The published day 8 is a transfer to Bled, not a walk, so it's omitted.
    //
    // ⚠️ The final day goes over KRN (2244 m), not round it. Left alone the leg
    // took a line peaking at 1973 m — below the summit it is supposed to cross.
    // No GPX exists for this stage; the user supplied the peak itself, and the
    // check is that the routed line now reaches 2236 m, within 8 m of Krn.
    // 21.5 km / +1010 m against 18.8 km / +713 m for the low line.
    stageVias: {
      'node/288997618': [
        { lat: 46.2661111, lon: 13.6583333, note: 'Krn summit (2244 m)' },
      ],
    },
    stageIds: [
      'node/30162721', // Kranjska Gora, 806 m
      'way/1248219139', // Poštarski dom na Vršiču, 1688 m
      'way/492850726', // Pogačnikov dom na Kriških Podih, 2050 m
      'way/1278633114', // Koča na Doliču, 2151 m
      'way/280441847', // Koča pri Triglavskih jezerih, 1685 m
      'way/293307733', // Planinski dom pri Krnskih jezerih, 1385 m
      'node/288997618', // Tolmin
    ],
  },
  {
    id: 'triglav-np-adventure',
    name: 'Triglav National Park Adventure',
    country: 'Slovenia',
    where: 'Lake Bohinj circuit',
    length: "39.2 km",
    days: '6 days',
    blurb: 'A round trip from Lake Bohinj into the heart of Triglav.',
    regionId: 'julian-alps-slovenia',
    stages: [
      'Lake Bohinj', 'Vodnikov dom na Velem polju', 'Koča na Doliču',
      'Koča pri Triglavskih jezerih', 'Lake Bohinj',
    ],
    // ⚠️ A ROUND TRIP — Ribčev Laz appears as both the first and last id. That is
    // deliberate and the app handles it: `orderById` maps one hut id to an ARRAY
    // of day numbers, so the start pin reads "1·5" instead of being overwritten.
    // Hotel Jezero itself isn't a mapped lodging; Ribčev Laz is the village it
    // stands in, 150 m away.
    stageIds: [
      'node/208843106', // Ribčev Laz (Lake Bohinj), start
      'way/1288128595', // Vodnikov dom na Velem polju, 1817 m
      'way/1278633114', // Koča na Doliču, 2151 m
      'way/280441847', // Koča pri Triglavskih jezerih, 1685 m
      'node/208843106', // Ribčev Laz again — closes the loop
    ],
  },
  {
    id: 'baerentrek',
    name: 'Bärentrek',
    country: 'Switzerland',
    where: 'Bernese Oberland',
    // ⚠️ A PUBLISHED PER-STAGE TABLE CAN BE WRONG. bookatrekking sums these six
    // stages to 100.7 km, and briefly that figure was written here — making the
    // route look +14% over and two of its legs look badly broken. GPX tracks of
    // those two legs then showed the OPPOSITE: the operator's numbers are the
    // ones that are off.
    //
    //   Meiringen→Grindelwald    bookatrekking 15.2 km | GPX 22.4 km | ours 22.2
    //   Lauterbrunnen→Griesalp   bookatrekking 16.7 km | GPX 21.6 km | ours 22.2
    //
    // Peak elevation settles it: the tracks top out at 1964 m and 2603 m — the
    // Grosse Scheidegg (1962 m) and the Sefinenfurgge (2612 m), which are the
    // passes these stages are named for. Our lines cross both.
    //
    // So this is bookatrekking's table with those two stages replaced by their
    // measured tracks: 22.4 + 20 + 21.6 + 18.4 + 16.4 + 14 = 112.8 km. We measure
    // 115 — within 2%. The original "~120 km" from an unknown source was nearer
    // the truth than the operator's own total.
    //
    // ⚠️ A GPX outranks a published number. Do not "correct" a leg to match an
    // operator's stage distance without one.
    length: "~113 km",
    days: '6–8 days',
    blurb: 'The Bear Trek across the Bernese Oberland passes.',
    regionId: 'bernese-oberland',
    // Remaining four stages match bookatrekking within 3%:
    //   Grindelwald→Lauterbrunnen  19.9 vs 20.0   Griesalp→Kandersteg 18.4 vs 18.4
    //   Kandersteg→Adelboden       16.9 vs 16.4   Adelboden→Lenk      14.2 vs 14.0
    //
    // Nearly resolvable — Engstlenalp (1836 m) and Wengen verified — but held
    // until the whole chain is checked rather than shipping part of it.
    stages: [
      'Meiringen', 'Grindelwald', 'Lauterbrunnen', 'Griesalp', 'Kandersteg',
      'Adelboden', 'Lenk',
    ],
    // Six stages per bookatrekking. Engstlenalp and Wengen are NOT on it — they
    // were my own additions and made the route 152 km against a published ~120.
    // Lauterbrunnen is the real day-2 finish.
    stageIds: [
      'node/60336653', // Meiringen
      'node/21311918', // Grindelwald
      'node/240072007', // Lauterbrunnen
      'node/13939022667', // Griesalp Hotels, 1400 m
      'node/18478561', // Kandersteg, 1174 m
      'node/18477535', // Adelboden, 1350 m
      'node/26795520', // Lenk, 1068 m
    ],
  },
  {
    id: 'via-spluga',
    name: 'Via Spluga',
    country: 'Switzerland',
    countries: ['Switzerland', 'Italy'],
    where: 'Splügen Pass',
    length: "65 km",
    days: '4 days',
    blurb: 'An historic trading route over the Splügen Pass into Italy.',
    regionId: 'graubunden-engadin',
    // ⚠️ When resolving: "Isola" and "Chiavenna" are the HAMLET and the TOWN on
    // this route. A name search returns "Rifugio Amici d'Armisola" and "Rifugio
    // Chiavenna" (2049 m) instead — both wrong.
    stages: [
      'Thusis', 'Andeer', 'Splügen', 'Montespluga', 'Campodolcino', 'Chiavenna',
    ],
    stageIds: [
      'node/1499121802', // Thusis, 720 m
      'node/254954816', // Andeer
      'node/4429008093', // Splügen, 1457 m
      // Isola is replaced: the published route drops off the pass through
      // Montespluga and Campodolcino.
      'manual/montespluga', // Montespluga, 1908 m (a place=hamlet — see manualPlaces.ts)
      'node/62516698', // Campodolcino
      'node/62516647', // Chiavenna, 333 m (the TOWN, not Rifugio Chiavenna)
    ],
  },
  {
    id: 'tour-des-muverans',
    name: 'Tour des Muverans',
    country: 'Switzerland',
    where: 'Vaud / Valais Alps',
    // ⚠️ ROUTE REPLACED 2026-09-14 from the user's four AllTrails tracks, which
    // supersede the huttentochten circuit that was here. It is a DIFFERENT walk:
    // the loop now starts and finishes at Pont-de-Nant, runs the other way round,
    // and visits Lui d'Aout and the Cabane de la Tourche instead of Cabane
    // Rambert and the Cabane du Demècre.
    //
    // That also retires an open defect rather than solving it. The old
    // Rambert→Col du Demècre leg read +31% and resisted every waypoint: eight
    // named passes were tested and only Trou à Chamorel reproduced the ascent,
    // at +58% on distance. Those two huts are no longer on the route, so the
    // question is moot — but do not read this as "fixed".
    //
    // The tracks sum to 55.7 km, which replaces an earlier "50 km" (itself a
    // correction of an unsourced "60 km").
    length: "55.7 km",
    days: '4–5 days',
    blurb: 'A compact, steep circuit above the Rhône.',
    regionId: 'valais-west',
    // Published stages, and how far each track endpoint is from the stop we use:
    //   1 Pont-de-Nant → Derborence   12.7 km  +935..1017 m  peak 2044   111 m / 19 m
    //   2 Derborence → Lui d'Aout     17.9 km  +1408..1570  peak 2562    36 m /  8 m
    //   3 Lui d'Aout → Tourche        14.8 km  +1029..1366  peak 2446     9 m / 37 m
    //   4 Tourche → Pont-de-Nant      10.3 km   +517..558   peak 2633    28 m / 111 m
    stages: [
      'Pont-de-Nant', 'Derborence', "Lui d'Aout", 'Cabane de la Tourche',
      'Pont-de-Nant',
    ],
    // Two legs needed pinning, and each was wrong in the opposite direction —
    // which is why distance alone would have diagnosed neither.
    //
    //   · Étape 3 ran 10.9 km against 14.8 while peaking at 2940 m, ABOVE the
    //     track's own 2446 m. Too short because it went too HIGH, over ground
    //     the stage contours below. The Col du Demècre pulls it onto the line:
    //     14.8 km / +1210 m / peak 2455 m. (The Col du Fenestral is also on the
    //     track at 2446 m, but is redundant — the Demècre waypoint alone
    //     produces the identical route, so only it is kept.)
    //   · Étape 4 ran 10.1 km climbing just +161 m and peaking at 2186 m, i.e.
    //     straight down the valley, where the stage first crosses a 2633 m
    //     saddle. Pinned: 10.4 km / +487 m / peak 2642 m.
    //
    // ⚠️ The Col du Demècre here is the SAME saddle (46.17394, 7.08156) that the
    // retired route was investigated against — it was never the problem there,
    // and it is the answer here.
    stageVias: {
      'way/98248138': [
        { lat: 46.17394, lon: 7.08156, note: 'Col du Demècre, 2374 m on the track' },
      ],
      'node/7844208985': [
        { lat: 46.20963, lon: 7.07092, note: 'Saddle near the Col des Martinets, 2633 m' },
      ],
    },
    // "Derborence" is the VALLEY; the lodging in it is named Refuge du Lac,
    // which is why a name search found nothing.
    // ⚠️ A ROUND TRIP — Pont-de-Nant appears as both first and last id. The app
    // handles that: `orderById` maps one hut id to an ARRAY of day numbers, so
    // the start pin reads "1·5" instead of being overwritten.
    stageIds: [
      'node/7844208985', // Auberge et Restaurant du Pont de Nant, 1253 m — start
      'node/6920281757', // Refuge du Lac, Derborence, 1462 m
      'node/6913946927', // Lui d'Aout, 1957 m
      'way/98248138', // Cabane de la Tourche, 2198 m
      'node/7844208985', // Pont-de-Nant again — closes the loop
    ],
  },

  {
    id: 'gr54-ecrins',
    name: 'GR54 – Tour des Écrins',
    country: 'France',
    where: 'Écrins',
    // ⚠️ 180 km was the FULL 14-stage loop back to La Grave. Since the finish
    // moved to Le Bourg-d'Oisans we walk stages 1–11 plus étape 13, which the
    // huttentochten table sums to 163.2 km (144 + 19.2). We measure 164: +0.5%.
    length: "163.2 km (La Grave to Le Bourg-d'Oisans)",
    days: '10–12 days',
    blurb: 'A demanding traverse of the Écrins massif.',
    regionId: 'ecrins',
    stages: [
      'La Grave', "Refuge de l'Alpe du Villar d'Arène", 'Monêtier-les-Bains',
      'Vallouise', 'Refuge du Pré de la Chaumette', 'Refuge Vallonpierre',
      'La Chapelle-en-Valgaudémar', "Refuge de l'Olan", 'Refuge des Souffles',
      'Désert de Valjouffrey', 'Valsenestre', 'Refuge de la Muzelle',
      "Le Bourg-d'Oisans",
    ],
    // "Valsenestre" is a hamlet with no OSM node; the stop there is its gîte
    // d'étape. NOT a loop any more — see the finish note in stageIds. The previous 8-stop version
    // skipped the whole western half of the massif, which is why Pré de Madame
    // Carle → Valsenestre had to route 96.8 km around it.
    //
    // ⚠️ Étape 11 crosses the COL DE CÔTE BELLE (2290 m). Without the waypoint
    // the leg ran 13.5 km with +484 m, peaking well below the col — LONGER than
    // the real stage and half the climb, because it contoured round instead of
    // going over. A GPX of the stage is 11.7 km / +1042 m peaking at 2291 m;
    // this line is 11.1 km / +1023 m peaking at 2291 m exactly. A leg that is
    // both longer and flatter than the published one is the clearest signature
    // of a col being avoided.
    // Per-stage against huttentochten (read from the page by the user; the site
    // 302s to a session check and cannot be fetched). 12 of 14 legs within 8%,
    // and the ASCENTS are unusually close — six within 1%. Total 181.9 vs
    // 187.1 km, −3%. The stop swaps the user made all sit on published stage
    // ends: Hôtel du Mont Olan = La Chapelle-en-Valgaudémar, Gîte Les Arias =
    // Désert-en-Valjouffrey, Gîte d'étape le Béranger = Valsenestre.
    stageVias: {
      'node/1856153422': [
        { lat: 44.89248, lon: 6.07982, note: 'Col de Côte Belle (2290 m)' },
      ],
      // ⚠️ THE NAMED COL WINS OVER THE BETTER NUMBERS. Monêtier→Vallouise ran
      // 20.5 km / +1005 m against a published 24.0 / +1347, and the stage is
      // titled "Monetier les bains – Col des Grangettes – Vallouise". Two cols
      // sit 800 m apart here, and routing via the Col de la Montagnolle (2722 m)
      // fits the numbers almost exactly — 23.9 km / +1396 m — while the Col des
      // Grangettes gives 21.7 km / +1259 m, still −10%/−7%.
      //
      // Grangettes is what the source names, and our line now peaks at 2679 m
      // against the col's 2685, so we genuinely cross it. Picking Montagnolle
      // because the arithmetic is prettier would be choosing a col the itinerary
      // does not mention — the same error as pinning Trou à Chamorel on the old
      // Muverans leg because its ascent matched. Forcing BOTH cols overshoots to
      // 28.2 km, so they are not both on the line.
      'node/32522128': [
        { lat: 44.93775, lon: 6.47761, note: 'Col des Grangettes, 2685 m' },
      ],
    },
    stageIds: [
      'node/264599747', // La Grave — start
      'way/149039802', // Refuge de l'Alpe de Villar-d'Arène, 2071 m
      'node/404352344', // Le Monêtier-les-Bains
      'node/32522128', // Vallouise
      'way/140893689', // Refuge du Pré La Chaumette, 1803 m
      'way/403948036', // Refuge de Vallonpierre, 2262 m
      // La Chapelle-en-Valgaudémar is a commune, not lodging; this is the hotel.
      'node/5058146536', // Hôtel du Mont Olan, 1095 m
      'way/757524503', // Refuge de l'Olan, 2344 m
      'way/757524338', // Refuge des Souffles, 1969 m
      'manual/gite-les-arias', // Gîte Les Arias, Désert-en-Valjouffrey
      'node/1856153422', // Gîte d'étape le Béranger, Valsenestre
      'node/484896953', // Refuge de la Muzelle, 2112 m
      // ⚠️ FINISH CHANGED 2026-09-14 at the user's direction: the route now ends
      // at Le Bourg-d'Oisans instead of returning La Grave via Mizoën and the
      // Refuge des Mouterres. It is therefore NO LONGER A LOOP — La Grave is the
      // start only. Published étape 13 is "Lac de la Muzelle → Bourg d'Oisans",
      // and the user's GPX of it measures 19.2 km / +643 m / peak 2529 m, ending
      // 151 m from this node.
      //
      // This also retires the old Muzelle→Mizoën defect (17.4 vs 22.2 km with a
      // matching ascent) rather than solving it — that leg is gone.
      'node/26695761', // Le Bourg-d'Oisans — finish
    ],
  },

  // ══ PENDING — NO REGION COVERAGE AT ALL ═══════════════════════════════════
  // These need a NEW region tile in constants/region.ts before any data can be
  // fetched — they're outside every current bounding box. Adding one means
  // extending `REGIONS`, running the coverage audit, then generating.
  {
    id: 'gr20-corsica',
    name: 'GR20',
    country: 'France',
    where: 'Corsica',
    length: "180 km",
    days: '15–16 days',
    difficulty: "Very difficult",
    blurb: "Europe's toughest waymarked trail, the length of Corsica.",
    // The Cirque de la Solitude section is SAC T4+; at the default T3 ceiling
    // Carozzu→Ascu-Stagnu routed 47.9 km for a 5.3 km stage. With the alpine
    // profile it is 4.9 km.
    stages: [
      'Calenzana', 'Ortu di u Piobbu', 'Carrozzu', 'Asco Stagnu', 'Tighjettu',
      'Ciottulu di i Mori', 'Manganu', 'Petra Piana', "Refuge de l'Onda",
      'Vizzavona', 'Gîte U Fugone', 'Refuge de Prati', 'Usciolu', 'Asinau',
      'Paliri', 'Conca',
    ],
    // ⚠️⚠️ ROUTING LIMITATION — the ids are right, the LINE is not. The GR20 is
    // the hardest waymarked trail in Europe and much of it is scrambling that
    // hiking-beta won't touch, so BRouter detours into the valleys: Carozzu→
    // Ascu-Stagnu comes out at 47.9 km against a real ~6 km stage, and the whole
    // route measures 291 km against a published 180. Not safe to present as a
    // distance/duration estimate until routing can follow the real trail.
    regionId: 'corsica',
    // ⚠️ Four stages looked missing but were SPELLING VARIANTS — OSM uses the
    // Corsican forms. All four are real huts, found by searching near the
    // published coordinates instead of by name:
    //   Carrozzu → Carozzu (one r) · Haut Asco → Ascu-Stagnu
    //   Tighjettu → Tighiettu · Capannelle → E Capanelle (one n)
    // Per-stage against bookatrekking's 15-day GR20 (184.6 km). Eleven of
    // fifteen legs were already within 8%; the four below were pinned from the
    // user's GPX tracks on 2026-09-14, each against a track whose endpoints sit
    // within 31 m of our stops:
    //
    //   e04 Ascu-Stagnu→Tighiettu   6.7 → 8.6 km, peak 2218 → 2598 (track 8.2/2598)
    //   e06 Ciottulu→Manganu       20.5 → 23.3 km               (track 24.9)
    //   e09 l'Onda→Vizzavona       12.2 → 10.1 km, peak 1391 → 2113 (track 10.6/2105)
    //   e13 Usciolu→Asinau         15.8 → 19.7 km               (track 20.9)
    //
    // ⚠️ e09 was the instructive one: it read +15%, i.e. LONGER than published,
    // and was still wrong — peaking at 1391 m where the stage crosses 2105. It
    // was going the long way round at low level. Being over the published
    // distance is not evidence a leg is right.
    //
    // ⚠️ e13 matched on PEAK (2026 vs 2027) and no summit waypoint moved it:
    // the track dips to 1336 m mid-way and our line cut straight across. The fix
    // was an anchor on that dip, not on a top. When the peak already agrees,
    // sample the track's LOW points too.
    stageVias: {
      'way/437755706': [
        { lat: 42.37637, lon: 8.9376, note: 'Bocca Tumasginesca / Cirque de la Solitude rim, 2598 m' },
      ],
      'way/297485752': [
        { lat: 42.2753, lon: 8.89111, note: 'Bocca di Verghio side, 1366 m' },
      ],
      'way/692948737': [
        { lat: 42.13687, lon: 9.07691, note: 'Bocca Palmente ridge, 2105 m' },
      ],
      'way/353634247': [
        { lat: 41.88809, lon: 9.15556, note: 'Bassa di Laparo dip, 1336 m' },
      ],
    },
    stageIds: [
      'node/3736498610', // Calenzana
      'way/237852704', // Refuge de l'Ortu di u Piobbu, 1520 m
      'way/237852703', // Refuge de Carozzu, 1270 m
      'way/118990828', // Refuge d'Ascu-Stagnu (Haut Asco), 1422 m
      'way/437755706', // Refuge de Tighiettu, 1683 m
      'way/437752736', // Refuge de Ciottulu di i Mori, 1991 m
      'way/297485752', // Refuge de Manganu, 1601 m
      'way/297484188', // Refuge de Petra Piana, 1842 m
      // l'Onda sits between Petra Piana and Vizzavona and was missing.
      'way/297483737', // Refuge de l'Onda
      'way/692948737', // Le Vizzavona, 913 m
      // Vizzavona → U Fugone → Prati → Usciolu is the published sequence. U Fugone
      // is the gîte AT Capannelle (30 m from Refuge d'E Capanelle), and Prati was
      // missing altogether, which is why Capanelle→Usciolu measured 35.7 km.
      'way/305567810', // Gite U Fugone (Capannelle)
      'way/96438686', // Refuge de Prati, 1840 m
      'way/353265114', // Refuge d'Usciolu, 1750 m
      'way/353634247', // Refuge d'Asinau, 1536 m
      // ⚠️ Bavella was briefly a STOP here to force the line. Removed: it is not
      // an overnight stage, and le-gr20.fr has Asinau → Paliri as one day.
      // Under `hiking-beta` this leg measures 36.6 km against a published 15.5;
      // under `hiking-mountain` it is 16.0 km. This one needs the profile, not
      // a waypoint — see the routing note above.
      'way/354661509', // Refuge d'i Paliri, 1054 m
      'node/274064520', // Conca
    ],
  },
  {
    id: 'kungsleden',
    name: 'Kungsleden',
    country: 'Sweden',
    where: 'Lapland',
    // ⚠️ SCOPED TO WHAT WE ACTUALLY CARRY — see the identical note on the
    // Adlerweg. This read "440 km", the length of the WHOLE King's Trail
    // (Abisko–Hemavan); `stages` below is the Abisko–Nikkaluokta section, which
    // every operator sells as ~105 km. Loading 105 km of walking under a 440 km
    // label misstates the trip by a factor of four.
    length: "~105 km (Abisko–Nikkaluokta)",
    days: '6–7 days',
    blurb: 'The King’s Trail through Swedish Lapland — the classic Abisko section.',
    stages: [
      'Abisko', 'Abiskojaure', 'Alesjaure', 'Tjäktja', 'Sälka', 'Singi',
      'Kebnekaise', 'Nikkaluokta',
    ],
    regionId: 'kungsleden-north',
    // ⚠️ "Abisko" is the VILLAGE at 385 m, not Abiskojaure — a substring search
    // matches the latter first, and it is the next stage along. Getting that
    // wrong would silently delete day one.
    stageIds: [
      'node/388483157', // Abisko, 385 m — start
      'node/289406212', // Abiskojaure Fjällstuga, 490 m
      'node/289257081', // Alesjaure Fjällstuga, 790 m
      'node/1356403681', // Tjäktja Fjällstuga, 1000 m
      'node/1356403616', // Sälka Fjällstuga, 790 m
      'node/289250952', // Singi Fjällstuga, 715 m
      // The STF mountain station, not "Kebnekaise Restaurant" beside it.
      'node/289248555', // Kebnekaise fjällstation
      'node/344444258', // Nikkaluokta — finish
    ],
  },
  {
    id: 'jotunheimen-traverse',
    name: 'Jotunheimen Traverse',
    country: 'Norway',
    where: 'Jotunheimen',
    // ⚠️ ROUTE REPLACED 2026-09-14 with norwayhuttohuthiking.com's itinerary, at
    // the user's direction. It is a LOOP from Gjendesheim, and it walks Besseggen
    // on the LAST day rather than the first — the reverse of what we had. Fondsbu
    // is dropped; Gjendebu is new.
    //
    // Published stages: 22 + 16 + 15.5 + 19 + 10.5 + 14 = 97 km. (The site quotes
    // 114–117 km over 7 days because it counts an optional 12 km Galdhøpiggen
    // summit day from Spiterstulen, which is not a stage of the walk.)
    length: "97 km",
    days: '7 days',
    blurb: "Norway's highest peaks, a hut-to-hut loop from Gjendesheim.",
    stages: [
      'Gjendesheim', 'Glitterheim', 'Spiterstulen', 'Leirvassbu', 'Gjendebu',
      'Memurubu', 'Gjendesheim',
    ],
    regionId: 'jotunheimen',
    // All resolve by exact name — none contains a word for "hut", which is why
    // name-based matching found nothing until the region's data existed.
    //
    // ⚠️ A ROUND TRIP: Gjendesheim is both the first and last id. `orderById`
    // maps one hut id to an ARRAY of day numbers, so the start pin reads "1·7"
    // rather than being overwritten.
    stageVias: {
      // ⚠️ THE BESSEGGEN WAYPOINT MOVED. It used to be keyed to Memurubu, when
      // the ridge was day 1 (Gjendesheim → Memurubu). In this itinerary Besseggen
      // is the FINISH (Memurubu → Gjendesheim), so it is keyed to Gjendesheim.
      // Leaving it on Memurubu would have pinned the Gjendebu → Memurubu leg
      // instead — a different day entirely, and one that never goes near the
      // ridge. Vias are keyed by the stop a leg ARRIVES AT; reversing a route
      // re-points every one of them.
      //
      // It is VESLFJELLET, the summit, not a guessed point "on the ridge". An
      // earlier attempt at 61.5052, 8.718 was off-trail and forced a 16.6 km
      // detour; two other plausible-looking ridge coordinates put the leg on the
      // LOW north-shore path (10.8 km, +214 m, high point 1080 m), which is not
      // Besseggen at all. Peak elevation is what separates them: Veslfjellet is
      // 1743 m and this line peaks at 1738.5 m.
      'node/791106132': [
        { lat: 61.5106, lon: 8.7639, note: 'Veslfjellet (1743 m) — the Besseggen high point' },
      ],
      // ⚠️ "Via Glittertinden" — over Norway's second-highest summit. Without it
      // the leg measured 16.0 km with +294 m of climbing: the right LENGTH down
      // the Veodalen, and none of the mountain. A GPX of the stage is 15.9 km /
      // +1143 m peaking at 2461 m; this line is 15.5 km / +1086 m peaking at
      // 2451 m. Distance alone called the valley correct.
      'node/845346821': [
        { lat: 61.65119, lon: 8.55678, note: 'Glittertind summit (2452 m)' },
      ],
    },
    stageIds: [
      'node/791106132', // Gjendesheim, 994 m — start
      'node/9809293382', // Glitterheim, 1390 m
      'node/845346821', // Spiterstulen turisthytte, 1106 m
      'node/305212937', // Leirvassbu, 1410 m
      'node/288156091', // Gjendebu, 990 m
      'node/773330358', // Memurubu, 1008 m
      'node/791106132', // Gjendesheim again — closes the loop over Besseggen
    ],
  },

];

/** A route can be loaded only once its stages have verified OSM ids. */
export function isRouteReady(route: ClassicRoute): boolean {
  return (route.stageIds?.length ?? 0) > 0;
}

/**
 * Turns a curated route into real huts, in order.
 *
 * `missing` lists any stage id the bundle couldn't resolve. Callers should show
 * that rather than quietly loading a short route — a walker who taps a route and
 * silently gets six of eight stages has no way to know a day is missing.
 */
export function resolveClassicRoute(
  route: ClassicRoute,
  lookup: (id: string) => Hut | undefined,
): { huts: Hut[]; missing: string[] } {
  const huts: Hut[] = [];
  const missing: string[] = [];
  for (const id of route.stageIds ?? []) {
    const hut = lookup(id);
    if (!hut) {
      missing.push(id);
      continue;
    }
    const via = route.stageVias?.[id];
    // Copy rather than mutate: `lookup` returns the shared bundled hut, and
    // writing `via` onto it would leak into every other trip and every map pin
    // using that same object.
    if (!via) {
      huts.push(hut);
      continue;
    }
    huts.push({ ...hut, via: via.map(({ lat, lon }) => ({ lat, lon })) });
  }
  return { huts, missing };
}
