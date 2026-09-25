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

  const before = Object.values(index).filter((v) => v?.length).length;
  let addedOv = 0;
  let addedBrave = 0;

  const taken = (id: string) => Boolean(index[id]?.length || refuges[id]?.length);

  for (const [id, photos] of Object.entries(openverse)) {
    if (!photos?.length || taken(id)) continue;
    index[id] = photos;
    addedOv++;
  }

  // After Openverse: a licensed name match beats an unlicensed one.
  for (const [id, photo] of Object.entries(brave)) {
    if (!photo?.url || taken(id)) continue;
    index[id] = [photo];
    addedBrave++;
  }

  writeFileSync(D('photo-index.json'), JSON.stringify(index));

  const after = Object.values(index).filter((v) => v?.length).length;
  console.log(`places with a photo: ${before.toLocaleString()} -> ${after.toLocaleString()}`);
  console.log(`  + openverse ${addedOv.toLocaleString()}`);
  console.log(`  + brave     ${addedBrave.toLocaleString()}   <- ~20% are the wrong building, review them`);
  console.log(`\nwrote ${D('photo-index.json')}`);
}

main();
