import type { Hut } from '../types/hut';
import { resolveHutImage, type HutImage } from '../utils/hutImage';
import { fetchCommonsCategoryImages } from './commons';
import { withCommonsCredits } from './commonsCredits';
import { fetchWikidataPhotoAndCategory } from './wikidata';
import { fetchWikipediaImage } from './wikipedia';

/** Strip query string + lowercase so the same file at different sizes de-dupes. */
function normalize(url: string): string {
  return url.split('?')[0].toLowerCase();
}

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

  // One extra request names the photographer and licence for the Wikimedia
  // photos — what CC-BY actually asks for. Best-effort: if it fails, every
  // photo keeps its source credit and the gallery is unaffected.
  return withCommonsCredits(photos, signal);
}
