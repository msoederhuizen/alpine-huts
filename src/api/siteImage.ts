import type { Hut } from '../types/hut';
import type { HutImage } from '../utils/hutImage';

/**
 * The photo a place publishes of ITSELF, read from its own website.
 *
 * WHY THIS EXISTS: Wikimedia is an encyclopedia, and a working Berghotel is not
 * encyclopedically notable. Measured across the shipped data:
 *
 *                      huts    guesthouses
 *   has wikipedia     23.6%           0.6%
 *   has wikidata      31.3%           4.7%
 *   has website       45.2%          46.5%
 *
 * So every Wikimedia route — P18, category, file search — finds almost nothing
 * for hotels and guesthouses, while nearly half of them tell us exactly where
 * their own photographs live. This reads the `og:image` meta tag, which a site
 * publishes precisely so its page looks right when the link is shared.
 *
 * ⚠️ THE IMAGE BELONGS TO THE PLACE, NOT TO US. It is credited to the site's
 * domain rather than to a photographer, and it carries `link` back to the page
 * it came from. Keep both: they are what makes using it defensible, and they
 * send the hotel the traffic it published the tag for.
 */

/** Give up on a slow site rather than making the gallery wait. */
const TIMEOUT_MS = 4500;

/** Don't read an entire multi-megabyte page to find a meta tag in its head. */
const MAX_BYTES = 2_000_000;

/** `<meta property="og:image" content="...">`, in any attribute order, and the
 *  common variants sites use instead. Ordered best-first. */
const META_PATTERNS = [
  /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
];

/** OSM `website` values are often bare hosts. Returns null for anything that
 *  isn't usable — including plain http, which iOS App Transport Security
 *  blocks by default, so fetching it would fail on device but "work" in dev. */
function siteUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().split(/[\s,;]/)[0];
  if (!trimmed) return null;
  if (/^http:\/\//i.test(trimmed)) return null;
  const withScheme = /^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return /^https:\/\/[^/\s.]+\.[^/\s]+/i.test(withScheme) ? withScheme : null;
}

/** "https://www.hotel-alpina.ch/rooms" -> "hotel-alpina.ch", for the credit. */
function domainOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
}

/** Resolve a possibly-relative image URL against the page it was found on. */
function absolute(src: string, pageUrl: string): string | null {
  const s = src.trim();
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return null; // blocked on iOS, see siteUrl
  if (s.startsWith('//')) return `https:${s}`;
  const origin = `https://${domainOf(pageUrl)}`;
  if (s.startsWith('/')) return origin + s;
  return `${origin}/${s}`;
}

export async function fetchSiteImage(
  hut: Hut,
  signal?: AbortSignal,
): Promise<HutImage | null> {
  const page = siteUrl(hut.website);
  if (!page) return null;

  // Own timeout, chained to the caller's so leaving the screen still cancels.
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    // ⚠️ No User-Agent header. A site that refuses an honest request is saying
    // no, and pretending to be a browser to get past that is not our call to
    // make. Such a site simply yields no photo.
    const res = await fetch(page, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;

    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) return null;

    const html = await res.text();
    // The tags live in <head>; searching the whole document of a big page
    // wastes time and risks matching a meta tag inside embedded content.
    const head = html.slice(0, 120_000);

    for (const re of META_PATTERNS) {
      const raw = head.match(re)?.[1];
      if (!raw) continue;
      const url = absolute(raw, res.url || page);
      if (!url) continue;
      return {
        url,
        credit: `Photo: ${domainOf(page)}`,
        link: res.url || page,
      };
    }
    return null;
  } catch {
    // Timed out, offline, TLS refused, or the site is simply down. The gallery
    // carries on with its other sources.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
