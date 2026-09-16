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

/**
 * Image paths that are page furniture rather than a photograph of the place.
 *
 * `plugins` and `themes` matter more than they look: a WordPress site serves
 * its slider plugin's demo pictures from there, and one test site offered a
 * plugin asset as its most prominent image. `generic` and `stock` catch chain
 * hotels serving brand photography that is not this building.
 */
const JUNK_PATH =
  /(logo|icon|favicon|sprite|avatar|flag|button|btn[-_]|arrow|pixel|spacer|placeholder|loader|spinner|badge|award|trip[-_]?advisor|booking|facebook|instagram|whatsapp|payment|banner[-_]?ad|\/plugins?\/|\/themes?\/|generic|stock|default)/i;

/** Words suggesting a real picture of the building or its surroundings, in the
 *  languages of the regions covered. Used to rank, never to reject. */
const LIKELY_PHOTO =
  /(hotel|haus|gasthof|gasthaus|chalet|zimmer|room|suite|aussen|exterior|facade|fassade|panorama|terrasse|terrace|garten|garden|winter|sommer|summer|berg|alm|hero|slider|header|gallery|galerie|foto|photo|bild|image|uploads|media)/i;

/** `<meta property="og:image" content="...">`, in any attribute order, and the
 *  common variants sites use instead. Ordered best-first. */
const META_PATTERNS = [
  /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
];

/**
 * OSM `website` values into something fetchable, or null.
 *
 * ⚠️ AN `http://` TAG IS UPGRADED TO `https://`, NOT REJECTED. iOS App
 * Transport Security blocks plain http, so those URLs are unusable as written —
 * but most of those sites have since migrated, and the tag simply never caught
 * up. Measured on 18 of the 1,866 http-tagged places: half answer over https
 * and 44% then yield a photo. The other half fail the fetch and return no
 * photo, which is exactly what rejecting them did anyway, so the upgrade only
 * costs a request that was never going to happen.
 */
function siteUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().split(/[\s,;]/)[0];
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed.replace(/^http:/i, 'https:')
    : `https://${trimmed}`;
  return /^https:\/\/[^/\s.]+\.[^/\s]+/i.test(withScheme) ? withScheme : null;
}

/**
 * Undo HTML entity encoding in an extracted URL.
 *
 * ⚠️ NOT optional. An `og:image` is an HTML attribute, so `&` in a query string
 * is written `&amp;` — and one test site encoded the whole thing, yielding
 * `https&#x3A;&#x2F;&#x2F;primary.jwwb.nl`. Left as-is those URLs simply fail to
 * load, silently, which looks like a hut with no photo.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // last: an encoded & may have produced the others
}

/** "https://www.hotel-alpina.ch/rooms" -> "hotel-alpina.ch", for the credit. */
function domainOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
}

/**
 * The most prominent real photograph among a page's `<img>` tags.
 *
 * ⚠️ WHY THIS IS HERE. Only 25% of guesthouse sites publish `og:image`, but
 * another 60% serve a perfectly good page full of pictures of themselves. Using
 * those lifts coverage from 25% to 85% of reachable sites — by far the largest
 * gain available, and it needs no new vendor because the page is already
 * fetched.
 *
 * It is also a weaker claim than `og:image`, which a site publishes expressly
 * so the picture travels with its link. A hero image is simply a photo on their
 * page. Hence the same mitigations, and more care about WHICH image: furniture
 * is excluded outright, tiny declared sizes are dropped, and position in the
 * document counts, because heroes come first and footers come last.
 */
function pickPageImage(html: string, pageUrl: string): string | null {
  let best: { url: string; score: number } | null = null;
  let seen = 0;

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    seen++;
    if (seen > 120) break; // deep in the page is footer territory

    // Lazy-loading sites keep the real file in data-src; `src` is a placeholder.
    const src =
      tag.match(/\sdata-(?:src|lazy-src|original)=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\ssrcset=["']([^"',\s]+)/i)?.[1] ??
      tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    if (!src || !/\.(jpe?g|png|webp)(\?|$)/i.test(src)) continue;

    const alt = tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? '';
    if (JUNK_PATH.test(src) || JUNK_PATH.test(alt)) continue;

    const w = Number(tag.match(/\swidth=["']?(\d+)/i)?.[1] ?? 0);
    const h = Number(tag.match(/\sheight=["']?(\d+)/i)?.[1] ?? 0);
    if ((w && w < 400) || (h && h < 260)) continue; // thumbnails, icons, crests

    let score = Math.max(0, 3 - seen * 0.2);
    if (LIKELY_PHOTO.test(src) || LIKELY_PHOTO.test(alt)) score += 2;
    if (w >= 800 || h >= 500) score += 2;

    const url = absolute(src, pageUrl);
    if (url && (!best || score > best.score)) best = { url, score };
  }
  return best?.url ?? null;
}

/** Resolve a possibly-relative image URL against the page it was found on. */
function absolute(src: string, pageUrl: string): string | null {
  const s = decodeEntities(src.trim());
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
    const from = res.url || page;
    const credit = `Photo: ${domainOf(page)}`;

    // The meta tags live in <head>; searching a whole large document wastes
    // time and risks matching one inside embedded content.
    const head = html.slice(0, 120_000);
    for (const re of META_PATTERNS) {
      const raw = head.match(re)?.[1];
      if (!raw) continue;
      const url = absolute(raw, from);
      if (url) return { url, credit, link: from };
    }

    // No meta tag — 60% of sites. Fall back to the best photo on the page.
    const hero = pickPageImage(html.slice(0, 400_000), from);
    return hero ? { url: hero, credit, link: from } : null;
  } catch {
    // Timed out, offline, TLS refused, or the site is simply down. The gallery
    // carries on with its other sources.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
