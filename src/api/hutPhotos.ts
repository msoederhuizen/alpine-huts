import { indexedPhotosFor, isIndexed } from '../data/photoIndex';
import { refugesPhotosFor } from '../data/refugesPhotos';
import type { Hut } from '../types/hut';
import { resolveHutImage, type HutImage } from '../utils/hutImage';
import { readCachedPhotos, writeCachedPhotos } from '../utils/photoCache';
import { fetchCommonsCategoryImages, searchCommonsImages } from './commons';
import { withCommonsCredits } from './commonsCredits';
import { fetchSiteImage } from './siteImage';
import { fetchWikidataPhotoAndCategory } from './wikidata';
import { fetchWikipediaImage } from './wikipedia';

/** Strip query string + lowercase so the same file at different sizes de-dupes. */
function normalize(url: string): string {
  return url.split('?')[0].toLowerCase();
}

/** Below this many curated photos, fall back to searching Commons by name. */
const MIN_BEFORE_SEARCH = 4;

/**
 * Gather all web photos *of a hut*, de-duplicated: the OSM `image`, the Wikidata
 * P18 photo, the Wikipedia article image, and every photo in the hut's Wikimedia
 * Commons category (P373 / the `wikimedia_commons` tag). Ordered best-first.
 */
export async function fetchHutGallery(
  hut: Hut,
  signal?: AbortSignal,
): Promise<HutImage[]> {
  // Straight out of storage when we've been here before — see photoCache.ts.
  // This is what makes reopening a hut instant instead of four round trips,
  // and it matters most for huts with NO photos, where every source is tried
  // and every one fails.
  const cached = await readCachedPhotos(hut.id);
  if (cached) return cached;

  const photos: HutImage[] = [];
  const seen = new Set<string>();
  const add = (img?: HutImage | null) => {
    if (img?.url && !seen.has(normalize(img.url))) {
      seen.add(normalize(img.url));
      photos.push(img);
    }
  };

  add(resolveHutImage(hut));

  // ── Everything shipped with the app, in order. No requests, works offline. ──

  // refuges.info: matched by COORDINATES rather than name, so it cannot attach
  // another place's photo. The most trustworthy source there is.
  for (const img of refugesPhotosFor(hut.id)) add(img);

  // The build-time index: Commons and the place's own website, already
  // resolved. This is what the live lookups below used to do on the phone.
  for (const img of indexedPhotosFor(hut.id)) add(img);

  // ⚠️ AND STOP, if this place was in the index when it was built — whether or
  // not anything was found. An empty entry means the sweep was already done and
  // came back empty, which is true for about three quarters of places; redoing
  // it live would be the slowest path in the app, every time, for nothing.
  //
  // Everything below is a FALLBACK for places added since the last index build.
  // Regenerate with `npm run generate-photo-index` and it stops running at all.
  if (isIndexed(hut.id)) {
    void writeCachedPhotos(hut.id, photos);
    // Only reaches the network if the OSM `image` tag named a Commons file,
    // whose photographer still has to be looked up. Indexed photos already
    // carry their credit from the build.
    return withCommonsCredits(photos, signal);
  }

  // ── Fallback path only, for places the index has not seen ──────────────────

  // The place's own photo of itself, from its website's og:image. Started NOW
  // but awaited at the END: it is measured at a median 524 ms and only about
  // 30% of sites yield anything, so awaiting it here would delay the page for a
  // coin flip. It still ends up FIRST in the gallery — see the unshift below.
  const sitePhoto = fetchSiteImage(hut, signal);

  let category = hut.wikimediaCommons?.startsWith('Category:')
    ? hut.wikimediaCommons
    : undefined;

  // Wikidata and Wikipedia know nothing about each other, so ask them at the
  // same time rather than one after the other — one round trip instead of two.
  const [wd, wp] = await Promise.all([
    hut.wikidata
      ? fetchWikidataPhotoAndCategory(hut.wikidata, signal)
      : Promise.resolve({} as { image?: HutImage; category?: string }),
    hut.wikipedia
      ? fetchWikipediaImage(hut.wikipedia, signal)
      : Promise.resolve(null),
  ]);
  add(wd.image);
  add(wp);
  if (!category && wd.category) category = `Category:${wd.category}`;

  if (category) {
    for (const img of await fetchCommonsCategoryImages(category, signal)) {
      add(img);
    }
  }

  // Commons FILE SEARCH, when the curated links came up thin. Reaches the many
  // photos that exist on Commons but sit in no category and belong to a hut
  // with no Wikidata entry — measured at 73% of huts.
  //
  // Last of the Wikimedia routes because it is the weakest: a category is
  // maintained by somebody who decided each photo belongs in it, while this
  // matches on the file's name. Most huts with a category never get here.
  if (photos.length < MIN_BEFORE_SEARCH) {
    for (const img of await searchCommonsImages(hut, signal)) add(img);
  }

  // FIRST in the gallery, deliberately. For a hotel or guesthouse this is
  // usually the ONLY photo that exists — Wikipedia covers 0.6% of them against
  // 23.6% of huts — and where both exist, the official shot is normally the
  // better picture of the building. Credited to the domain and linked back to
  // the page it came from; see src/api/siteImage.ts.
  const site = await sitePhoto;
  const withSite =
    site && !seen.has(normalize(site.url)) ? [site, ...photos] : photos;

  // One extra request names the photographer and licence for the Wikimedia
  // photos — what CC-BY actually asks for. Best-effort: if it fails, every
  // photo keeps its source credit and the gallery is unaffected. The site
  // photo is credited to its domain rather than to a photographer.
  const result = await withCommonsCredits(withSite, signal);

  // Not awaited: the gallery should render now, not after a disk write. An
  // EMPTY result is cached too — that is the slow case worth remembering.
  void writeCachedPhotos(hut.id, result);
  return result;
}
