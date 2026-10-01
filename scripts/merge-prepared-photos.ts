/**
 * Fold the already-prepared photo files into the index, with NO network calls.
 *
 * WHY THIS EXISTS SEPARATELY FROM generate-photo-index. That script is the real
 * build and it is honest work: Commons round trips and a fetch of somebody's
 * hotel server for every place that still has nothing, which is about an hour
 * even at four workers. Nothing in it is needed to merge a file that a previous
 * run already wrote — and waiting an hour to LOOK at photos you have already
 * collected is the kind of delay that stops you looking.
 *
 * So this does only the merge, in seconds. The full build produces the same
 * result: every source read here is also read there, in the same order.
 *
 * ⚠️ ADDITIVE ONLY. A place that already has a photo is left alone, because the
 * sources merged here rank below everything the full build finds. It never
 * removes, so re-running is safe and re-running the full build overwrites it.
 *
 *   npm run merge-prepared-photos
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f: string) => join(ROOT, 'assets', 'data', f);

interface Photo {
  url: string;
  credit: string;
  author?: string;
  license?: string;
  link?: string;
}

const read = <T,>(p: string, fallback: T): T =>
  existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback;

function main() {
  const index = read<Record<string, Photo[]>>(D('photo-index.json'), {});
  const refuges = read<Record<string, Photo[]>>(D('refuges-photos.json'), {});
  const openverse = read<Record<string, Photo[]>>(D('openverse-photos.json'), {});
  /** One photo per place, not a gallery — see generate-photo-index. */
  const brave = read<Record<string, Photo>>(D('brave-images.json'), {});
  /** From `npm run photos-from-own-sites`; also one per place. */
  const ownSite = read<Record<string, Photo>>(D('own-site-photos.json'), {});

  const before = Object.values(index).filter((v) => v?.length).length;
  let addedOv = 0;
  let addedBrave = 0;
  let addedOwn = 0;
  let replacedBrave = 0;

  const taken = (id: string) => Boolean(index[id]?.length || refuges[id]?.length);

  /**
   * ⚠️ FIRST, AND THAT ORDER IS THE POINT. A photo on the hut's own homepage
   * was published by the people who run the hut, of the hut — there is no
   * matching step, so there is nothing to get wrong. Everything below is tied
   * to the place by an identifier, a position or, at worst, a name.
   *
   * ⚠️ AND THIS SOURCE WAS MISSING ENTIRELY. `photos-from-own-sites` has always
   * ended by printing "then: npm run merge-prepared-photos", but this file
   * never read its output — so those photos could not reach the app no matter
   * how often either script was run.
   */
  for (const [id, photo] of Object.entries(ownSite)) {
    if (!photo?.url || taken(id)) continue;
    index[id] = [photo];
    addedOwn++;
  }

  for (const [id, photos] of Object.entries(openverse)) {
    if (!photos?.length || taken(id)) continue;
    index[id] = photos;
    addedOv++;
  }

  // Last: matched on the NAME alone, where a human review rejected 46%.
  for (const [id, photo] of Object.entries(brave)) {
    if (!photo?.url || taken(id)) continue;
    index[id] = [photo];
    addedBrave++;
  }

  /**
   * ⚠️ AND WHERE BRAVE ALREADY WON, TAKE IT BACK. The loops above are additive,
   * so a place that picked up a Brave photo in an EARLIER run keeps it even
   * though a better source has since appeared. Re-ordering the loops alone
   * would silently leave those wrong-order entries in place for good.
   *
   * Only an entry that is exactly the Brave photo and nothing else is touched:
   * a gallery, or anything from a curated source, is left alone.
   */
  for (const [id, photo] of Object.entries(ownSite)) {
    if (!photo?.url) continue;
    const cur = index[id];
    const bravePhoto = brave[id];
    if (!bravePhoto?.url || cur?.length !== 1 || cur[0].url !== bravePhoto.url) continue;
    index[id] = [photo];
    replacedBrave++;
  }

  writeFileSync(D('photo-index.json'), JSON.stringify(index));

  const after = Object.values(index).filter((v) => v?.length).length;
  console.log(`places with a photo: ${before.toLocaleString()} -> ${after.toLocaleString()}`);
  console.log(`  + own site  ${addedOwn.toLocaleString()}   <- published by the hut, of the hut`);
  console.log(`  + openverse ${addedOv.toLocaleString()}`);
  console.log(`  + brave     ${addedBrave.toLocaleString()}   <- ~20% are the wrong building, review them`);
  if (replacedBrave) {
    console.log(`  own site replaced an older brave photo on ${replacedBrave.toLocaleString()} places`);
  }
  console.log(`\nwrote ${D('photo-index.json')}`);
}

main();
