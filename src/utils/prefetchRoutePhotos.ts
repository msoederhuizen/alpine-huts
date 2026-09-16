import { fetchHutGallery } from '../api/hutPhotos';
import type { Hut } from '../types/hut';
import type { HutImage } from './hutImage';
import { writeCachedPhotos } from './photoCache';
import { downloadGalleries } from './photoFiles';

/**
 * Put the photos for the huts on your route onto the phone, in the background.
 *
 * This is the only thing that can make a hut page open INSTANTLY the first time
 * you look at it — the work happens while you are doing something else. And the
 * same download is what makes those photos work with no signal, which is the
 * point: you look up a hut when you are near it, and that is exactly where the
 * reception is worst.
 *
 * ⚠️ ROUTE ONLY. Never the map, never search results. Prefetching everything a
 * walker pans past would be gigabytes of downloads and their mobile data.
 *
 * Deliberately quiet: it resolves to nothing, reports nothing, and every failure
 * is swallowed. If it does not finish, the hut page falls back to fetching on
 * demand exactly as before.
 */

/** Guard against two tabs kicking this off at once for the same route. */
let running: string | null = null;

export async function prefetchRoutePhotos(huts: Hut[]): Promise<void> {
  if (!huts.length) return;
  const sig = huts.map((h) => h.id).join('|');
  if (running === sig) return;
  running = sig;

  try {
    const galleries = new Map<string, HutImage[]>();

    for (const hut of huts) {
      // `fetchHutGallery` reads the URL cache first, so huts already looked at
      // cost nothing here. The rest pay one lookup now instead of one later,
      // while the walker is still in signal.
      try {
        const photos = await fetchHutGallery(hut);
        if (photos.length) galleries.set(hut.id, photos);
      } catch {
        // One hut failing must not stop the rest of the route.
      }
    }

    const downloaded = await downloadGalleries(galleries);

    for (const [hutId, photos] of downloaded) {
      // Only rewrite the cache when something actually landed on disk —
      // otherwise this just re-writes what was already there.
      if (photos.some((p) => p.localUri)) await writeCachedPhotos(hutId, photos);
    }
  } catch {
    // Offline, or storage full. The app works exactly as it did before.
  } finally {
    running = null;
  }
}
