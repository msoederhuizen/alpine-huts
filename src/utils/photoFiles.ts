import * as FileSystem from 'expo-file-system/legacy';

import type { HutImage } from './hutImage';

/**
 * Hut photos downloaded onto the phone, so a route works with no signal.
 *
 * ⚠️ WHAT THIS CAN AND CANNOT DO. Downloading cannot make the first open of an
 * arbitrary hut fast — if you have never opened it, the bytes are not here yet.
 * What it can do is fetch AHEAD OF TIME for the huts you are actually walking
 * to, which makes those instant and, more importantly, available when you are
 * standing in a valley with no reception. That is the case worth solving; idly
 * browsing huts over coffee is not.
 *
 * So this is only ever driven by the ROUTE (see `prefetchRoutePhotos`), never by
 * the map. Downloading every hut you pan past would be gigabytes and a lot of
 * somebody's mobile data.
 *
 * Files live in the document directory, like user photos do — it survives app
 * updates and the OS does not clear it. See `photoStorage.ts` for that sibling.
 */

const DIR = `${FileSystem.documentDirectory}web-photos/`;

/** How many photos per hut to keep offline. The hut page shows a gallery, but
 *  the cover is what you actually look for on the trail, and 15 huts x 4 photos
 *  is already ~12 MB of somebody's phone. */
const PER_HUT = 2;

/** djb2, hex. Only needs to be stable and collision-free enough for filenames. */
function hashUrl(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function localPathFor(url: string): string {
  const ext = /\.(jpe?g|png|webp)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';
  return `${DIR}${hashUrl(url)}.${ext}`;
}

/**
 * Ensure one photo is on disk. Returns its local `file://` URI, or null if the
 * download failed — in which case the caller keeps using the remote URL.
 */
async function ensureDownloaded(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null; // already local, or unusable
  const dest = localPathFor(url);
  try {
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists && info.size > 0) return dest;
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const res = await FileSystem.downloadAsync(url, dest);
    if (res.status !== 200) {
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      return null;
    }
    return dest;
  } catch {
    return null;
  }
}

/**
 * Download the first few photos of each hut and return the galleries with
 * `localUri` filled in, so the caller can write them back to the photo cache.
 *
 * Sequential on purpose. These are background downloads for a trip the walker
 * may not open for days; firing fifteen at once competes with whatever they are
 * actually doing, and on a mountain connection that is the difference between
 * slow and useless.
 */
export async function downloadGalleries(
  galleries: Map<string, HutImage[]>,
): Promise<Map<string, HutImage[]>> {
  const out = new Map<string, HutImage[]>();
  for (const [hutId, photos] of galleries) {
    const updated: HutImage[] = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (i >= PER_HUT || p.localUri) {
        updated.push(p);
        continue;
      }
      const localUri = await ensureDownloaded(p.url);
      updated.push(localUri ? { ...p, localUri } : p);
    }
    out.set(hutId, updated);
  }
  return out;
}

/** Bytes currently held, for a "downloaded photos" line in About. */
export async function downloadedPhotoBytes(): Promise<number> {
  try {
    const names = await FileSystem.readDirectoryAsync(DIR).catch(() => [] as string[]);
    let total = 0;
    for (const n of names) {
      const info = await FileSystem.getInfoAsync(DIR + n);
      if (info.exists && !info.isDirectory) total += info.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}

/** Delete every downloaded photo. Paired with clearing the URL cache. */
export async function clearDownloadedPhotos(): Promise<void> {
  await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
}
