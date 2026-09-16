import type { HutImage } from '../utils/hutImage';

/**
 * Fetch a hut's lead photo from its Wikipedia article via the REST summary
 * endpoint. The OSM `wikipedia` tag looks like "de:Blüemlisalphütte".
 * Returns null when there's no article image.
 */
export async function fetchWikipediaImage(
  wikipediaTag: string,
  signal?: AbortSignal,
): Promise<HutImage | null> {
  const idx = wikipediaTag.indexOf(':');
  if (idx <= 0) return null;
  const lang = wikipediaTag.slice(0, idx);
  const title = wikipediaTag.slice(idx + 1);
  if (!/^[a-z-]{2,}$/i.test(lang) || !title) return null;

  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title,
  )}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;

  const json = (await res.json()) as {
    originalimage?: { source?: string };
    thumbnail?: { source?: string };
  };
  const src = json.originalimage?.source || json.thumbnail?.source;
  return src ? { url: src, credit: 'Photo: Wikipedia' } : null;
}
