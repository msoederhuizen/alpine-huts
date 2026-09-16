import type { Hut } from '../types/hut';
import { resolveHutImage, type HutImage } from '../utils/hutImage';
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
  const photos: HutImage[] = [];
  const seen = new Set<string>();
  const add = (img?: HutImage | null) => {
    if (img?.url && !seen.has(normalize(img.url))) {
      seen.add(normalize(img.url));
      photos.push(img);
    }
  };

  // The place's own photo of itself, from its website's og:image. Started NOW
  // but awaited at the END: it is measured at a median 524 ms and only about
  // 30% of sites yield anything, so awaiting it here would delay every hut page
  // for a coin flip. Running it alongside the Wikimedia lookups costs nothing
  // and it still ends up FIRST in the gallery — see the unshift below.
  const sitePhoto = fetchSiteImage(hut, signal);

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
  // with no Wikidata entry — measured at 73% of huts.
  //
  // Last of the Wikimedia routes because it is the weakest: a category is
  // maintained by somebody who decided each photo belongs in it, while this
  // matches on the file's name. Most huts with a category never get here.
  if (photos.length < MIN_BEFORE_SEARCH) {
    for (const img of await searchCommonsImages(hut.name, signal)) add(img);
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
  return withCommonsCredits(withSite, signal);
}
