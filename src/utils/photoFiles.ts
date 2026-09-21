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

/**
 * Route photos. Never evicted: the whole promise of the route prefetch is that
 * those huts work in a valley with no signal, and a cache that can quietly drop
 * them keeps the feature's shape while removing the only reason it exists.
 */
const DIR = `${FileSystem.documentDirectory}web-photos/`;

/**
 * Photos of huts the walker actually opened, kept in case they open them again
 * somewhere without reception.
 *
 * ⚠️ SEPARATE DIRECTORY, and that is the point. Browsing is unbounded — pan
 * around for an evening and you could pull down a gigabyte — so this half has
 * to be capped and evicted. Route photos must not be evictable, so the two
 * cannot share a budget.
 */
const BROWSE_DIR = `${FileSystem.documentDirectory}web-photos-browsed/`;

/** How many photos per hut to keep offline. The hut page shows a gallery, but
 *  the cover is what you actually look for on the trail, and 15 huts x 4 photos
 *  is already ~12 MB of somebody's phone. */
const PER_HUT = 2;

/**
 * Ceiling for browsed photos — about 500 files, 250 huts.
 *
 * Generous on purpose: eviction is correct but it is also the only way a
 * `localUri` in the cache can start pointing at nothing, so the rarer it is the
 * better. `pruneMissingLocal` handles it when it does happen.
 */
const BROWSE_BUDGET_BYTES = 150 * 1024 * 1024;

/** djb2, hex. Only needs to be stable and collision-free enough for filenames. */
function hashUrl(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function localPathFor(url: string, dir: string): string {
  const ext = /\.(jpe?g|png|webp)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';
  return `${dir}${hashUrl(url)}.${ext}`;
}

/**
 * Ensure one photo is on disk. Returns its local `file://` URI, or null if the
 * download failed — in which case the caller keeps using the remote URL.
 *
 * Checks the ROUTE directory first whichever half is asking, so a hut that is
 * both on the route and browsed is not downloaded twice.
 */
async function ensureDownloaded(url: string, dir = DIR): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null; // already local, or unusable
  try {
    for (const d of new Set([DIR, dir])) {
      const existing = localPathFor(url, d);
      const info = await FileSystem.getInfoAsync(existing);
      if (info.exists && info.size > 0) return existing;
    }
    const dest = localPathFor(url, dir);
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
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
 * Keep the browse directory under its budget, oldest file first.
 *
 * Modification time is the only clock available here — `downloadAsync` sets it
 * and nothing re-touches a file on read, so this evicts least-recently-DOWNLOADED
 * rather than least-recently-used. For a cache whose entries are never rewritten
 * those are almost the same ordering, and the difference is not worth keeping a
 * separate access log on disk to fix.
 */
async function evictBrowsed(): Promise<void> {
  try {
    const names = await FileSystem.readDirectoryAsync(BROWSE_DIR).catch(() => [] as string[]);
    const files: { uri: string; size: number; at: number }[] = [];
    let total = 0;
    for (const n of names) {
      const info = await FileSystem.getInfoAsync(BROWSE_DIR + n);
      if (!info.exists || info.isDirectory) continue;
      const size = info.size ?? 0;
      files.push({ uri: BROWSE_DIR + n, size, at: info.modificationTime ?? 0 });
      total += size;
    }
    if (total <= BROWSE_BUDGET_BYTES) return;
    files.sort((a, b) => a.at - b.at);
    for (const f of files) {
      if (total <= BROWSE_BUDGET_BYTES) break;
      await FileSystem.deleteAsync(f.uri, { idempotent: true }).catch(() => {});
      total -= f.size;
    }
  } catch {
    // Nothing here is worth failing a screen over.
  }
}

/**
 * Put the photos of a hut the walker just OPENED onto the phone.
 *
 * ⚠️ This cannot help the first time — by the time it runs, the photo has
 * already been fetched over the network to be shown. What it buys is the SECOND
 * time, which is the one that happens in a valley with no reception, having
 * looked the hut up at home.
 *
 * Returns the gallery with `localUri` filled in when anything landed, or null
 * when nothing changed, so the caller can avoid a pointless cache rewrite.
 */
export async function keepBrowsedPhotos(
  photos: HutImage[],
): Promise<HutImage[] | null> {
  let changed = false;
  const out: HutImage[] = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (i >= PER_HUT || p.localUri) {
      out.push(p);
      continue;
    }
    const localUri = await ensureDownloaded(p.url, BROWSE_DIR);
    if (localUri) {
      changed = true;
      out.push({ ...p, localUri });
    } else {
      out.push(p);
    }
  }
  if (changed) await evictBrowsed();
  return changed ? out : null;
}

/**
 * Drop `localUri` from photos whose file is no longer there.
 *
 * ⚠️ WITHOUT THIS, EVICTION BREAKS THE GALLERY. `displayUri` returns
 * `localUri ?? url`, so a cached entry pointing at a deleted file renders a
 * broken image rather than falling back to the web — the one failure mode worse
 * than not caching at all. A handful of local stats costs nothing next to the
 * network request it is protecting.
 */
export async function pruneMissingLocal(photos: HutImage[]): Promise<HutImage[]> {
  if (!photos.some((p) => p.localUri)) return photos;
  const out: HutImage[] = [];
  for (const p of photos) {
    if (!p.localUri) {
      out.push(p);
      continue;
    }
    try {
      const info = await FileSystem.getInfoAsync(p.localUri);
      if (info.exists && (info.size ?? 0) > 0) out.push(p);
      else out.push({ ...p, localUri: undefined });
    } catch {
      out.push({ ...p, localUri: undefined });
    }
  }
  return out;
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

/** Bytes currently held, for a "downloaded photos" line in About. Counts both
 *  halves: to the person reading it, it is all just space the app is using. */
export async function downloadedPhotoBytes(): Promise<number> {
  let total = 0;
  for (const dir of [DIR, BROWSE_DIR]) {
    try {
      const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
      for (const n of names) {
        const info = await FileSystem.getInfoAsync(dir + n);
        if (info.exists && !info.isDirectory) total += info.size ?? 0;
      }
    } catch {
      // Directory missing simply means nothing downloaded yet.
    }
  }
  return total;
}

/** Delete every downloaded photo. Paired with clearing the URL cache. */
export async function clearDownloadedPhotos(): Promise<void> {
  await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
  await FileSystem.deleteAsync(BROWSE_DIR, { idempotent: true }).catch(() => {});
}
