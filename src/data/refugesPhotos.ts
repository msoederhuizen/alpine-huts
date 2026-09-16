import type { HutImage } from '../utils/hutImage';

/**
 * Hut photographs from refuges.info, collected at build time and shipped with
 * the app — so these cost NO network request at runtime and work offline from
 * the first launch.
 *
 * WHY THIS SOURCE IS THE GOOD ONE. It is matched by COORDINATES, not by name:
 * measured at 0–9 m against our own hut positions. Every failure the other
 * photo sources have produced — a Pension Edelweiss in the Harz, Monte
 * Cristallo the mountain, igloo villages in other resorts — depends on two
 * different places sharing a word, and that cannot happen here. A photo
 * attached to a refuge on refuges.info is a photo of that refuge.
 *
 * ⚠️ REGIONAL, and deliberately so: France, the Pyrenees and the nearby Alps,
 * 1,618 huts. It does nothing for Austria, Germany or Slovenia — which is
 * where Wikimedia is strongest, so the two sources complement rather than
 * overlap.
 *
 * Licensed CC-BY-SA, which asks for the photographer and the licence. 80% of
 * these name a contributor; the rest credit the site. Regenerate with
 * `npm run generate-refuges-photos`.
 */

interface Stored {
  url: string;
  credit: string;
  author?: string;
  link: string;
}

// `require`, not `import`: a large JSON `import` makes tsc infer the whole
// literal as a type. Same reasoning as the region files in hutBundle.ts.
const DATA: Record<string, Stored[]> = require('../../assets/data/refuges-photos.json');

export function refugesPhotosFor(hutId: string): HutImage[] {
  const found = DATA[hutId];
  if (!found?.length) return [];
  return found.map((p) => ({
    url: p.url,
    credit: p.credit,
    author: p.author,
    license: 'CC BY-SA',
    // The point page the photo came from, so the credit can link back to the
    // contributor's own upload — which is what CC-BY-SA attribution wants.
    link: p.link,
  }));
}
