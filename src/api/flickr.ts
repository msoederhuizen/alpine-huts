import { SHARED_PLACE_NAMES } from '../constants/sharedNames';
import type { Hut } from '../types/hut';
import {
  distinctiveTokens,
  normalizePlaceName,
  textNamesPlace,
} from '../utils/dedupePlaces';
import { isFallbackHutName } from '../utils/hutMeta';
import type { HutImage } from '../utils/hutImage';

/**
 * Extra hut photographs from Flickr, for the many huts Wikimedia has none of.
 *
 * ⚠️ THE HARD PART IS NOT FETCHING, IT IS DECIDING A PHOTO IS OF THE HUT.
 *
 * This app already tried proximity search once — a Wikimedia geosearch around
 * each hut — and it was removed, because "taken near a refuge" turns out to
 * describe the valley, the summit above it, a cow, and someone's lunch.
 * Distance answers "near what?", never "of what?" — so tightening the radius
 * alone would never have saved it.
 *
 * So the gate here is the NAME, and distance only ranks what the name already
 * admitted:
 *
 *   1. The hut must have a real name. Fallback labels ("Bivouac", "Unnamed
 *      shelter") and names that reduce to a building kind ("Rifugio", "Ricovero")
 *      identify nothing, so those huts get no Flickr photos at all rather than
 *      plausible-looking wrong ones.
 *   2. Every DISTINCTIVE word of the name must appear in the photo's title or
 *      tags — "Lagazuoi" from "Rifugio Lagazuoi", tolerating one typo per word.
 *      Reuses `dedupePlaces`, which solves exactly this problem for merging two
 *      OSM records of one place.
 *   3. Only then does distance rank the survivors, with a nudge for captions
 *      that also carry a lodging word, since those are more likely to show the
 *      building rather than the mountain it is named after.
 *
 * The cost of being strict is a hut with no extra photos. The cost of being
 * loose is a photo of the wrong place presented as this hut — much worse, and
 * the exact failure that got geosearch removed.
 */

/**
 * ⚠️ COMMERCIALLY SAFE LICENCES ONLY.
 *
 * Flickr licence ids: 4 = CC BY, 5 = CC BY-SA, 7 = no known copyright
 * restrictions, 8 = US Government work, 9 = CC0, 10 = Public Domain Mark.
 *
 * Deliberately EXCLUDED: 1, 2 and 3 are the NonCommercial licences, which a paid
 * or ad-supported version of this app could not use — and finding that out after
 * shipping would mean pulling photos users had already seen. 6 (BY-ND) is left
 * out too, since we display at whatever size Flickr serves and No-Derivatives is
 * an argument not worth having.
 */
const LICENCES = '4,5,7,8,9,10';

/** Human-readable name per licence id, for the credit line. */
const LICENCE_NAME: Record<string, string> = {
  '4': 'CC BY 2.0',
  '5': 'CC BY-SA 2.0',
  '7': 'No known copyright restrictions',
  '8': 'US Government work',
  '9': 'CC0 1.0',
  '10': 'Public Domain Mark 1.0',
};

/**
 * ⚠️ THE SEARCH IS DELIBERATELY NOT GEO-BOUNDED. Measured, not assumed.
 *
 * The first version passed lat/lon/radius, on the reasoning that a tight circle
 * would keep a same-named place in the next valley from ever being a candidate.
 * Against the live API that returned NOTHING for Karwendelhaus,
 * Blüemlisalphütte and Gjendebu — three of the most photographed huts in the
 * Alps — because lat/lon/radius makes Flickr search GEOTAGGED PHOTOS ONLY, and
 * most Flickr photos carry no geotag. The circle was not filtering out the
 * wrong huts so much as throwing away almost every right one.
 *
 * (The radius is also only advisory: a photo 1028 m away came back from a 1 km
 * request. So it was never the hard boundary it looked like.)
 *
 * So the name carries the identification alone, which is what it was always
 * really doing, and `geo` is still requested as an EXTRA: photos that happen to
 * carry a position get ranked by it, and an ambiguous name still demands one as
 * corroboration — see `CORROBORATION_M`.
 */

/** How close a geotagged photo must sit when the hut's name is one ambiguous
 *  word. Such a photo must ALSO be geotagged: unverifiable means not shown. */
const CORROBORATION_M = 400;

/** A photo carrying a REAL position further than this from the hut matched some
 *  other place of the same name. Deliberately loose — genuine hut photos are
 *  geotagged from where the photographer stood, several kilometres out. */
const FAR_M = 50_000;

/** Never flood the gallery — curated Wikimedia photos should stay first. */
const MAX_PHOTOS = 6;

/**
 * Single words that are NOT enough to identify a hut on their own, even though
 * `dedupePlaces` counts them as distinctive — "Edelweiss" names 57 different
 * places in this dataset, "Alpina" 69.
 *
 * ⚠️ GENERATED from the data (see constants/sharedNames.ts), not hand-written.
 * The hand-written version here had 28 entries and missed 196 more that the
 * data itself knew about, which is what let junk photos through for
 * guesthouses. It is deliberately NOT part of `GENERIC_LODGING_WORDS`, because
 * that set also decides which map pins merge into one.
 *
 * A hut named only one of these still gets photos — it just has to be
 * corroborated by proximity as well, which is the one time distance earns a
 * vote here.
 */
const AMBIGUOUS_ALONE = SHARED_PLACE_NAMES;

/**
 * Words that suggest the photo shows the BUILDING, not just the area it's
 * named after. Only ever used to rank, never to admit or reject.
 *
 * ⚠️ Matches PREFIXES and abbreviations on purpose. An exact `rifugio` missed
 * both "Rifugi Coldai" and "at Rif. Coldai" — the two genuine hut photos in
 * that set — while six photos of Lago Coldai, the lake below, scored equally
 * and outranked them.
 */
const LODGING_HINT =
  /(h(u|ü|ue)tte|rifug|rif\.|capann|cap\.|cabane|refug|berghaus|berggasthaus|gasthaus|baita|malga|ko[cč]a|bivac|biwak|chalet|\bhut\b|\bhuts\b)/i;

/**
 * At most this many photos from one photographer.
 *
 * Measured: Aescher's six slots were filled by one perfect shot and then FIVE
 * near-identical "Ebenalp" frames from a single Flickr user. A gallery wants
 * six different views of a hut, not one person's afternoon.
 */
const MAX_PER_OWNER = 2;

interface FlickrPhoto {
  id: string;
  title?: string;
  tags?: string;
  license?: string;
  /** Stable user id; `ownername` is the display name and can repeat. */
  owner?: string;
  ownername?: string;
  latitude?: string | number;
  longitude?: string | number;
  url_c?: string;
  url_m?: string;
}

/**
 * Flickr needs an API key. It is read-only and rate-limited per key, which is
 * why shipping it in the app is normal practice — but `EXPO_PUBLIC_` values ARE
 * extractable from the bundle, so treat it as public and never reuse a key that
 * has write scope.
 *
 * With no key set, this simply returns nothing and the gallery is unchanged.
 */
const RAW_KEY = process.env.EXPO_PUBLIC_FLICKR_API_KEY?.trim();

/** Placeholder values that mean "not configured yet". Without this check a
 *  forgotten `your_key_here` would fire a doomed request on every hut opened —
 *  Flickr answers `stat: "fail"`, we return nothing, and the only evidence is
 *  the wasted round trip. A real key is 32 hex characters. */
const API_KEY =
  RAW_KEY && !/^(your_key_here|changeme|xxx+|<.*>)$/i.test(RAW_KEY) ? RAW_KEY : undefined;

export async function fetchFlickrHutPhotos(
  hut: Hut,
  signal?: AbortSignal,
): Promise<HutImage[]> {
  if (!API_KEY) return [];
  if (!hut.name || isFallbackHutName(hut.name)) return [];

  const normalized = normalizePlaceName(hut.name);
  const tokens = distinctiveTokens(normalized);
  // Nothing in the name identifies this place — "Ricovero", "Rifugio", "Barma".
  // Searching on it would match every refuge in the range.
  if (!tokens.length) return [];

  // ⚠️ SEARCH ON THE LONGEST DISTINCTIVE WORD, NOT THE WHOLE NAME.
  //
  // Flickr ANDs every word in `text`, so sending the OSM name demanded that a
  // photo carry all of it. "Berggasthaus Aescher-Wildkirchli" therefore matched
  // almost nothing, while nobody titles a photo that way.
  //
  // Measured over 9 huts, admitted photos: full name 22, all distinctive words
  // 138, longest distinctive word alone 178 — eight times the coverage, and
  // Aescher went from 0 to 42.
  //
  // Widening costs no precision, because the GATE below is unchanged: every
  // distinctive word of the name must still appear in the photo's title or
  // tags. A wide query only decides how many candidates the gate gets to see.
  const query = [...tokens].sort((a, b) => b.length - a.length)[0];

  const url =
    `https://api.flickr.com/services/rest/?method=flickr.photos.search` +
    `&api_key=${encodeURIComponent(API_KEY)}` +
    `&text=${encodeURIComponent(query)}` +
    `&license=${LICENCES}` +
    `&content_type=1&media=photos&safe_search=1&sort=relevance&per_page=40` +
    `&extras=license,owner_name,geo,tags,url_c,url_m` +
    `&format=json&nojsoncallback=1`;

  let photos: FlickrPhoto[] = [];
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      stat?: string;
      photos?: { photo?: FlickrPhoto[] };
    };
    if (json.stat !== 'ok') return [];
    photos = json.photos?.photo ?? [];
  } catch {
    return []; // offline, aborted, or Flickr down — the gallery is unaffected.
  }

  // A name of one ambiguous word ("Alpina") can't carry a match by itself, so
  // those huts additionally require the photo to be geotagged close by.
  const needsCorroboration = tokens.length === 1 && AMBIGUOUS_ALONE.has(tokens[0]);

  const scored: { img: HutImage; score: number; owner: string }[] = [];

  for (const p of photos) {
    const src = p.url_c || p.url_m;
    if (!src) continue;

    const title = normalizePlaceName(p.title ?? '');
    const tags = normalizePlaceName(p.tags ?? '');

    // THE GATE: the name must be there.
    const inTitle = textNamesPlace(title, tokens);
    const inTags = textNamesPlace(tags, tokens);
    if (!inTitle && !inTags) continue;

    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    // ⚠️ Flickr reports an UNGEOTAGGED photo as latitude 0, longitude 0 — not
    // as a missing field. Taken at face value that is Null Island, and the
    // measured effect was photos "6,869 km from the hut" being scored as if
    // they carried a real position. Treat 0,0 as absent.
    const hasGeo =
      Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
    const metres = hasGeo
      ? Math.hypot((lat - hut.lat) * 111_320, (lon - hut.lon) * 74_000)
      : Infinity;

    // A REAL position far from the hut means the name matched something else —
    // the same word on another continent. Generous, because photographers
    // geotag from where they stood and several genuine Karwendelhaus photos
    // sit 6 km away; it only catches the wholly unrelated.
    if (hasGeo && metres > FAR_M) continue;

    // The second gate, for weak names only. An ungeotagged photo fails it,
    // which is the intended conservatism: unverifiable means not shown.
    if (needsCorroboration && metres > CORROBORATION_M) continue;

    let score = inTitle ? 3 : 2;
    if (LODGING_HINT.test(`${p.title ?? ''} ${p.tags ?? ''}`)) score += 1;

    // Closer is better, but only among photos the name already vouched for.
    if (metres < 300) score += 1.5;
    else if (metres < 1000) score += 0.75;
    // A real position kilometres out is usually the lake or the summit the hut
    // is named after, not the hut. Never applied to ungeotagged photos, whose
    // distance is unknown rather than large.
    else if (hasGeo && metres > 2000) score -= 0.5;

    const licence = LICENCE_NAME[String(p.license)] ?? 'Creative Commons';
    scored.push({
      score,
      owner: p.owner || p.ownername || '',
      img: {
        url: src,
        credit: 'Photo: Flickr',
        author: p.ownername?.trim() || undefined,
        license: licence,
      },
    });
  }

  // Best first, then thin out any one photographer — see MAX_PER_OWNER.
  const perOwner = new Map<string, number>();
  const out: HutImage[] = [];
  for (const s of scored.sort((a, b) => b.score - a.score)) {
    const n = perOwner.get(s.owner) ?? 0;
    if (s.owner && n >= MAX_PER_OWNER) continue;
    perOwner.set(s.owner, n + 1);
    out.push(s.img);
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}
