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
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
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

const LIMIT = Number(process.env.PHOTO_INDEX_LIMIT ?? 0);
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
const domainOf = (u: string) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
function absolute(src: string, page: string): string | null {
  const s = upgradeWix(decode(src.trim()));
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return null;
  if (s.startsWith('//')) return `https:${s}`;
  const o = `https://${domainOf(page)}`;
  return s.startsWith('/') ? o + s : `${o}/${s}`;
}
function siteUrl(raw?: string): string | null {
  if (!raw) return null;
  const t = raw.trim().split(/[\s,;]/)[0];
  if (!t) return null;
  const u = /^https?:\/\//i.test(t) ? t.replace(/^http:/i, 'https:') : `https://${t}`;
  return /^https:\/\/[^/\s.]+\.[^/\s]+/i.test(u) ? u : null;
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
/** Real pixels, from the file header. Rejects logos and thumbnails. */
async function isPhoto(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-16383' } });
    if (!r.ok && r.status !== 206) return true;
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length < 26) return false;
    if (b[0] === 0x89 && b[1] === 0x50) {
      if (b[25] === 4 || b[25] === 6) return false;
      const be = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      return Math.max(be(16), be(20)) >= 500;
    }
    for (let i = 2; i < b.length - 9; i++) {
      if (b[i] !== 0xff) continue;
      const mk = b[i + 1];
      if (mk < 0xc0 || mk > 0xcf || mk === 0xc4 || mk === 0xc8 || mk === 0xcc) continue;
      return Math.max((b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]) >= 500;
    }
    return true;
  } catch {
    return true;
  }
}
async function fromWebsite(hut: Hut): Promise<Photo[]> {
  const page = siteUrl(hut.website);
  if (!page) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(page, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return [];
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
      if (await isPhoto(c)) {
        return [{ url: c, credit: `Photo: ${domainOf(page)}`, link: from }];
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

  // refuges.info already ships these; no point paying for them twice.
  let places = [...byId.values()].filter((h) => !refuges[h.id]);
  places.sort((a, b) => a.id.localeCompare(b.id));
  if (LIMIT) {
    const step = Math.max(1, Math.floor(places.length / LIMIT));
    places = places.filter((_, i) => i % step === 0).slice(0, LIMIT);
  }

  console.log(`${byId.size.toLocaleString()} places, ${Object.keys(refuges).length.toLocaleString()} already from refuges.info`);
  console.log(`resolving ${places.length.toLocaleString()}${LIMIT ? ' (SAMPLE)' : ''}\n`);

  const index: Record<string, Photo[]> = {};
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
   */
  const CONCURRENCY = 6;
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

      done++;
      if (done % 50 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        const left = ((places.length - done) / rate / 60).toFixed(0);
        const withPhotos = Object.values(index).filter((v) => v.length).length;
        process.stdout.write(
          `\r  ${done}/${places.length}  with photos ${withPhotos}  ` +
          `(${((withPhotos / done) * 100).toFixed(0)}%)  ${rate.toFixed(1)}/s  ~${left} min left   `,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  writeFileSync(OUT, JSON.stringify(index));
  const kb = JSON.stringify(index).length / 1024;
  const hit = Object.values(index).filter((v) => v.length).length;
  console.log(`\n\n${'='.repeat(58)}`);
  console.log(`resolved   ${done.toLocaleString()}`);
  console.log(`with photo ${hit.toLocaleString()}  ${((hit / done) * 100).toFixed(1)}%   <- the REAL rate`);
  console.log(`  Commons  ${viaCommons.toLocaleString()}`);
  console.log(`  website  ${viaSite.toLocaleString()}`);
  console.log(`no photo   ${none.toLocaleString()}  ${((none / done) * 100).toFixed(1)}%`);
  console.log(`index      ${kb.toFixed(0)} KB for ${done.toLocaleString()} places`);
  if (LIMIT) {
    const full = byId.size - Object.keys(refuges).length;
    console.log(`\nprojected for all ${full.toLocaleString()}: ` +
      `${Math.round((hit / done) * full).toLocaleString()} with photos, ` +
      `${((kb / done) * full / 1024).toFixed(1)} MB index, ` +
      `${(((Date.now() - t0) / done) * full / 3_600_000).toFixed(1)} h to build`);
  }
  console.log(`-> ${OUT}`);
}

main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
