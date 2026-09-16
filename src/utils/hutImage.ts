import type { Hut } from '../types/hut';

export interface HutImage {
  url: string;
  /** Short credit line to show under the photo. */
  credit: string;
  /**
   * Commons file name WITHOUT the "File:" prefix, when this photo came from
   * Wikimedia. Kept so the author and licence can be looked up afterwards —
   * see `src/api/commonsCredits.ts`.
   */
  file?: string;
  /** Photographer, once looked up. Plain text; the API returns it as HTML. */
  author?: string;
  /** Licence short name as Commons states it, e.g. "CC BY-SA 4.0". */
  license?: string;
}

/**
 * The line shown under a photo.
 *
 * ⚠️ Most Commons photos are CC-BY or CC-BY-SA, which ask for the
 * PHOTOGRAPHER and the LICENCE — naming the source alone ("Photo: Wikimedia
 * Commons") does not satisfy that. So once the lookup has filled `author` and
 * `license` in, they are what gets shown; `credit` is the fallback for photos
 * whose details we couldn't fetch, and for non-Wikimedia sources.
 */
export function creditLine(img: HutImage): string {
  if (img.author && img.license) return `${img.author} · ${img.license}`;
  if (img.author) return `${img.author} · Wikimedia Commons`;
  return img.credit;
}

/** Build a Wikimedia Special:FilePath URL for a Commons file name. */
export function commonsFilePathUrl(filename: string, width = 800): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    filename,
  )}?width=${width}`;
}

/**
 * If `url` points at upload.wikimedia.org, pull out the underlying Commons file
 * name. Handles both the "thumb" form (…/thumb/a/ab/File.jpg/800px-File.jpg)
 * and the original form (…/a/ab/File.jpg). Parsed by hand because React
 * Native's `URL` implementation doesn't expose `pathname` reliably.
 */
function wikimediaFilename(url: string): string | null {
  const m = url.match(/^https?:\/\/upload\.wikimedia\.org\/(.+)$/i);
  if (!m) return null;
  const parts = m[1].split('?')[0].split('/').filter(Boolean);
  // In a thumb URL the real filename is the second-to-last segment (the last is
  // the "800px-…" rendition); otherwise it's the last segment.
  const name = parts.includes('thumb')
    ? parts[parts.length - 2]
    : parts[parts.length - 1];
  return name ? decodeURIComponent(name) : null;
}

/**
 * Percent-encode non-ASCII characters (e.g. raw umlauts in a path) but leave
 * already-encoded URLs untouched, so we don't double-encode `%`.
 */
function safeUrl(url: string): string {
  return /%[0-9A-Fa-f]{2}/.test(url) ? url : encodeURI(url);
}

/**
 * Resolve a displayable photo for a hut from its OSM tags, or null if none.
 *
 * Priority:
 *  1. `image` tag that is a direct http(s) URL. Wikimedia upload URLs are
 *     rewritten to Special:FilePath (the canonical, redirect-following
 *     resolver — the raw thumb URLs are flaky); other hosts are used as-is.
 *  2. `wikimedia_commons` (or an `image` tag) in "File:…" form → Special:FilePath.
 *
 * `Category:` values and anything else we can't turn into a single image
 * return null, so the UI shows its placeholder rather than a broken image.
 */
export function resolveHutImage(hut: Hut): HutImage | null {
  const { image, wikimediaCommons } = hut;

  if (image && /^https?:\/\//i.test(image)) {
    const wikiFile = wikimediaFilename(image);
    if (wikiFile) {
      return {
        url: commonsFilePathUrl(wikiFile),
        credit: 'Photo: Wikimedia Commons',
        file: wikiFile,
      };
    }
    return { url: safeUrl(image), credit: 'Photo via OpenStreetMap' };
  }

  const fileRef = wikimediaCommons?.startsWith('File:')
    ? wikimediaCommons
    : image?.startsWith('File:')
      ? image
      : undefined;

  if (fileRef) {
    const name = fileRef.slice('File:'.length);
    return {
      url: commonsFilePathUrl(name),
      credit: 'Photo: Wikimedia Commons',
      file: name,
    };
  }

  return null;
}
