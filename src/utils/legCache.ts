import type { RouteLeg } from '../api/brouter';

/**
 * Walking legs already computed, kept on the phone across restarts.
 *
 * ⚠️ WHY THIS IS WORTH THE DISK: THE HUTS DO NOT MOVE. The path from one refuge
 * to the next is the same walk today as it was last month, and the same walk for
 * everyone who asks — so a leg is computed once and is then simply a fact. The
 * only thing that invalidates it is OSM re-mapping the trail, which happens on a
 * timescale of years.
 *
 * ⚠️ AND BECAUSE PLANNING IS EXPENSIVE. Generating one multi-day trip asks
 * BRouter for about 63 legs, and the Plan tab runs SEVERAL searches per request
 * — balanced, then a shorter and a longer bias. React Query already shares
 * successful legs between those searches, but only in memory: close the app and
 * every one of them is paid for again. Re-opening a saved route, or nudging a
 * day's distance and re-planning, re-walked ground the phone already knew.
 *
 * ⚠️ WHAT IT DOES NOT DO, AND THE HONEST LIMIT. This helps ONE phone. It does
 * nothing for the server's CPU across users, which is the real capacity
 * question — a leg cached here was still computed by BRouter once per person.
 * The fix for that is an HTTP cache in front of BRouter on the server, where
 * identical requests are literally identical URLs. This is the half that can be
 * built before the server exists, not a substitute for it.
 *
 * Failures are deliberately NOT stored. `unroutable` in brouter.ts keeps those
 * for the session only, and for a reason documented there: a transient outage
 * written to disk would make huts permanently "unreachable".
 */

/**
 * ⚠️ THE FILESYSTEM IS REACHED LAZILY, AND THAT IS NOT STYLE. `brouter.ts` is
 * imported by `scripts/check-classic-routes.ts`, which runs under NODE — and
 * `expo-file-system/legacy` pulls in react-native, which Node cannot parse. A
 * plain top-level import here therefore broke `npm run check-routes`, the one
 * check that proves all 19 classic-route totals are unchanged. A cache must not
 * cost the ability to verify routing.
 *
 * So this module imports nothing at load time and asks for the filesystem only
 * when an operation actually runs. Off-device there is no filesystem, every call
 * resolves to null, and the cache is simply absent — which is exactly right for
 * a script measuring what the router returns.
 */
type FS = typeof import('expo-file-system/legacy');

let fsModule: FS | null | undefined;

async function fs(): Promise<FS | null> {
  if (fsModule !== undefined) return fsModule;
  try {
    fsModule = await import('expo-file-system/legacy');
  } catch {
    fsModule = null; // not on a device — no cache, and no error either
  }
  return fsModule;
}

/** Alongside the other caches in the document directory, which survives updates. */
function dirOf(FileSystem: FS): string {
  return `${FileSystem.documentDirectory}legs/`;
}

/**
 * ⚠️ 20 MB, AND IT IS A CEILING RATHER THAN A TARGET. A leg's geometry is a few
 * hundred coordinate pairs — 5–40 KB each — so this holds roughly a thousand,
 * many more than one walker's planning produces. It exists so a pathological
 * session cannot fill someone's phone, not because the space is expected to be
 * used.
 */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * ⚠️ A YEAR. Trails are re-mapped on a timescale of years, and a stale leg is a
 * drawn line that is slightly wrong — not a wrong hut, and not a distance wrong
 * by any amount that changes a decision. Expiring sooner would throw away the
 * whole benefit to guard against something that barely happens.
 */
const TTL_MS = 365 * 24 * 60 * 60 * 1000;

interface Stored {
  at: number;
  leg: RouteLeg;
}

/**
 * A filename from the cache key.
 *
 * ⚠️ HASHED, NOT ESCAPED. The key holds coordinates, a profile name and
 * optional waypoints — commas, pipes, minus signs and dots. Some are legal in a
 * filename and some are not, on filesystems that differ between the two
 * platforms, and a key that collides or that the OS silently rewrites is a cache
 * that hands back another leg's geometry. A fixed-width hash sidesteps all of it.
 */
function fileFor(dir: string, key: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `${dir}${h1.toString(36)}${h2.toString(36)}.json`;
}

let ready: Promise<void> | null = null;
function ensureDir(FileSystem: FS): Promise<void> {
  ready ??= FileSystem.makeDirectoryAsync(dirOf(FileSystem), { intermediates: true }).catch(() => {});
  return ready;
}

/** A leg computed earlier, or null. Never throws: a broken cache is a miss. */
export async function readCachedLeg(key: string): Promise<RouteLeg | null> {
  try {
    const FileSystem = await fs();
    if (!FileSystem) return null;

    const path = fileFor(dirOf(FileSystem), key);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory) return null;

    const stored = JSON.parse(await FileSystem.readAsStringAsync(path)) as Stored;
    if (!stored?.leg || Date.now() - stored.at > TTL_MS) return null;
    // A leg with no geometry is not a leg; treating it as a hit would draw a
    // route with no line and look like a rendering bug.
    if (!Array.isArray(stored.leg.coordinates) || !stored.leg.coordinates.length) return null;
    return stored.leg;
  } catch {
    return null;
  }
}

export async function writeCachedLeg(key: string, leg: RouteLeg): Promise<void> {
  try {
    if (!leg?.coordinates?.length) return;
    const FileSystem = await fs();
    if (!FileSystem) return;
    await ensureDir(FileSystem);
    await FileSystem.writeAsStringAsync(
      fileFor(dirOf(FileSystem), key),
      JSON.stringify({ at: Date.now(), leg }),
    );
  } catch {
    // Out of space, or the directory vanished. A cache that cannot be written
    // is a slower app, not a broken one.
  }
}

/**
 * Drop the oldest legs until the directory is under the cap.
 *
 * Call it occasionally — after a plan completes — rather than on every write,
 * which would stat every file on disk for each of 63 legs.
 */
export async function pruneLegCache(): Promise<void> {
  try {
    const FileSystem = await fs();
    if (!FileSystem) return;
    const dir = dirOf(FileSystem);
    const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
    if (names.length < 2) return;

    const files: { path: string; size: number; at: number }[] = [];
    let total = 0;
    for (const n of names) {
      const path = `${dir}${n}`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists || info.isDirectory) continue;
      const size = info.size ?? 0;
      total += size;
      files.push({ path, size, at: info.modificationTime ?? 0 });
    }
    if (total <= MAX_BYTES) return;

    files.sort((a, b) => a.at - b.at); // oldest first
    for (const f of files) {
      if (total <= MAX_BYTES) break;
      await FileSystem.deleteAsync(f.path, { idempotent: true }).catch(() => {});
      total -= f.size;
    }
  } catch {
    // Housekeeping. Failing at it must never surface to the walker.
  }
}

export async function cachedLegBytes(): Promise<number> {
  try {
    const FileSystem = await fs();
    if (!FileSystem) return 0;
    const dir = dirOf(FileSystem);
    const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
    let total = 0;
    for (const n of names) {
      const info = await FileSystem.getInfoAsync(`${dir}${n}`);
      if (info.exists && !info.isDirectory) total += info.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}

export async function clearLegCache(): Promise<void> {
  try {
    const FileSystem = await fs();
    if (!FileSystem) return;
    await FileSystem.deleteAsync(dirOf(FileSystem), { idempotent: true });
    ready = null;
  } catch {
    /* nothing to clear */
  }
}
