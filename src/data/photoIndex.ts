import type { HutImage } from '../utils/hutImage';

/**
 * Photos resolved at BUILD time for every place, shipped with the app.
 *
 * ⚠️ THIS EXISTS TO REMOVE RUNTIME LOOKUPS. The gallery used to search
 * Wikimedia Commons and fetch the hut's own website while the user waited:
 * slow on first view, flaky on a mountain connection, impossible offline, and
 * unmeasurable — nobody could see how often those lookups actually succeeded.
 *
 * Resolving them in `scripts/generate-photo-index.ts` fixes all four. The app
 * reads a map, and the map's size is the honest coverage figure rather than an
 * estimate. Measured on a 300-place sample: 26% of places yield a photo, not
 * the 60% a blend of per-source hit rates had suggested — because those rates
 * came from alpine huts and two thirds of the data is guesthouses.
 *
 * ⚠️ URLS, NOT BYTES. Bundling the images themselves is arithmetically out —
 * roughly 200 KB x thousands of places is gigabytes. This makes the gallery
 * appear with no lookup; `prefetchRoutePhotos` downloads real files for the
 * huts on a route, which is what makes those work with no signal at all.
 *
 * Regenerate with `npm run generate-photo-index` after the hut data changes.
 */

interface Stored {
  url: string;
  credit: string;
  author?: string;
  license?: string;
  link?: string;
}

// `require`, not `import`: a large JSON `import` makes tsc infer the entire
// literal as a type. Same reasoning as the region files in hutBundle.ts.
const DATA: Record<string, Stored[]> = require('../../assets/data/photo-index.json');

export function indexedPhotosFor(hutId: string): HutImage[] {
  const found = DATA[hutId];
  if (!found?.length) return [];
  return found.map((p) => ({
    url: p.url,
    credit: p.credit,
    author: p.author,
    license: p.license,
    link: p.link,
  }));
}

/** Whether this place was looked at when the index was built — true even when
 *  nothing was found, so callers can tell "no photo exists" from "not yet
 *  resolved" and only fall back to a live lookup for the latter. */
export function isIndexed(hutId: string): boolean {
  return hutId in DATA;
}
