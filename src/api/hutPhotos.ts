import type { Hut } from '../types/hut';
import { resolveHutImage, type HutImage } from '../utils/hutImage';
import { fetchCommonsCategoryImages, searchCommonsImages } from './commons';
import { withCommonsCredits } from './commonsCredits';
import { fetchFlickrHutPhotos } from './flickr';
import { fetchWikidataPhotoAndCategory } from './wikidata';
import { fetchWikipediaImage } from './wikipedia';

/** Strip query string + lowercase so the same file at different sizes de-dupes. */
function normalize(url: string): string {
  return url.split('?')[0].toLowerCase();
}

/** Below this many curated photos, fall back to a name-matched Flickr search. */
const MIN_BEFORE_FLICKR = 4;

/**
 * Gather all web photos *of a hut*, de-duplicated: the OSM `image`, the Wikidata
 * P18 photo, the Wikipedia article image, and every photo in the hut's Wikimedia
 * Commons category (P373 / the `wikimedia_commons` tag). Ordered best-first.
 */
export async function fetchHutGallery(
  hut: Hut,
  signal?: AbortSignal,
): Promise<HutImage[]> {
  const photos: HutImage[] = [];
  const seen = new Set<string>();
  const add = (img?: HutImage | null) => {
    if (img?.url && !seen.has(normalize(img.url))) {
      seen.add(normalize(img.url));
      photos.push(img);
    }
  };

  add(resolveHutImage(hut));

  let category = hut.wikimediaCommons?.startsWith('Category:')
    ? hut.wikimediaCommons
    : undefined;

  if (hut.wikidata) {
    const { image, category: wdCategory } = await fetchWikidataPhotoAndCategory(
      hut.wikidata,
      signal,
    );
    add(image);
    if (!category && wdCategory) category = `Category:${wdCategory}`;
  }

  if (hut.wikipedia) {
    add(await fetchWikipediaImage(hut.wikipedia, signal));
  }

  if (category) {
    for (const img of await fetchCommonsCategoryImages(category, signal)) {
      add(img);
    }
  }

  // Commons FILE SEARCH, when the curated links came up thin. Reaches the many
  // photos that exist on Commons but sit in no category and belong to a hut
  // with no Wikidata entry — measured at 73% of huts against 27% for Flickr.
  if (photos.length < MIN_BEFORE_FLICKR) {
    for (const img of await searchCommonsImages(hut.name, signal)) add(img);
  }

  // Flickr LAST, and only when the curated sources came up thin.
  //
  // Wikimedia photos are curated to be *of* the hut — a Commons category is
  // maintained by someone who decided each photo belongs in it. Flickr is
  // matched by name instead (see src/api/flickr.ts), which is good but weaker,
  // so it fills gaps rather than competing. Most huts with a Commons category
  // therefore never make this request at all.
  if (photos.length < MIN_BEFORE_FLICKR) {
    for (const img of await fetchFlickrHutPhotos(hut, signal)) add(img);
  }

  // One extra request names the photographer and licence for the Wikimedia
  // photos — what CC-BY actually asks for. Best-effort: if it fails, every
  // photo keeps its source credit and the gallery is unaffected. Flickr photos
  // already carry theirs from the search response.
  return withCommonsCredits(photos, signal);
}
