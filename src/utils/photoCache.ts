import AsyncStorage from '@react-native-async-storage/async-storage';

import type { HutImage } from './hutImage';

/**
 * Remembers which photos a hut has, across app restarts.
 *
 * WHY: building a gallery costs up to four sequential network round trips —
 * Wikidata, Wikipedia, a Commons category, a Commons name search — plus the
 * hut's own website and one more request to name the photographers. React
 * Query caches that in MEMORY, so it is instant on the second visit but gone
 * the moment the app restarts, which is exactly when a walker reopens the hut
 * they are heading for.
 *
 * ⚠️ MISSES ARE CACHED TOO, and they matter more than hits. A hut with no
 * photos anywhere is the SLOWEST case, because every source is tried and every
 * one fails — and 39% of huts are in that position. Without a negative entry
 * that full sweep repeats on every single visit.
 *
 * Photo URLs change far more slowly than the app is used, so the TTLs are long.
 * A miss expires sooner than a hit, so a newly uploaded photo still surfaces
 * within a week or two rather than never.
 */

const PREFIX = 'alpine-huts.photos.';

/** Found photos: they effectively never change. */
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** No photos found: shorter, so somebody's new Commons upload can appear. */
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cap on stored photos per hut. The gallery shows them in order and nobody
 * swipes past a dozen; storing every Commons category hit would put megabytes
 * into AsyncStorage, whose Android default ceiling is about 6 MB.
 */
const MAX_STORED = 12;

interface Entry {
  at: number;
  photos: HutImage[];
}

export async function readCachedPhotos(hutId: string): Promise<HutImage[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + hutId);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    if (!entry || !Array.isArray(entry.photos)) return null;
    const ttl = entry.photos.length ? HIT_TTL_MS : MISS_TTL_MS;
    if (Date.now() - entry.at > ttl) return null;
    return entry.photos;
  } catch {
    // Unreadable or corrupt — behave as though nothing was cached.
    return null;
  }
}

export async function writeCachedPhotos(
  hutId: string,
  photos: HutImage[],
): Promise<void> {
  try {
    const entry: Entry = { at: Date.now(), photos: photos.slice(0, MAX_STORED) };
    await AsyncStorage.setItem(PREFIX + hutId, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable. Losing the cache only costs speed.
  }
}

/** Forget every cached gallery — for a "photos look wrong" escape hatch. */
export async function clearPhotoCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    /* nothing to do */
  }
}
