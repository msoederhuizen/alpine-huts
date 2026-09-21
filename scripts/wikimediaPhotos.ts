/**
 * Build-time: Wikidata, Wikipedia and Commons categories, resolved in batches.
 *
 * WHY THIS EXISTS. `hutPhotos.ts` asked these three sources on the phone, and
 * `generate-photo-index.ts` never did — it only ever tried Commons file SEARCH
 * and the place's own website. That was survivable while the runtime path still
 * ran, but `isIndexed()` now short-circuits it for all 21,576 indexed places, so
 * these three sources reach nobody at all.
 *
 * ⚠️ THEY ARE THE SAFEST SOURCES WE HAVE. Wikidata P18 is an image OF THAT
 * ENTITY, attached by a person who knew which building they meant. No name
 * matching happens anywhere in the chain — which is the failure mode behind
 * every wrong photo this project has shipped. Measured: 66% of photoless places
 * carrying a wikidata id have a P18, and 553 of those places are alpine huts.
 *
 * ⚠️ BATCHED, NOT PER-PLACE. The runtime functions ask about one hut at a time
 * because one hut is all a phone cares about. Here that would be ~1,600 requests
 * at Wikimedia for work their API does 50 at a time. Batching is both faster and
 * the polite way to use a donated service.
 */
import type { Hut } from '../src/types/hut';
import { resolveHutImage } from '../src/utils/hutImage';

export interface Photo {
  url: string;
  credit: string;
  author?: string;
  license?: string;
  link?: string;
}

/**
 * Wikimedia's policy asks every client to identify itself and say how to get in
 * touch. Sending this is COMPLIANCE, and nothing like pretending to be a browser
 * to get past a site that refused us — which we still do not do.
 */
const UA = {
  'User-Agent':
    'AlpineHutsApp/1.0 (hut photo index; https://github.com/alpine-huts) build script',
};

const MAX_PER_HUT = 4;
const BATCH = 50; // the Wikimedia APIs' own limit for titles/ids per request
const PAUSE_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** extmetadata values arrive as HTML. Flatten to something printable. */
function plain(html?: string): string | undefined {
  return (
    html
      ?.replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || undefined
  );
}

function creditFor(author?: string, license?: string): string {
  if (author && license) return `${author} · ${license}`;
  if (author) return `${author} · Wikimedia Commons`;
  return 'Photo: Wikimedia Commons';
}

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Turn Commons file names into displayable photos WITH their credits.
 *
 * ⚠️ The credit is the point of this request, not the URL — `commonsFilePathUrl`
 * could build a working link with no network at all. Most Commons photos are
 * CC-BY or CC-BY-SA, and those licences ask for the photographer by name.
 * Shipping the image without them is the part that would not be allowed.
 */
async function commonsFileInfo(files: string[]): Promise<Map<string, Photo>> {
  const out = new Map<string, Photo>();
  for (const group of chunk([...new Set(files)], BATCH)) {
    const titles = group.map((f) => `File:${f}`).join('|');
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
      `&titles=${encodeURIComponent(titles)}&prop=imageinfo` +
      `&iiprop=url|extmetadata&iiextmetadatafilter=Artist|LicenseShortName&iiurlwidth=1200`;
    const json = await getJson(url);
    const pages: any[] = json?.query?.pages ? Object.values(json.query.pages) : [];
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (!info?.thumburl) continue;
      const name = String(p.title ?? '').replace(/^File:/, '');
      const author = plain(info.extmetadata?.Artist?.value);
      const license = plain(info.extmetadata?.LicenseShortName?.value);
      out.set(name, {
        url: info.thumburl,
        credit: creditFor(author, license),
        author,
        license,
      });
    }
    await sleep(PAUSE_MS);
  }
  return out;
}

/** P18 (image) and P373 (Commons category) for a batch of Wikidata ids. */
async function wikidataClaims(
  ids: string[],
): Promise<Map<string, { image?: string; category?: string }>> {
  const out = new Map<string, { image?: string; category?: string }>();
  for (const group of chunk([...new Set(ids)], BATCH)) {
    const url =
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json` +
      `&props=claims&ids=${group.join('|')}`;
    const json = await getJson(url);
    for (const id of group) {
      const claims = json?.entities?.[id]?.claims;
      if (!claims) continue;
      const image = claims.P18?.[0]?.mainsnak?.datavalue?.value;
      const category = claims.P373?.[0]?.mainsnak?.datavalue?.value;
      if (typeof image === 'string' || typeof category === 'string') {
        out.set(id, {
          image: typeof image === 'string' ? image : undefined,
          category: typeof category === 'string' ? category : undefined,
        });
      }
    }
    await sleep(PAUSE_MS);
  }
  return out;
}

/**
 * Lead images for Wikipedia articles, batched per language.
 *
 * ⚠️ The API NORMALISES titles (underscores to spaces, first letter capitalised)
 * and answers under the normalised name, so asking for "Bivacco_Biagio_Musso"
 * and looking for it in the reply finds nothing. The `normalized` table it
 * returns is how the two are tied back together.
 */
async function wikipediaImages(
  refs: { lang: string; title: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>(); // "lang:Title" (as GIVEN) -> image url
  const byLang = new Map<string, string[]>();
  for (const { lang, title } of refs) {
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang)!.push(title);
  }

  for (const [lang, titles] of byLang) {
    for (const group of chunk([...new Set(titles)], BATCH)) {
      const url =
        `https://${lang}.wikipedia.org/w/api.php?action=query&format=json` +
        `&titles=${encodeURIComponent(group.join('|'))}` +
        `&prop=pageimages&piprop=original|thumbnail&pithumbsize=1200&pilimit=${BATCH}`;
      const json = await getJson(url);
      if (!json?.query) {
        await sleep(PAUSE_MS);
        continue;
      }
      // normalised name -> the name we asked with
      const asked = new Map<string, string>();
      for (const n of json.query.normalized ?? []) asked.set(n.to, n.from);

      for (const p of Object.values<any>(json.query.pages ?? {})) {
        const src = p.original?.source ?? p.thumbnail?.source;
        if (!src) continue;
        const original = asked.get(p.title) ?? p.title;
        out.set(`${lang}:${original}`, src);
      }
      await sleep(PAUSE_MS);
    }
  }
  return out;
}

/** Up to MAX_PER_HUT files from a Commons category. Not batchable — one call
 *  per category — but only a few hundred places have one. */
async function categoryFiles(category: string): Promise<string[]> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&list=categorymembers&cmtitle=${encodeURIComponent(category)}` +
    `&cmtype=file&cmlimit=${MAX_PER_HUT * 2}`;
  const json = await getJson(url);
  const members: any[] = json?.query?.categorymembers ?? [];
  return members
    .map((m) => String(m.title ?? ''))
    .filter((t) => /^File:.+\.(jpe?g|png)$/i.test(t))
    .map((t) => t.replace(/^File:/, ''))
    .slice(0, MAX_PER_HUT);
}

/**
 * Resolve every Wikimedia-reachable photo for these places.
 *
 * Returns only places something was found for; the caller decides what an empty
 * result means. Ordered so the strongest claim wins: the OSM tag a mapper put
 * there by hand, then P18, then the article's lead image, then the category.
 */
export async function resolveWikimedia(
  places: Hut[],
  log: (line: string) => void = () => {},
): Promise<Map<string, Photo[]>> {
  const found = new Map<string, Photo[]>();
  const needCredit = new Map<string, string[]>(); // commons filename -> hut ids
  const wantFile = (file: string, hutId: string) => {
    if (!needCredit.has(file)) needCredit.set(file, []);
    needCredit.get(file)!.push(hutId);
  };

  // ── 1. The OSM tags themselves. No request at all. ────────────────────────
  //
  // ⚠️ This also closes a COUNTING hole. resolveHutImage runs in the app before
  // the isIndexed() short-circuit, so these places always did show a photo —
  // but nothing recorded that, so every audit of the index called them missing.
  let fromTags = 0;
  const stillNeed: Hut[] = [];
  for (const hut of places) {
    const img = resolveHutImage(hut);
    if (!img) {
      stillNeed.push(hut);
      continue;
    }
    fromTags++;
    found.set(hut.id, [{ url: img.url, credit: img.credit }]);
    if (img.file) wantFile(img.file, hut.id); // Commons file: get its author
  }
  log(`  osm image/commons tag   ${fromTags}`);

  // ── 2. Wikidata P18 + P373 ────────────────────────────────────────────────
  const withQid = stillNeed.filter((h) => h.wikidata);
  const claims = await wikidataClaims(withQid.map((h) => h.wikidata!));
  const categories = new Map<string, string>(); // hut id -> "Category:X"
  const hasP18 = new Set<string>();
  let fromP18 = 0;
  for (const hut of stillNeed) {
    const c = hut.wikidata ? claims.get(hut.wikidata) : undefined;
    // A category from the OSM tag outranks P373: a mapper chose it for THIS place.
    const tagCat = hut.wikimediaCommons?.startsWith('Category:')
      ? hut.wikimediaCommons
      : undefined;
    const cat = tagCat ?? (c?.category ? `Category:${c.category}` : undefined);
    if (cat) categories.set(hut.id, cat);
    if (c?.image) {
      fromP18++;
      hasP18.add(hut.id);
      wantFile(c.image, hut.id);
    }
  }
  log(`  wikidata P18            ${fromP18}   (of ${withQid.length} with a qid)`);

  // ── 3. Wikipedia lead images, for what P18 did not cover ──────────────────
  const wpRefs: { lang: string; title: string; hut: Hut }[] = [];
  for (const hut of stillNeed) {
    if (!hut.wikipedia) continue;
    if (claims.get(hut.wikidata ?? '')?.image) continue; // P18 already has it
    const [lang, ...rest] = hut.wikipedia.split(':');
    const title = rest.join(':');
    if (lang && title) wpRefs.push({ lang, title, hut });
  }
  const wpImages = await wikipediaImages(wpRefs.map(({ lang, title }) => ({ lang, title })));
  let fromWp = 0;
  const wpFor = new Map<string, string>(); // hut id -> image url
  for (const { lang, title, hut } of wpRefs) {
    const src = wpImages.get(`${lang}:${title}`);
    if (!src) continue;
    fromWp++;
    wpFor.set(hut.id, src);
  }
  log(`  wikipedia lead image    ${fromWp}   (of ${wpRefs.length} with an article)`);

  // ── 4. Commons categories, for places still empty ─────────────────────────
  let fromCat = 0;
  const catFor = new Map<string, string[]>(); // hut id -> filenames
  for (const [hutId, cat] of categories) {
    // A curated single image already beat this; a category is the weaker claim,
    // holding whatever anyone filed under the name.
    if (hasP18.has(hutId) || wpFor.has(hutId)) continue;
    const files = await categoryFiles(cat);
    if (files.length) {
      fromCat++;
      catFor.set(hutId, files);
      for (const f of files) wantFile(f, hutId);
    }
    await sleep(PAUSE_MS);
  }
  log(`  commons category        ${fromCat}   (of ${categories.size} with a category)`);

  // ── 5. One pass for every Commons file's URL, author and licence ──────────
  const info = await commonsFileInfo([...needCredit.keys()]);

  const push = (hutId: string, photo: Photo) => {
    const list = found.get(hutId) ?? [];
    if (list.length >= MAX_PER_HUT) return;
    if (list.some((p) => p.url === photo.url)) return;
    list.push(photo);
    found.set(hutId, list);
  };

  // P18 first — the single curated image of this exact entity.
  for (const hut of stillNeed) {
    const file = hut.wikidata ? claims.get(hut.wikidata)?.image : undefined;
    const photo = file ? info.get(file) : undefined;
    if (photo) push(hut.id, photo);
  }
  // Then the article's lead image, credited to Wikipedia rather than a person:
  // pageimages gives a URL, not an author, and inventing one would be worse.
  for (const [hutId, src] of wpFor) {
    push(hutId, { url: src, credit: 'Photo: Wikipedia' });
  }
  // Then whatever the category holds.
  for (const [hutId, files] of catFor) {
    for (const f of files) {
      const photo = info.get(f);
      if (photo) push(hutId, photo);
    }
  }
  // Finally, backfill credits for the OSM-tag files resolved in step 1.
  for (const [file, hutIds] of needCredit) {
    const photo = info.get(file);
    if (!photo) continue;
    for (const hutId of hutIds) {
      const list = found.get(hutId);
      const tagged = list?.find((p) => !p.author && p.credit === 'Photo: Wikimedia Commons');
      if (tagged) {
        tagged.author = photo.author;
        tagged.license = photo.license;
        tagged.credit = photo.credit;
      }
    }
  }

  return found;
}
