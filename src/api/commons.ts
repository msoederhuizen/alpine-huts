import { SHARED_PLACE_NAMES } from '../constants/sharedNames';
import {
  distinctiveTokens,
  normalizePlaceName,
  textNamesPlace,
} from '../utils/dedupePlaces';
import { isFallbackHutName } from '../utils/hutMeta';
import type { HutImage } from '../utils/hutImage';

interface CommonsPage {
  title?: string;
  imageinfo?: { thumburl?: string; mediatype?: string }[];
}

/**
 * List photos from a Wikimedia Commons category (e.g. "Category:Blüemlisalphütte").
 * A category is curated to be *about the hut*, so these are real hut photos —
 * unlike a proximity/geosearch. Returns up to `limit` bitmap images.
 */
export async function fetchCommonsCategoryImages(
  category: string,
  signal?: AbortSignal,
  limit = 20,
): Promise<HutImage[]> {
  const title = category.startsWith('Category:') ? category : `Category:${category}`;
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&generator=categorymembers&gcmtitle=${encodeURIComponent(title)}` +
    `&gcmtype=file&gcmlimit=${limit}` +
    `&prop=imageinfo&iiprop=url|mediatype&iiurlwidth=1000&origin=*`;

  const res = await fetch(url, { signal });
  if (!res.ok) return [];

  const json = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = json.query?.pages ? Object.values(json.query.pages) : [];

  return pages
    .filter(
      (p) =>
        p.imageinfo?.[0]?.mediatype === 'BITMAP' &&
        /\.(jpe?g|png)$/i.test(p.title ?? ''),
    )
    .map((p) => ({ url: p.imageinfo![0].thumburl, title: p.title }))
    .filter((p): p is { url: string; title: string } => !!p.url && !!p.title)
    .map(({ url, title }) => ({
      url,
      credit: 'Photo: Wikimedia Commons',
      // Carried so `withCommonsCredits` can name the photographer and licence.
      file: title.replace(/^File:/, ''),
    }));
}

/**
 * Search Commons FOR FILES BY NAME, rather than following a category.
 *
 * ⚠️ THIS IS THE BIGGEST SOURCE OF HUT PHOTOS AND IT WAS MISSING.
 *
 * The gallery previously reached Commons only two ways: a Wikidata P18 claim,
 * or a Commons CATEGORY named on the hut. Both require somebody to have curated
 * the link. A photo uploaded as "Salzkofelhütte.jpg" and put in no category, of
 * a hut with no Wikidata entry, was invisible — and most huts are exactly that.
 *
 * Measured over a random sample of named alpine and wilderness huts, photos
 * found per hut by at least one source:
 *
 *     Commons file search    73%   <- this function
 *     Flickr, CC licences    27%   <- what the paid Flickr key buys
 *
 * Same licensing as the rest of Commons, no API key, no vendor. The name gate
 * below is the same one `flickr.ts` uses, for the same reason: a file called
 * "Hütte im Schnee.jpg" is not evidence of anything.
 */
export async function searchCommonsImages(
  hutName: string,
  signal?: AbortSignal,
  limit = 20,
): Promise<HutImage[]> {
  if (!hutName || isFallbackHutName(hutName)) return [];
  const tokens = distinctiveTokens(normalizePlaceName(hutName));
  if (!tokens.length) return [];

  // ⚠️ A one-word name that many places share identifies none of them, and
  // Commons files carry no position to check against — so this DECLINES rather
  // than guesses. Without it, a "Pension Edelweiss" in the Valais was shown a
  // Pension Edelweiss in the Harz and a Haus Edelweiss on the Baltic coast, and
  // "Cristallo" was shown Monte Cristallo, the mountain. 57 places are called
  // Edelweiss; see constants/sharedNames.ts.
  //
  // This is why guesthouses suffered and huts did not: 4.2% of guesthouses have
  // a name like that against 0.9% of huts.
  if (tokens.length === 1 && SHARED_PLACE_NAMES.has(tokens[0])) return [];

  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&generator=search&gsrsearch=${encodeURIComponent(hutName)}` +
    `&gsrnamespace=6&gsrlimit=${limit}` +
    `&prop=imageinfo&iiprop=url|mediatype&iiurlwidth=1000&origin=*`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
    const pages = json.query?.pages ? Object.values(json.query.pages) : [];

    return pages
      .filter(
        (p) =>
          p.imageinfo?.[0]?.mediatype === 'BITMAP' &&
          /\.(jpe?g|png)$/i.test(p.title ?? '') &&
          // The file name must actually name this hut — search is fuzzy and
          // will happily return the whole valley otherwise.
          textNamesPlace(normalizePlaceName(p.title ?? ''), tokens),
      )
      .map((p) => ({ url: p.imageinfo![0].thumburl, title: p.title! }))
      .filter((p): p is { url: string; title: string } => !!p.url)
      // Tightest file name first. "Konkordiahütte.jpg" is almost certainly OF
      // the hut; "Hintersteiner See von der Steiner Hochalm.JPG" is a lake seen
      // from it. Extra words beyond the name are the signal, and Commons file
      // names carry no lodging word to test instead.
      .sort(
        (a, b) =>
          normalizePlaceName(a.title).split(' ').length -
          normalizePlaceName(b.title).split(' ').length,
      )
      .map(({ url: u, title }) => ({
        url: u,
        credit: 'Photo: Wikimedia Commons',
        file: title.replace(/^File:/, ''),
      }));
  } catch {
    return []; // offline or aborted — the rest of the gallery is unaffected.
  }
}
