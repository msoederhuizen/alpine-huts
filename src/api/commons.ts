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
    .map((p) => p.imageinfo![0].thumburl)
    .filter((u): u is string => !!u)
    .map((url) => ({ url, credit: 'Photo: Wikimedia Commons' }));
}
