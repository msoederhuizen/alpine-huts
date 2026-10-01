/**
 * Attach rows from an outside hut list to the places the app already ships.
 *
 * ⚠️ MATCHED ON POSITION, NOT ON NAME, AND THAT IS THE WHOLE DESIGN. Outside
 * sources spell huts as a person would: "Blüemlisalphütte SAC", "Memminger
 * Hütte", with ß, umlauts, club suffixes and punctuation that OSM may or may not
 * share — and, more awkwardly, the same hut appears as "Moiryhütte" in one
 * source and "Cabane de Moiry" in another. Every source in this project matched
 * by NAME has attached the wrong building; a human review rejected 46% of the
 * Brave photo set, and the residue was always a correct name in the wrong place.
 * Every source matched by POSITION has been right.
 *
 * So the name is never the key. Two huts 40 m apart with different spellings are
 * the same hut; two huts with identical names 200 km apart are not. The name is
 * used only to CORROBORATE a positional match, never to make one — with the
 * single, loudly-guarded exception in `MAX_METRES_CORROBORATED`.
 *
 * Shared by `import-hut-database.ts` (a spreadsheet) and `import-alpenverein.ts`
 * (the Alpenverein hut register). Each of those maps its own fields; everything
 * about deciding WHICH place a row belongs to lives here, so the two cannot
 * drift apart.
 */
import type { Hut } from '../../src/types/hut';
import { distinctiveTokens, metresBetween, normalizePlaceName } from '../../src/utils/dedupePlaces';
import { MOUNTAIN_REFUGE_NAME_RE } from '../../src/utils/hutMeta';

/**
 * ⚠️ 250 m. A hut is a building, and both sources aim at the same roof — but
 * OSM may place the node on the building while a published list uses a
 * summit-book coordinate, and huts sit on ridges where a GPS fix wanders. Too
 * tight loses real matches; too loose starts pairing a hut with its neighbour,
 * and alpine huts are routinely 1–2 km apart. 250 m is comfortably inside that
 * and outside normal disagreement.
 */
export const MAX_METRES = 250;

/**
 * ⚠️ THE RADIUS WHEN THE NAMES DO NOT CORROBORATE THE MATCH. 250 m is generous
 * on purpose, and that is safe while something confirms the two records are the
 * same hut. When nothing does, the generosity is what goes wrong — so a
 * disagreeing pair has to be close enough that they can only be one building.
 *
 * The data breaks cleanly here. Every disagreement at 77 m or more was two
 * different buildings:
 *
 *   223 m  "Schladminger Hütte"   vs app "Hotel Planaihof"
 *   211 m  "Rifugio Ciampedie"    vs app "Rifugio Paolina"
 *   173 m  "Dresdner Hütte"       vs app "Zollhütte"
 *
 * and every one at 43 m or less was a single hut named in two languages, which
 * is ordinary in the Alps and must be kept:
 *
 *    12 m  "Puezhütte"            vs app "Utia de Puez"        (German / Ladin)
 *    10 m  "Moiryhütte"           vs app "Cabane de Moiry"     (German / French)
 *     7 m  "Linardhütte"          vs app "Chamanna dal Linard" (German / Romansh)
 *
 * 60 m sits in that gap, and is about what a hut building plus a GPS fix spans.
 */
export const MAX_METRES_UNCORROBORATED = 60;

/**
 * ⚠️ THE RADIUS WHEN THE NAME IS AN EXACT MATCH, WHICH RUNS THE OTHER WAY.
 * 250 m also loses real huts, because the two sources sometimes disagree about
 * where a hut is by much more than a building's width — a published coordinate
 * taken from a summit book, a valley station's address geocoded instead of the
 * hut, an OSM node on the access path. Rows sit just outside the radius with an
 * unmistakable twin inside 2 km:
 *
 *    300 m  "Simony-Hütte"                       == app "Simonyhütte"
 *    407 m  "Finsteraarhornhütte SAC"            == app "Finsteraarhornhütte"
 *   1286 m  "Hörnlihütte - Matterhorn Base Camp" == app "Hörnlihütte"
 *
 * There is exactly one Hörnlihütte, so 1.3 km is not a reason to doubt it. This
 * band is searched ONLY when nothing was found at 250 m, demands a far stronger
 * name match than `namesAgree`, and requires that match to be unique.
 */
export const MAX_METRES_CORROBORATED = 2000;

/**
 * Do these two names plausibly describe the same place?
 *
 * ⚠️ USED ONLY TO CHOOSE BETWEEN CANDIDATES ALREADY CLOSE ENOUGH, never to
 * reject a lone match. Spelling differs legitimately — ß against ss, umlauts
 * dropped, "SAC"/"DAV" present or not, hyphens. normalizePlaceName already
 * folds accents and ß; beyond that, one shared distinctive word is enough.
 */
export function namesAgree(a: string, b: string): boolean {
  const na = normalizePlaceName(a);
  const nb = normalizePlaceName(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;

  /**
   * ⚠️ COMPARE WITH THE SPACES TAKEN OUT TOO. German compounds are written
   * joined by one source and split or hyphenated by the other, and that is the
   * single commonest difference between any two of these datasets:
   *
   *   "Hofpürgl-Hütte"      vs "Hofpürglhütte"         1 m apart
   *   "Hochweißstein-Haus"  vs "Hochweißsteinhaus"    10 m apart
   *   "Almtaler Haus"       vs "Almtalerhaus"          2 m apart
   *
   * Token matching cannot see these as related — "hofpurgl" and "hutte" are
   * different words from "hofpurglhutte" — so without this every one is
   * reported as a name disagreement and buries the real mismatches.
   */
  const squash = (s: string) => s.replace(/\s+/g, '');
  const sa = squash(na);
  const sb = squash(nb);
  if (sa === sb || sa.includes(sb) || sb.includes(sa)) return true;

  const ta = new Set(distinctiveTokens(na));
  return distinctiveTokens(nb).some((t) => ta.has(t));
}

/**
 * A far stricter test than `namesAgree`, for the one case where the name is
 * carrying the whole match rather than confirming one.
 *
 * ⚠️ `namesAgree` IS DELIBERATELY LOOSE AND MUST NOT BE USED OVER A KILOMETRE.
 * It accepts a single shared distinctive token, which is right when two records
 * are already 10 m apart and wrong at 2 km, where it would pair any two huts on
 * the same mountain. This demands the whole name, once spacing and punctuation
 * are removed — that is what makes "Simony-Hütte" and "Simonyhütte" one hut.
 *
 * Containment, not just equality, because one side routinely carries an extra
 * label the other omits — "Finsteraarhornhütte SAC", "Lizumer Hütte (Sommer)",
 * "Hörnlihütte - Matterhorn Base Camp". That is also what makes it unsafe on
 * its own: see `typeCompatible`, which is always applied alongside this.
 *
 * The five-character floor keeps short names out. "Au" and "Gruben" are real
 * places, and a two-letter substring match at 2 km means nothing.
 */
export function strongNameMatch(rowName: string, hut: Hut): boolean {
  const a = squashName(rowName);
  const b = squashName(hut.name ?? '');
  if (a.length < 5 || b.length < 5) return false;
  return a === b || a.includes(b) || b.includes(a);
}

const squashName = (s: string) => normalizePlaceName(s).replace(/\s+/g, '');

/**
 * Words that mean "a building" rather than "a settlement", used ONLY by
 * `typeCompatible`.
 *
 * ⚠️ SEPARATE FROM MOUNTAIN_REFUGE_NAME_RE ON PURPOSE. That one lists names
 * that mark a genuine mountain refuge and is written to be generous in one
 * direction only — it protects real refuges from being filtered off the map, so
 * a miss there is harmless. Here a miss writes a hut's details onto a village,
 * and it missed exactly the plainest names of all: "Haus Missen",
 * "Alpenvereinshaus Molln", "Holzgauer Haus", "Bergheim Au" — none of which
 * contains "berghaus" or "schutzhaus", only a bare "Haus" or "heim".
 *
 * The end-of-word anchor is what keeps this from swallowing settlements: it
 * matches "Alpenvereinshaus" and "Berghof" while leaving "Oberhausen" and
 * "Hofern" — which are villages — alone.
 *
 * ⚠️ IT WILL KEEP MISSING ONE UNTIL SOMEBODY LOOKS. The hostel and guesthouse
 * words were added only after a review page showed "Losenstein-Jugendherberge"
 * writing its telephone number onto the VILLAGE of Losenstein, in both sources
 * at once — the list had "haus" and "hütte" but not "herberge". Adding a word
 * here is cheap and the failure it prevents is invisible, so when a review turns
 * one up, add it rather than reasoning about whether it matters.
 */
const BUILDING_WORD_RE =
  /(haus|heim|hof|hütte|hutte|htte|herberge|hostel|pension|gasthaus|gasthof|hotel|lager|alm)(?![a-zäöüß])/i;

/** Whether a row's name reads as somewhere you could stay. */
export function namesALodging(rowName: string): boolean {
  return MOUNTAIN_REFUGE_NAME_RE.test(rowName) || BUILDING_WORD_RE.test(rowName);
}

/**
 * A hut is never the village it stands in, however similar the two are called.
 *
 * ⚠️ THE COMMONEST WORD IN A HUT'S NAME IS ITS VILLAGE'S, which makes villages
 * the one kind of place a name test cannot be trusted against:
 *
 *   "Holzgauer Haus"          vs app village "Holzgau"
 *   "Haus Missen"             vs app village "Missen"
 *   "Alpenvereinshaus Molln"  vs app village "Molln"
 *
 * Each pair shares a name and sits a few hundred metres apart, so both the name
 * test and the distance test say yes, and the result is a hut's telephone
 * number shown on a village. The place type is the only signal that separates
 * them, and it is a reliable one.
 *
 * The reverse is deliberately allowed: a row that does NOT name a lodging —
 * "Hinterzarten", "Saas-Fee" — matching the village of that name is exactly
 * right, and those rows carry the local information worth having.
 */
export function typeCompatible(rowName: string, hut: Hut): boolean {
  if (hut.type !== 'village') return true;
  // Identical names are the one case where a lodging really can be the place:
  // some hamlets are named after the single house that made them.
  if (squashName(rowName) === squashName(hut.name ?? '')) return true;
  return !namesALodging(rowName);
}

export interface SourceRow {
  name: string;
  /** Other spellings, when the source offers them. Only ever corroborates. */
  aliases?: string;
  lat: number;
  lon: number;
}

/**
 * How a match came about — recorded so a human can review the risky ones first.
 *
 * ⚠️ THESE ARE NOT EQUALLY TRUSTWORTHY AND THE REVIEW MUST NOT PRETEND THEY
 * ARE. `nearest` is the plain case: the closest place, well inside the radius.
 * `redirected` and `widened` both let the NAME override or replace what
 * position said, which is the one thing this file otherwise refuses to do, so
 * every one of them deserves a human glance.
 */
export type How = 'nearest' | 'redirected' | 'widened';

export interface Claim<R> {
  row: R;
  m: number;
  how: How;
  /** For a redirect: the nearer place it was moved OFF, and how near. */
  insteadOf?: { name: string; m: number };
}

export interface MatchResult<R> {
  /** hutId -> every row that landed on it, so collisions can be seen together. */
  claims: Map<string, Claim<R>[]>;
  byId: Map<string, Hut>;
  matched: number;
  unmatched: number;
  widened: number;
  ambiguous: number;
  /** One line per match the NAME had to justify. Always worth printing. */
  widenedRows: string[];
  /** Matches moved off a nearer place onto the one that carries the name. */
  redirected: number;
  redirectedRows: string[];
}

/**
 * Decide which app place each row belongs to.
 *
 * ⚠️ NOTHING IS WRITTEN HERE; IT ONLY COLLECTS. Two rows can land on the SAME
 * place — "Ostello Fusio" and "Ostello GiovaniBosco" are both 16 m from the
 * app's "Capanna Grossalp" — and a one-pass loop would quietly let whichever
 * came last overwrite the other's phone number. Callers get the full list per
 * place and resolve it field by field.
 */
export function matchByPosition<R extends SourceRow>(rows: R[], huts: Hut[]): MatchResult<R> {
  const claims = new Map<string, Claim<R>[]>();
  let matched = 0;
  let unmatched = 0;
  let widened = 0;
  let ambiguous = 0;
  let redirected = 0;
  const widenedRows: string[] = [];
  const redirectedRows: string[] = [];

  for (const row of rows) {
    // Nearest place within the radius. Position decides; the name only breaks
    // ties between two candidates that are both close enough.
    let best: { hut: Hut; m: number } | null = null;
    let how: How = 'nearest';
    let insteadOf: { name: string; m: number } | undefined;
    for (const h of huts) {
      const m = metresBetween(row.lat, row.lon, h.lat, h.lon);
      if (m > MAX_METRES || !typeCompatible(row.name, h)) continue;
      if (!best || m < best.m) best = { hut: h, m };
      else if (Math.abs(m - best.m) < 40 && namesAgree(row.name, h.name ?? '')) best = { hut: h, m };
    }

    /**
     * ⚠️ THE NEAREST PLACE IS NOT ALWAYS THE RIGHT ONE, AND THE NAME SAYS SO.
     * Huts come in clusters: a bivouac beside a hut, a winter room beside a
     * summer one, a hotel beside the gasthof it grew out of. When the closest
     * place disagrees by name and a place a little further out matches it
     * exactly, the exact match is the hut meant.
     *
     *   "von-Schmidt-Zabierow-Hütte"  ->  "Walter-Schweitzer-Biwak"  16 m
     *                                 but "Schmidt-Zabierow Hütte"  285 m
     *
     * Writing that hut's telephone number onto the bivouac 16 m away is exactly
     * the kind of confident, invisible error this whole file exists to avoid.
     *
     * This runs whether or not something was found at 250 m, and demands the
     * same unique, whole-name match as the widening below, so it can only ever
     * move a match onto a place that unmistakably carries the row's name.
     */
    const named = huts
      .map((h) => ({ hut: h, m: metresBetween(row.lat, row.lon, h.lat, h.lon) }))
      .filter(
        (c) =>
          c.m <= MAX_METRES_CORROBORATED &&
          typeCompatible(row.name, c.hut) &&
          strongNameMatch(row.name, c.hut),
      );

    if (best && named.length === 1 && named[0].hut.id !== best.hut.id) {
      if (!namesAgree(row.name, best.hut.name ?? '')) {
        redirectedRows.push(
          `"${row.name}"  ${Math.round(best.m)} m to "${best.hut.name}"` +
            `  ->  ${Math.round(named[0].m)} m to "${named[0].hut.name}"`,
        );
        insteadOf = { name: best.hut.name ?? '(unnamed)', m: best.m };
        best = named[0];
        how = 'redirected';
        redirected++;
      }
    }

    /**
     * Nothing within 250 m — widen, but only to a place this row unmistakably
     * names, and only if there is exactly one. If two places out there match
     * the name we cannot say which is meant, and a coin toss is how a hut ends
     * up with its neighbour's telephone number.
     */
    if (!best) {
      if (named.length === 1) {
        best = named[0];
        how = 'widened';
        widened++;
        widenedRows.push(
          `${String(Math.round(named[0].m)).padStart(4)} m  "${row.name}"  ==  "${named[0].hut.name}"`,
        );
      } else if (named.length > 1) {
        ambiguous++;
      }
    }

    if (!best) {
      unmatched++;
      continue;
    }
    matched++;
    const claim: Claim<R> = { row, m: best.m, how, insteadOf };
    const list = claims.get(best.hut.id);
    if (list) list.push(claim);
    else claims.set(best.hut.id, [claim]);
  }

  return {
    claims,
    byId: new Map(huts.map((h) => [h.id, h])),
    matched,
    unmatched,
    widened,
    ambiguous,
    widenedRows,
    redirected,
    redirectedRows,
  };
}

export type Verdict =
  | { write: true; disagrees: boolean }
  | { write: false; why: 'not-a-lodging' | 'too-far-unconfirmed' };

/**
 * Should this match be written at all?
 *
 * ⚠️ NOT EVERY ROW IN A HUT LIST IS A HUT, AND THAT IS THE BIGGEST SOURCE OF
 * WRONG MATCHES. Many rows are the VALLEY BASE or the TRAIL rather than a
 * building — "Saas-Fee", "Airolo", "Vrin", "Mittenwalder Höhenweg". Their
 * coordinate is the village centre or a point on the path, and in a village
 * there is always some guesthouse within 250 m, so the matcher pairs them
 * confidently and writes a tourist office's number onto a named hotel.
 *
 * ⚠️ DISTANCE CANNOT CATCH THESE. "Nauders" matched at 134 m and "Evolène" at
 * 31 m; a village centre lands on a hotel's roof as easily as beside it. What
 * separates them is that the row does not NAME a lodging.
 *
 * A row whose name AGREES with the place is accepted whatever it is called —
 * the agreement is the evidence, and it is stronger than any heuristic here.
 */
export function corroborate(
  rowName: string,
  aliases: string | undefined,
  hut: Hut,
  metres: number,
  isPlaceholderName: (name: string) => boolean,
): Verdict {
  const agrees =
    namesAgree(rowName, hut.name ?? '') ||
    (aliases ? namesAgree(aliases, hut.name ?? '') : false);

  // A placeholder name cannot agree with anything, and a place that has none is
  // exactly what an import like this is most useful for.
  if (agrees || isPlaceholderName(hut.name ?? '')) return { write: true, disagrees: false };

  if (!namesALodging(rowName)) return { write: false, why: 'not-a-lodging' };
  if (metres > MAX_METRES_UNCORROBORATED) return { write: false, why: 'too-far-unconfirmed' };
  return { write: true, disagrees: true };
}
