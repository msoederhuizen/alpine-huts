import type { HutImage } from '../utils/hutImage';

/**
 * Look up who took a Wikimedia Commons photo and under what licence.
 *
 * WHY: most Commons images are CC-BY or CC-BY-SA. Those licences require the
 * author to be named and the licence identified — crediting only the source
 * ("Photo: Wikimedia Commons"), which is what this app did before, does not
 * meet that. This fills in the missing half.
 *
 * Best-effort by design: a photo whose details don't come back keeps its
 * existing source credit rather than showing nothing. The gallery must never
 * fail because an attribution lookup did.
 */

interface ExtMeta {
  Artist?: { value?: string };
  LicenseShortName?: { value?: string };
  Attribution?: { value?: string };
}

/**
 * Commons returns `Artist` as an HTML fragment — typically an `<a>` to the
 * uploader's user page, sometimes nested markup or a `<span>` with several
 * links. React Native has no DOM, so strip tags and entities by hand.
 */
function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  // A handful of files carry a whole paragraph of provenance here. A credit
  // line is one line, so keep it short rather than pushing the photo off screen.
  return text.length > 60 ? text.slice(0, 57).trimEnd() + '…' : text;
}

/** How many titles to ask for in one request. The API caps this at 50. */
const BATCH = 40;

/**
 * Fill in `author` and `license` on every image that names a Commons `file`.
 *
 * Returns a NEW array; images without a `file`, and those the API had nothing
 * for, come back untouched.
 */
export async function withCommonsCredits(
  images: HutImage[],
  signal?: AbortSignal,
): Promise<HutImage[]> {
  const files = [...new Set(images.map((i) => i.file).filter((f): f is string => !!f))];
  if (!files.length) return images;

  const found = new Map<string, { author?: string; license?: string }>();

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const titles = batch.map((f) => `File:${f}`).join('|');
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
      `&titles=${encodeURIComponent(titles)}` +
      `&prop=imageinfo&iiprop=extmetadata` +
      `&iiextmetadatafilter=Artist|LicenseShortName|Attribution&origin=*`;

    try {
      const res = await fetch(url, { signal });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        query?: {
          pages?: Record<
            string,
            { title?: string; imageinfo?: { extmetadata?: ExtMeta }[] }
          >;
        };
      };
      for (const page of Object.values(json.query?.pages ?? {})) {
        const meta = page.imageinfo?.[0]?.extmetadata;
        if (!meta || !page.title) continue;
        // `Attribution` is the rights-holder's own preferred wording where they
        // set one, so it outranks the parsed Artist field.
        const author = plainText(meta.Attribution?.value) ?? plainText(meta.Artist?.value);
        const license = plainText(meta.LicenseShortName?.value);
        if (author || license) {
          found.set(page.title.replace(/^File:/, ''), { author, license });
        }
      }
    } catch {
      // Aborted, offline, or Commons having a bad day — keep the source credit.
    }
  }

  if (!found.size) return images;
  return images.map((img) => {
    const extra = img.file ? found.get(img.file) : undefined;
    return extra ? { ...img, ...extra } : img;
  });
}
