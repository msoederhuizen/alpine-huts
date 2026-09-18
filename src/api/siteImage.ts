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
  /(logo|icon|favicon|sprite|avatar|flag|button|btn[-_]|arrow|pixel|spacer|placeholder|loader|spinner|badge|award|trip[-_]?advisor|booking|facebook|instagram|whatsapp|payment|banner|\bnav[-_]|visuel|\/plugins?\/|\/themes?\/|generic|stock|default)/i;

/**
 * Smallest long edge a real hut photograph can have.
 *
 * ⚠️ PIXELS, NOT BYTES. This was a byte threshold first, and bytes are the
 * wrong measure twice over: at 15 KB it rejected a genuine photo, and lowering
 * it to 5 KB then admitted Weinbergerhaus's og:image, which turned out to be a
 * 150x150 SQUARE THUMBNAIL — small in bytes because it is small in pixels, and
 * useless as a hero image either way. Reading the real dimensions out of the
 * file header settles it directly.
 */
const MIN_PHOTO_EDGE = 500;

/**
 * Enough of the file to reach a JPEG's SOF marker past its EXIF block.
 *
 * ⚠️ 64 KB, AND IT HAD TO GROW. At 16 KB this comment was simply wrong: a photo
 * straight off a camera carries an APP1/EXIF block of 15–18 KB before the image
 * data even starts, so the real marker sat at byte 31,564 in one measured case
 * and 19,311 in another. Both were full-size photographs; both were discarded.
 */
const HEADER_BYTES = 65_536;

/**
 * Reject graphics masquerading as photographs, by looking at the actual bytes.
 *
 * ⚠️ A PNG WITH AN ALPHA CHANNEL IS A LOGO, NOT A PHOTO. Measured failure:
 * Berghotel Hahnenmoospass served `schlemmerchalet.png`, a wooden rooster on a
 * transparent background, and nothing in the file NAME gave it away. Cameras
 * produce JPEGs; transparency only exists because a designer wanted it.
 *
 * Costs one small ranged request for the single image we chose. Anything that
 * cannot be checked — a server that ignores Range, a network error — is
 * ACCEPTED, because this is here to catch the obviously-wrong, not to be the
 * arbiter of what counts as a photograph.
 */
async function looksLikeAPhoto(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, {
      signal,
      headers: { Range: `bytes=0-${HEADER_BYTES - 1}` },
    });
    if (!res.ok && res.status !== 206) return true; // can't tell — let it through

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 26) return false; // nothing this small is a photograph

    // PNG: 8-byte signature, then IHDR — width at 16, height at 20, colour type
    // at 25, all fixed offsets.
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) {
      const colourType = buf[25];
      if (colourType === 4 || colourType === 6) return false; // alpha ⇒ a logo
      const be = (o: number) =>
        ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
      return Math.max(be(16), be(20)) >= MIN_PHOTO_EDGE;
    }

    // JPEG: walk to a Start-Of-Frame marker, which carries the real dimensions.
    //
    // ⚠️ FOLLOW THE SEGMENT CHAIN. DO NOT SCAN FOR THE BYTE PATTERN. This was a
    // linear search for 0xFF followed by C0–CF, and it found the wrong frame:
    // an EXIF block contains an embedded THUMBNAIL, that thumbnail is itself a
    // complete JPEG, and its SOF marker comes first. Measured: a 2048x1365
    // photograph reported 256x171 — the thumbnail — and was thrown out for being
    // too small. Every camera photo with EXIF hit this.
    //
    // Each marker declares its own length, so stepping segment to segment skips
    // the EXIF block whole and lands on the real frame.
    let i = 2; // past the SOI marker
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      // 0xFF is padding; SOI/TEM/RSTn stand alone and carry no length field.
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = (buf[i + 2] << 8) | buf[i + 3];
      if (length < 2) break; // malformed; stop rather than loop forever
      // C4, C8 and CC share the range but are Huffman/arithmetic tables, not SOF.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const height = (buf[i + 5] << 8) | buf[i + 6];
        const width = (buf[i + 7] << 8) | buf[i + 8];
        return Math.max(width, height) >= MIN_PHOTO_EDGE;
      }
      if (marker === 0xda) break; // start of scan: no frame header ahead of us
      i += 2 + length;
    }

    // Some other format, or SOF beyond the header we read. Not our call.
    return true;
  } catch {
    return true; // unreachable or aborted — not this function's job to decide
  }
}

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
 * The BIGGEST image in a `srcset`, not the first one.
 *
 * ⚠️ srcset is written smallest-first by convention, so taking entry zero —
 * which is what this did — systematically picked the lowest resolution the site
 * offered and then displayed it full-width. That is the same blurriness the Wix
 * placeholder caused, arrived at a different way, and it affected every site
 * using responsive images rather than one platform.
 *
 * Entries look like `photo-320.jpg 320w, photo-1600.jpg 1600w` or `… 1x, … 2x`.
 * Ranks by the `w` descriptor where present, else by `x`, else takes the last —
 * still a better guess than the first.
 */
function largestInSrcset(srcset: string): string | null {
  let best: { url: string; weight: number } | null = null;
  const entries = srcset.split(',');
  for (let i = 0; i < entries.length; i++) {
    const parts = entries[i].trim().split(/\s+/);
    const url = parts[0];
    if (!url) continue;
    const d = parts[1] ?? '';
    const weight = /(\d+)w$/.test(d)
      ? Number(/(\d+)w$/.exec(d)![1])
      : /([\d.]+)x$/.test(d)
        ? Number(/([\d.]+)x$/.exec(d)![1]) * 1000
        : i; // no descriptor: later is usually larger
    if (!best || weight >= best.weight) best = { url, weight };
  }
  return best?.url ?? null;
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
    // The srcset is read through `largestInSrcset` rather than taking entry
    // zero, which is the SMALLEST the site offers.
    const srcset = tag.match(/\ssrcset=["']([^"']+)["']/i)?.[1];
    const src =
      tag.match(/\sdata-(?:src|lazy-src|original)=["']([^"']+)["']/i)?.[1] ??
      (srcset ? largestInSrcset(srcset) : null) ??
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

/**
 * Turn a low-quality PLACEHOLDER URL into the real picture.
 *
 * ⚠️ Scraping raw HTML gets you what the page loads BEFORE its JavaScript runs,
 * and modern site builders put a deliberately tiny, deliberately blurred image
 * there — the real one is swapped in later by script we never execute.
 *
 * Measured: Berghaus Toni is a Wix site whose `<img>` declared 980x798 while
 * pointing at `.../w_147,h_98,...,blur_2,.../`. The app dutifully showed a
 * 147-pixel blurred thumbnail. The URL literally says `blur_2`.
 *
 * Wix keeps the transform in the path, so the fix is to edit it: drop the blur,
 * raise the size, keep whatever crop the site chose. Stripping the transform
 * entirely also works but yields the untouched original — 2 MB, and one was
 * 6 MB, which is not something to download onto a phone for a trail.
 */
function upgradePlaceholder(url: string): string {
  if (!/static\.wixstatic\.com\//i.test(url)) return url;
  return url.replace(/(\/v1\/[^/]+\/)([^/]+)(\/)/, (_m, head, params, tail) => {
    const fixed = String(params)
      .split(',')
      .filter((p) => !/^blur_/.test(p))
      .map((p) => (p.startsWith('w_') ? 'w_1200' : p.startsWith('h_') ? 'h_900' : p))
      .join(',');
    return `${head}${fixed}${tail}`;
  });
}

/**
 * Still a placeholder after `upgradePlaceholder` had its go.
 *
 * Wix is handled properly above because it is everywhere among small hotels,
 * but every image CDN has its own dialect and there is no point learning them
 * all. These two markers are near-universal and unambiguous: a URL that asks
 * for blur, or that asks for a width too small to fill a phone screen, is not
 * the picture the site wants you to see. Better no photo than a blurred one.
 */
function looksLikePlaceholder(url: string): boolean {
  if (/[/,?&_-]blur[_=-]?\d/i.test(url)) return true;
  const w = /[/,?&](?:w|width)[_=](\d{2,4})\b/i.exec(url);
  return !!w && Number(w[1]) < 400;
}

/** The host exactly as served, "www." and all — for building URLs. `domainOf`
 *  strips it for display and must never be used to resolve one. */
function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').split('/')[0];
}

/** Resolve a possibly-relative image URL against the page it was found on. */
function absolute(src: string, pageUrl: string): string | null {
  const s = upgradePlaceholder(decodeEntities(src.trim()));
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return null; // blocked on iOS, see siteUrl
  if (s.startsWith('//')) return `https:${s}`;
  // ⚠️ hostOf, NOT domainOf. Resolving against the www-stripped name pointed
  // every relative image on a www-only site at a host that does not serve it.
  const origin = `https://${hostOf(pageUrl)}`;
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

    /** Name-level rejections. Cheap, so they run before any extra request. */
    const plausible = (u: string | null): u is string =>
      !!u && !JUNK_PATH.test(u) && !looksLikePlaceholder(u);

    // ⚠️ JUNK_PATH APPLIES TO og:image TOO. It used to guard only the <img>
    // fallback, on the assumption that a site's declared og:image is its best
    // picture of itself. One hut's og:image was a language-switcher flag —
    // `flag` was already on the list, and the list simply wasn't consulted.
    let declared: string | null = null;
    for (const re of META_PATTERNS) {
      const raw = head.match(re)?.[1];
      if (!raw) continue;
      const url = absolute(raw, from);
      if (plausible(url)) {
        declared = url;
        break;
      }
    }

    // Try the declared image, then the best one on the page. ⚠️ A REJECTED
    // og:image MUST FALL THROUGH rather than end the search: Weinbergerhaus
    // declares a 150x150 thumbnail while its pages carry full-size photographs,
    // and giving up at the meta tag would have left it with nothing.
    const hero = pickPageImage(html.slice(0, 400_000), from);
    for (const candidate of [declared, plausible(hero) ? hero : null]) {
      if (!candidate) continue;
      // Last gate: the bytes, not the name. Catches logos and thumbnails no
      // filename rule would have flagged.
      if (await looksLikeAPhoto(candidate, signal)) {
        return { url: candidate, credit, link: from };
      }
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
