import type { Hut } from '../types/hut';
import type { HutImage } from '../utils/hutImage';
import { fetchWikidataImage } from './wikidata';
import { fetchWikipediaImage } from './wikipedia';

/**
 * Best-effort remote photo for a hut, tried in order of reliability:
 * Wikidata (P18) → Wikipedia article image. Both are images *of the hut*.
 * Returns null when neither has one. (The direct OSM `image` tag is resolved
 * separately and synchronously.)
 *
 * Note: Wikimedia Commons geosearch was tried but removed — a photo merely
 * *near* a hut is too often of a neighbouring peak/lake, not the hut itself.
 */
export async function fetchRemoteHutPhoto(
  hut: Pick<Hut, 'wikidata' | 'wikipedia'>,
  signal?: AbortSignal,
): Promise<HutImage | null> {
  if (hut.wikidata) {
    const fromWikidata = await fetchWikidataImage(hut.wikidata, signal);
    if (fromWikidata) return fromWikidata;
  }
  if (hut.wikipedia) {
    const fromWikipedia = await fetchWikipediaImage(hut.wikipedia, signal);
    if (fromWikipedia) return fromWikipedia;
  }
  return null;
}
