/**
 * Build-time: resolve photos for EVERY place and write the result into the
 * shipped data, so the app looks nothing up at runtime.
 *
 * WHY. Every photo source except refuges.info ran live, on the phone, while the
 * user waited: a Commons search, a Wikidata lookup, a website fetch. That is
 * slow on first view, flaky on a mountain connection and impossible offline —
 * and it made coverage unknowable, because nobody can see how often those
 * lookups actually succeed. Doing the work here fixes all three: the app reads
 * an index, and the index's size IS the coverage figure.
 *
 * ⚠️ URLS, NOT BYTES. Bundling the images themselves is arithmetically out:
 * ~14,000 places x 200 KB is about 2.8 GB. The index is a few MB, makes the
 * gallery appear instantly with no lookup, and the route prefetch
 * (prefetchRoutePhotos) still downloads actual files for offline use.
 *
 * Run: npm run generate-photo-index          (all places, hours)
 *      PHOTO_INDEX_LIMIT=300 npm run generate-photo-index   (a sample)
 *      npm run retry-photo-index             (re-attempt the ones that missed)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHARED_PLACE_NAMES } from '../src/constants/sharedNames';
import type { Hut } from '../src/types/hut';
import { distinctiveTokens, normalizePlaceName, textNamesPlace } from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGIONS = join(ROOT, 'assets', 'data', 'regions');
const OUT = join(ROOT, 'assets', 'data', 'photo-index.json');
const REFUGES = join(ROOT, 'assets', 'data', 'refuges-photos.json');
/** Build scratch, not shipped: which empties this retry pass has already redone. */
const RETRIED = join(ROOT, 'assets', 'data', 'photo-index-retried.json');

const LIMIT = Number(process.env.PHOTO_INDEX_LIMIT ?? 0);

/**
 * Re-attempt the places that came back with NOTHING, instead of skipping them.
 *
 * ⚠️ WITHOUT THIS, RE-RUNNING THE BUILD IS A NO-OP. An empty entry is recorded
 * deliberately — it is how the app tells "no photo exists" from "not looked at
 * yet" — but it also makes a miss permanent, because the resume logic skips
 * every id already present. A site that was merely down on build night stays
 * photoless forever.
 *
 * Sampled 60 of the 4,195 places that have a website and got no photo: about
 * one in six yields an image on a straight retry. That is transient failure,
 * not absent data, and this is the flag that recovers it.
 */
const RETRY_EMPTY = process.argv.includes('--retry');
const MAX_PER_HUT = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Photo {
  url: string;
  credit: string;
  author?: string;
  license?: string;
  link?: string;
}

// ── Commons, by file name ────────────────────────────────────────────────────
async function commonsByName(hut: Hut): Promise<Photo[]> {
  if (!hut.name || isFallbackHutName(hut.name)) return [];
  const tokens = distinctiveTokens(normalizePlaceName(hut.name));
  if (!tokens.length) return [];
  if (hut.type === 'guesthouse' && tokens.length === 1) return [];
  if (tokens.length === 1 && SHARED_PLACE_NAMES.has(tokens[0])) return [];

  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&generator=search&gsrsearch=${encodeURIComponent(hut.name)}&gsrnamespace=6&gsrlimit=20` +
    `&prop=imageinfo&iiprop=url|mediatype|extmetadata` +
    `&iiextmetadatafilter=Artist|LicenseShortName&iiurlwidth=1200&origin=*`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as any;
    const pages: any[] = json.query?.pages ? Object.values(json.query.pages) : [];
    const plain = (h?: string) =>
      h?.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 60) || undefined;

    return pages
      .filter(
        (p) =>
          p.imageinfo?.[0]?.mediatype === 'BITMAP' &&
          /\.(jpe?g|png)$/i.test(p.title ?? '') &&
          textNamesPlace(normalizePlaceName(p.title ?? ''), tokens),
      )
      .sort((a, b) => normalizePlaceName(a.title).split(' ').length - normalizePlaceName(b.title).split(' ').length)
      .slice(0, MAX_PER_HUT)
      .map((p) => {
        const meta = p.imageinfo[0].extmetadata ?? {};
        const author = plain(meta.Artist?.value);
        const license = plain(meta.LicenseShortName?.value);
        return {
          url: p.imageinfo[0].thumburl as string,
          credit: author && license ? `${author} · ${license}` : 'Photo: Wikimedia Commons',
          author,
          license,
        };
      })
      .filter((p) => !!p.url);
  } catch {
    return [];
  }
}

// ── The place's own website ──────────────────────────────────────────────────
const JUNK =
  /(logo|icon|favicon|sprite|avatar|flag|button|btn[-_]|arrow|pixel|spacer|placeholder|loader|spinner|badge|award|trip[-_]?advisor|booking|facebook|instagram|whatsapp|payment|banner|\bnav[-_]|visuel|\/plugins?\/|\/themes?\/|generic|stock|default)/i;
const LIKELY =
  /(hotel|haus|gasthof|gasthaus|chalet|zimmer|room|suite|aussen|exterior|facade|fassade|panorama|terrasse|terrace|garten|garden|winter|sommer|summer|berg|alm|hero|slider|header|gallery|galerie|foto|photo|bild|image|uploads|media)/i;

const decode = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function upgradeWix(u: string) {
  if (!/static\.wixstatic\.com\//i.test(u)) return u;
  return u.replace(/(\/v1\/[^/]+\/)([^/]+)(\/)/, (_m, a, p, t) =>
    a + String(p).split(',').filter((x) => !/^blur_/.test(x))
      .map((x) => (x.startsWith('w_') ? 'w_1200' : x.startsWith('h_') ? 'h_900' : x)).join(',') + t);
}
const isPlaceholder = (u: string) => {
  if (/[/,?&_-]blur[_=-]?\d/i.test(u)) return true;
  const w = /[/,?&](?:w|width)[_=](\d{2,4})\b/i.exec(u);
  return !!w && Number(w[1]) < 400;
};
/** For the CREDIT LINE — "www." is noise to a reader. Not for building URLs. */
const domainOf = (u: string) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
/** For BUILDING URLS — the host exactly as served, "www." and all. */
const hostOf = (u: string) => u.replace(/^https?:\/\//i, '').split('/')[0];

function absolute(src: string, page: string): string | null {
  const s = upgradeWix(decode(src.trim()));
  // ⚠️ http is KEPT here and judged later by `secureImageUrl`. It used to be
  // dropped on the spot because iOS will not load it — but that conflated the
  // page with the picture. This runs in Node, where the page's scheme is our
  // business alone; only the URL we SHIP has to be https, and 40% of http-only
  // sites serve their images over TLS perfectly well.
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  // ⚠️ hostOf, NOT domainOf. Resolving against the www-stripped name sent every
  // relative image on a www-only site to a host that does not serve it.
  const o = `${page.startsWith('http://') ? 'http' : 'https'}://${hostOf(page)}`;
  return s.startsWith('/') ? o + s : `${o}/${s}`;
}

/**
 * The URLs worth trying for a place's page, best first.
 *
 * OSM's `website` tag is often stale in small ways: the scheme never got
 * updated, or it names the apex when only `www` answers. Measured on 45 sites
 * that failed outright, 7 answered on one of these variants.
 */
function siteCandidates(raw?: string): string[] {
  if (!raw) return [];
  const t = raw.trim().split(/[\s,;]/)[0];
  if (!t) return [];
  const bare = t.replace(/^https?:\/\//i, '');
  if (!/^[^/\s.]+\.[^/\s]+/.test(bare)) return [];
  const host = bare.split('/')[0];
  const path = bare.slice(host.length);
  const swapped = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  return [`https://${bare}`, `https://${swapped}${path}`, `http://${bare}`];
}

/**
 * The https form of an image URL, or null if TLS genuinely will not serve it.
 *
 * ⚠️ STRICT ON PURPOSE, unlike `isPhoto`. isPhoto lets anything it cannot check
 * through, which is right for a quality heuristic and WRONG here: an http URL
 * we rewrite to https and never verify would ship as a permanently broken image
 * in the app. So a failure to confirm is a rejection.
 *
 * Only http URLs pay for this request; https ones are already fine.
 */
async function secureImageUrl(url: string): Promise<string | null> {
  if (/^https:/i.test(url)) return url;
  const secure = url.replace(/^http:/i, 'https:');
  try {
    const r = await fetch(secure, {
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(8000),
    });
    return r.ok || r.status === 206 ? secure : null;
  } catch {
    return null; // self-signed, DH key too small, wrong TLS version — let it go
  }
}
function largestSrcset(ss: string): string | null {
  let best: { u: string; w: number } | null = null;
  const parts = ss.split(',');
  for (let i = 0; i < parts.length; i++) {
    const q = parts[i].trim().split(/\s+/);
    if (!q[0]) continue;
    const d = q[1] ?? '';
    const w = /(\d+)w$/.test(d) ? Number(/(\d+)w$/.exec(d)![1])
      : /([\d.]+)x$/.test(d) ? Number(/([\d.]+)x$/.exec(d)![1]) * 1000 : i;
    if (!best || w >= best.w) best = { u: q[0], w };
  }
  return best?.u ?? null;
}
function pickPageImage(html: string, page: string): string | null {
  let best: { u: string; s: number } | null = null;
  let seen = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (++seen > 120) break;
    const ss = tag.match(/\ssrcset=["']([^"']+)["']/i)?.[1];
    const src = tag.match(/\sdata-(?:src|lazy-src|original)=["']([^"']+)["']/i)?.[1]
      ?? (ss ? largestSrcset(ss) : null) ?? tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    if (!src || !/\.(jpe?g|png|webp)(\?|$)/i.test(src)) continue;
    const alt = tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? '';
    if (JUNK.test(src) || JUNK.test(alt)) continue;
    const w = Number(tag.match(/\swidth=["']?(\d+)/i)?.[1] ?? 0);
    const h = Number(tag.match(/\sheight=["']?(\d+)/i)?.[1] ?? 0);
    if ((w && w < 400) || (h && h < 260)) continue;
    let s = Math.max(0, 3 - seen * 0.2);
    if (LIKELY.test(src) || LIKELY.test(alt)) s += 2;
    if (w >= 800 || h >= 500) s += 2;
    const u = absolute(src, page);
    if (u && (!best || s > best.s)) best = { u, s };
  }
  return best?.u ?? null;
}
/**
 * Real pixels, from the file header. Rejects logos and thumbnails.
 *
 * ⚠️ Mirrors `looksLikeAPhoto` in src/api/siteImage.ts — keep the two together.
 * Both read 64 KB and both FOLLOW THE JPEG SEGMENT CHAIN rather than scanning
 * for the marker bytes. Scanning found the EXIF thumbnail's frame instead of the
 * image's: a measured 2048x1365 photograph reported 256x171 and was discarded,
 * as was every other camera photo carrying EXIF. The real marker sat at byte
 * 31,564, well past the 16 KB this used to read.
 */
async function isPhoto(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
    if (!r.ok && r.status !== 206) return true;
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length < 26) return false;
    if (b[0] === 0x89 && b[1] === 0x50) {
      if (b[25] === 4 || b[25] === 6) return false;
      const be = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      return Math.max(be(16), be(20)) >= 500;
    }
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk === 0xff) { i++; continue; }
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) break;
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
        return Math.max((b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]) >= 500;
      }
      if (mk === 0xda) break;
      i += 2 + len;
    }
    return true;
  } catch {
    return true;
  }
}
/**
 * ⚠️ FIFTEEN SECONDS, against the app's 4.5.
 *
 * `src/api/siteImage.ts` gives up at 4500 ms because a USER is waiting there and
 * a gallery that hangs is worse than a gallery with one photo missing. Here
 * nobody is waiting: this runs once, overnight, and a place dropped for slowness
 * is dropped from the shipped data for every user until the next build.
 *
 * Measured on 60 sampled sites: a small share answer between 4.5 s and 15 s —
 * mountain hotels on modest hosting, which is most of them. Waiting costs a
 * worker a few seconds; not waiting costs the place its photograph permanently.
 */
const SITE_TIMEOUT_MS = 15_000;

async function fromWebsite(hut: Hut): Promise<Photo[]> {
  const candidates = siteCandidates(hut.website);
  if (!candidates.length) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SITE_TIMEOUT_MS);
  try {
    // Try https, then the www/apex swap, then http. First one that answers wins.
    let res: Response | null = null;
    let page = candidates[0];
    for (const candidate of candidates) {
      try {
        const r = await fetch(candidate, { signal: ctrl.signal, redirect: 'follow' });
        if (r.ok) { res = r; page = candidate; break; }
      } catch {
        if (ctrl.signal.aborted) return []; // our own timeout, not this host's fault
      }
    }
    if (!res) return [];
    const html = await res.text();
    const from = res.url || page;
    const ok = (u: string | null): u is string => !!u && !JUNK.test(u) && !isPlaceholder(u);

    let declared: string | null = null;
    for (const re of [
      /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    ]) {
      const raw = html.slice(0, 120_000).match(re)?.[1];
      if (!raw) continue;
      const u = absolute(raw, from);
      if (ok(u)) { declared = u; break; }
    }
    const hero = pickPageImage(html.slice(0, 400_000), from);
    for (const c of [declared, ok(hero) ? hero : null]) {
      if (!c) continue;
      // ⚠️ SECURE IT BEFORE JUDGING IT. The app can only display https, so an
      // image that will not serve over TLS is worth nothing however good it is
      // — and checking first saves the ranged request isPhoto would have spent.
      const secure = await secureImageUrl(c);
      if (!secure) continue;
      if (await isPhoto(secure)) {
        // `link` keeps the page we actually read, http scheme and all: it is a
        // citation for a human, not something the app loads.
        return [{ url: secure, credit: `Photo: ${domainOf(page)}`, link: from }];
      }
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const refuges: Record<string, unknown[]> = existsSync(REFUGES)
    ? JSON.parse(readFileSync(REFUGES, 'utf8'))
    : {};

  const byId = new Map<string, Hut>();
  for (const f of readdirSync(REGIONS).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(REGIONS, f), 'utf8')) as Record<string, Hut[]>;
    for (const b of ['core', 'accommodations']) for (const h of d[b] ?? []) if (h.name && !byId.has(h.id)) byId.set(h.id, h);
  }

  /**
   * ⚠️ RESUMABLE, and it has to be.
   *
   * The first full attempt reached 14,550 of 21,576 — about forty minutes —
   * before the connection collapsed from 6.8/s to 0.3/s and the process died,
   * and every one of those results was lost because the file was only written
   * at the end. Thousands of rapid connections exhaust the socket pool on
   * Windows, so a long run failing partway is the NORMAL case, not the unlucky
   * one. `generate-huts.ts` learned this already; so does this.
   *
   * Re-running skips whatever is already on disk and fills the gaps. Delete
   * photo-index.json to force a clean rebuild.
   */
  const index: Record<string, Photo[]> = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : {};
  const resumed = Object.keys(index).length;

  /**
   * A retry pass needs its OWN resume record. The normal pass resumes on "is
   * this id in the index", which cannot work here: the ids being retried are
   * precisely the ones already in it. Without this list a crash at 8,000 of
   * 16,000 would start the whole pass again, and only the ~18% that succeeded
   * would be skipped.
   */
  const retried = new Set<string>(
    RETRY_EMPTY && existsSync(RETRIED) ? JSON.parse(readFileSync(RETRIED, 'utf8')) : [],
  );

  // refuges.info already ships these; no point paying for them twice.
  let places = [...byId.values()].filter((h) => {
    if (refuges[h.id]) return false;
    const already = index[h.id];
    if (!already) return true; // never looked at
    // Present but empty: worth another go, once per retry pass.
    return RETRY_EMPTY && already.length === 0 && !retried.has(h.id);
  });
  places.sort((a, b) => a.id.localeCompare(b.id));
  const candidates = places.length; // before LIMIT thins it, for the projection
  if (LIMIT) {
    const step = Math.max(1, Math.floor(places.length / LIMIT));
    places = places.filter((_, i) => i % step === 0).slice(0, LIMIT);
  }

  console.log(`${byId.size.toLocaleString()} places, ${Object.keys(refuges).length.toLocaleString()} already from refuges.info`);
  if (resumed) console.log(`resuming: ${resumed.toLocaleString()} already resolved on disk`);
  if (RETRY_EMPTY) {
    const kept = Object.values(index).filter((v) => v.length).length;
    console.log(`RETRY pass: keeping ${kept.toLocaleString()} existing photos, re-attempting the empties`);
    if (retried.size) console.log(`  ${retried.size.toLocaleString()} already re-attempted in an earlier pass`);
  }
  console.log(`resolving ${places.length.toLocaleString()}${LIMIT ? ' (SAMPLE)' : ''}\n`);
  if (!places.length) { console.log('nothing left to do'); return; }
  let done = 0, viaCommons = 0, viaSite = 0, none = 0;
  const t0 = Date.now();

  /**
   * Workers pulling from one shared queue.
   *
   * ⚠️ Sequential, this run takes 5.2 hours. The wait is almost entirely
   * latency — a Commons round trip, then somebody's hotel server in a valley —
   * not our own work, so overlapping a handful of places cuts it to about an
   * hour without asking any single host to do more.
   *
   * The websites are all DIFFERENT hosts, so concurrency costs them nothing.
   * Commons is the one shared endpoint, which is why each worker still pauses
   * between its own requests.
   *
   * ⚠️ FOUR, not six. At six the first full run held 6.8/s for 14,000 places
   * and then fell to 0.3/s before dying — the signature of Windows running out
   * of sockets, since each closed connection lingers in TIME_WAIT. Fewer
   * workers with the same per-worker pause trades a little speed for a run that
   * finishes.
   */
  const CONCURRENCY = 4;
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= places.length) return;
      const hut = places[i];
      const found: Photo[] = [];

      const c = await commonsByName(hut);
      if (c.length) { found.push(...c); viaCommons++; }
      await sleep(180);

      if (found.length < 2) {
        const w = await fromWebsite(hut);
        if (w.length) { found.push(...w); viaSite++; }
        await sleep(180);
      }

      // ⚠️ AN EMPTY ENTRY IS RECORDED TOO, and it earns its bytes. Roughly
      // three quarters of places have no photo anywhere, and without a negative
      // entry the app cannot tell "nothing exists" from "not looked at yet" —
      // so it would repeat the full Commons-plus-website sweep on every single
      // view of every one of them. That sweep is the slowest case there is,
      // because every source is tried and every one fails.
      index[hut.id] = found.slice(0, MAX_PER_HUT);
      if (!found.length) none++;
      if (RETRY_EMPTY) retried.add(hut.id);

      done++;
      if (done % 50 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        const left = ((places.length - done) / rate / 60).toFixed(0);
        // In a retry pass the useful number is what this pass RECOVERED, not the
        // index total — that starts at several thousand and barely moves.
        const hits = RETRY_EMPTY ? done - none : Object.values(index).filter((v) => v.length).length;
        process.stdout.write(
          `\r  ${done}/${places.length}  ${RETRY_EMPTY ? 'recovered' : 'with photos'} ${hits}  ` +
          `(${((hits / done) * 100).toFixed(0)}%)  ${rate.toFixed(1)}/s  ~${left} min left   `,
        );
      }
      // Save as we go, so a crash costs minutes rather than the whole run.
      if (done % 250 === 0) {
        writeFileSync(OUT, JSON.stringify(index));
        if (RETRY_EMPTY) writeFileSync(RETRIED, JSON.stringify([...retried]));
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  writeFileSync(OUT, JSON.stringify(index));
  // The pass finished, so the scratch list has nothing left to protect.
  if (RETRY_EMPTY && existsSync(RETRIED)) rmSync(RETRIED);

  const kb = JSON.stringify(index).length / 1024;
  const total = Object.keys(index).length;
  const hit = Object.values(index).filter((v) => v.length).length;
  console.log(`\n\n${'='.repeat(58)}`);
  console.log(`${RETRY_EMPTY ? 're-attempted' : 'resolved  '} ${done.toLocaleString()}`);
  console.log(`${RETRY_EMPTY ? 'recovered ' : 'with photo'} ${(done - none).toLocaleString()}  ${(((done - none) / done) * 100).toFixed(1)}%   <- the REAL rate`);
  console.log(`  Commons  ${viaCommons.toLocaleString()}`);
  console.log(`  website  ${viaSite.toLocaleString()}`);
  console.log(`still none ${none.toLocaleString()}  ${((none / done) * 100).toFixed(1)}%`);
  console.log(`\nINDEX NOW  ${hit.toLocaleString()} of ${total.toLocaleString()} places have a photo  ${((hit / total) * 100).toFixed(1)}%`);
  console.log(`index      ${kb.toFixed(0)} KB`);
  if (LIMIT) {
    // This pass's own rate, not the index-wide one — a sample says nothing
    // about places it never touched.
    const rate = (done - none) / done;
    const hours = (((Date.now() - t0) / done) * candidates) / 3_600_000;
    if (RETRY_EMPTY) {
      // ⚠️ A retry projects RECOVERY over the empties, not coverage over
      // everything. Reusing the fresh-build projection here printed an index
      // size of 829 MB — it was extrapolating the whole index from a sample
      // that only ever touched the misses.
      console.log(`\nprojected over all ${candidates.toLocaleString()} empties: ` +
        `~${Math.round(rate * candidates).toLocaleString()} recovered, ` +
        `${hours.toFixed(1)} h to run`);
    } else {
      const full = byId.size - Object.keys(refuges).length;
      console.log(`\nprojected for all ${full.toLocaleString()}: ` +
        `${Math.round(rate * full).toLocaleString()} with photos, ` +
        `${((kb / done) * full / 1024).toFixed(1)} MB index, ` +
        `${((((Date.now() - t0) / done) * full) / 3_600_000).toFixed(1)} h to build`);
    }
  }
  console.log(`-> ${OUT}`);
}

main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
