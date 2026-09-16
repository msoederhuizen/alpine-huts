import { commonsFilePathUrl, type HutImage } from '../utils/hutImage';

/**
 * Look up a hut's photo from Wikidata via its `P18` (image) claim.
 * Returns null when the entity has no image, so callers fall back to a
 * placeholder. Uses the cacheable Special:EntityData endpoint.
 */
export async function fetchWikidataImage(
  qid: string,
  signal?: AbortSignal,
): Promise<HutImage | null> {
  if (!/^Q\d+$/.test(qid)) return null;

  const res = await fetch(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
    { signal },
  );
  if (!res.ok) throw new Error(`Wikidata ${res.status} for ${qid}`);

  const json = (await res.json()) as {
    entities?: Record<
      string,
      {
        claims?: {
          P18?: { mainsnak?: { datavalue?: { value?: string } } }[];
        };
      }
    >;
  };

  const filename = json.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue
    ?.value;
  if (!filename) return null;

  return {
    url: commonsFilePathUrl(filename),
    credit: 'Photo: Wikimedia Commons',
    file: filename,
  };
}

/**
 * Fetch both the hut's main photo (P18) and its Commons category (P373) from
 * Wikidata in one request — used to build the photo gallery.
 */
export async function fetchWikidataPhotoAndCategory(
  qid: string,
  signal?: AbortSignal,
): Promise<{ image?: HutImage; category?: string }> {
  if (!/^Q\d+$/.test(qid)) return {};

  const res = await fetch(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
    { signal },
  );
  if (!res.ok) return {};

  const json = (await res.json()) as {
    entities?: Record<
      string,
      {
        claims?: {
          P18?: { mainsnak?: { datavalue?: { value?: string } } }[];
          P373?: { mainsnak?: { datavalue?: { value?: string } } }[];
        };
      }
    >;
  };

  const claims = json.entities?.[qid]?.claims;
  const filename = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  const category = claims?.P373?.[0]?.mainsnak?.datavalue?.value;

  return {
    image: filename
      ? {
          url: commonsFilePathUrl(filename),
          credit: 'Photo: Wikimedia Commons',
          file: filename,
        }
      : undefined,
    category: typeof category === 'string' ? category : undefined,
  };
}
