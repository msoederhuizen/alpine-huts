import { useMemo, useRef } from 'react';
import Supercluster from 'supercluster';

import type { BBox } from '../constants/region';
import type { Hut } from '../types/hut';

/**
 * Groups nearby huts into cluster bubbles so the map draws tens of markers
 * instead of hundreds.
 *
 * WHY: the data path is fast (the shipped bundle parses in ~90 ms), but a single
 * region still puts ~450 huts inside the opening camera, and every one of those
 * is a real native map annotation. Creating that many is what made the map take
 * ~a minute to populate — the markers themselves are already on the optimal
 * `image` code path, so the only remaining lever is drawing fewer of them.
 *
 * NOT the old reveal-span thinning that was torn out. That silently DROPPED huts
 * by a ranking score, so pins trickled in and vanished on zoom and you could
 * never tell whether a hut existed. Nothing is hidden here: every hut is either
 * its own pin or counted in a bubble you can tap to zoom into. The set is also a
 * pure function of (huts, viewport, zoom) — no sticky state, no ratchet, no
 * freeze-during-gesture — so it can't drift out of sync with itself.
 */

/** Clustering tuning. Exported so `scripts/measure-load.ts` can measure the real
 *  on-screen marker count with the exact values the app uses. */
export const CLUSTER_TUNING = {
  /** Zoom at which clustering stops and every hut gets its own pin.
   *
   *  Calibrated against the scale bar, not guessed: at Alpine latitudes a 100 px
   *  bar reads 5 km at ~z11.1, 2 km at ~z12.4, 1 km at ~z13.4. 11 means every
   *  bubble has split by the time the bar says 2 km, which is where you're
   *  looking at a single day's walk and want to see every hut. Costs ~52 markers
   *  at z12 instead of ~14 — trivial next to the pool's 98–128 ceiling. */
  maxZoom: 11,
  /** Cluster radius in pixels. Bigger = fewer, chunkier bubbles. */
  radius: 55,
  /** Below this, leave them as individual pins — a bubble reading "2" is worse
   *  than just showing the two huts. */
  minPoints: 3,
} as const;

/**
 * Most individual pins a viewport may hold before clustering is kept ON.
 *
 * ⚠️ THIS IS A CRASH GUARD, not a tidiness preference. The map renders markers
 * as never-unmounted POOL SLOTS, so the pools only ever grow to the worst
 * viewport you've panned through. That was fine when a region held ~850 huts and
 * full declustering gave ~70 pins. After the 2026-08 regeneration the Dolomites
 * hold 1 703 and Vorarlberg 2 197, and declustering gives 282 — pools peaking at
 * 331 native annotations, which is where react-native-maps on Fabric starts
 * dropping them. That is the "huts disappear when I zoom" report.
 *
 * 120 keeps the pools near the ~115 the map demonstrably ran well at: measured
 * across a full pan sweep, the cap takes the Dolomites from 331 pooled markers
 * to ~200 and the worst single viewport from 282 to 120. NOTHING IS HIDDEN by this: over the cap you simply get bubbles
 * again, and every hut is still either a pin or counted in one.
 */
const MAX_PINS_PER_VIEWPORT = 120;

export interface ClusterBubble {
  kind: 'cluster';
  key: string;
  /** supercluster's id, for `expansionZoomFor`. */
  id: number;
  count: number;
  lat: number;
  lon: number;
}
export interface ClusterLeaf {
  kind: 'hut';
  key: string;
  hut: Hut;
}
export type ClusterItem = ClusterBubble | ClusterLeaf;

interface LeafProps {
  hut: Hut;
}

/** Web-mercator zoom for a viewport that spans `longitudeDelta` degrees. */
export function zoomForLongitudeDelta(longitudeDelta: number): number {
  if (!(longitudeDelta > 0)) return 20;
  return Math.max(0, Math.min(20, Math.log2(360 / longitudeDelta)));
}

/**
 * Lays items out into fixed pool slots, keeping an item in whichever slot it
 * already occupies.
 *
 * WHY: the map renders markers as a pool of never-unmounted slots (see the
 * marker-pool comment in app/(tabs)/index.tsx). If slots were filled in list
 * order, slot 3 would mean "4th-nearest hut" — and as you pan, which hut that is
 * changes constantly. The slot stays mounted and just swaps its `image`, so you
 * watch a pin change colour and icon in place. Anchoring each item to its slot
 * means a hut's pin is stable for as long as it's on screen; only genuinely
 * vacated slots get re-targeted, and those were invisible anyway.
 *
 * Returns a sparse array indexed by slot. New items take the lowest free slots,
 * and since `items` arrives ranked nearest-first, the huts you're looking at
 * claim slots ahead of ones at the edge of the viewport.
 */
export function useSlotAssignment<T>(
  items: T[],
  keyOf: (item: T) => string,
): (T | undefined)[] {
  const slotOfKey = useRef(new Map<string, number>());
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;

  return useMemo(() => {
    const prev = slotOfKey.current;
    const next = new Map<string, number>();
    const taken = new Set<number>();
    const out: (T | undefined)[] = [];
    const unplaced: T[] = [];

    // Pass 1 — anything that already had a slot keeps it.
    for (const item of items) {
      const k = keyOfRef.current(item);
      const slot = prev.get(k);
      if (slot != null && !taken.has(slot)) {
        taken.add(slot);
        next.set(k, slot);
        out[slot] = item;
      } else {
        unplaced.push(item);
      }
    }

    // Pass 2 — everything new drops into the lowest free slots, nearest first.
    let cursor = 0;
    for (const item of unplaced) {
      while (taken.has(cursor)) cursor++;
      taken.add(cursor);
      next.set(keyOfRef.current(item), cursor);
      out[cursor] = item;
    }

    slotOfKey.current = next;
    return out;
  }, [items]);
}

export function useHutClusters(
  huts: Hut[],
  bounds: BBox,
  zoom: number,
  /** Skip clustering entirely and return every hut in view as its own pin. The
   *  map sets this from the SCALE BAR, not from zoom: which zoom shows "2 km"
   *  depends on screen width (9.4 on an iPad, 10.6 on a small phone), so an
   *  integer zoom threshold can't express "once the bar reads 2 km". */
  declusterAll = false,
): {
  items: ClusterItem[];
  /** Zoom that breaks a bubble apart, for the tap-to-expand animation. Null if
   *  the id isn't in the current index (see the implementation) — callers must
   *  fall back rather than assume a number. */
  expansionZoomFor: (clusterId: number) => number | null;
} {
  // Built once per hut set — NOT per camera change, which is what keeps panning
  // cheap. `huts` is already memoized upstream, so this rebuilds only when the
  // hut list or the Type/Facility filter actually changes.
  const index = useMemo(() => {
    const sc = new Supercluster<LeafProps>({ ...CLUSTER_TUNING });
    sc.load(
      huts.map((hut) => ({
        type: 'Feature' as const,
        properties: { hut },
        geometry: {
          type: 'Point' as const,
          coordinates: [hut.lon, hut.lat] as [number, number],
        },
      })),
    );
    return sc;
  }, [huts]);

  // Depend on the primitive bounds/zoom, not the camera object (a new identity
  // on every frame of a pan would recompute constantly).
  const { south, west, north, east } = bounds;
  // Querying supercluster ABOVE its maxZoom returns the raw points rather than
  // clusters — that's the documented way to ask for "no clustering".
  const zoomStep = declusterAll
    ? CLUSTER_TUNING.maxZoom + 1
    : Math.round(zoom);

  const items = useMemo(() => {
    // Defensive: a bad bbox (NaN camera mid-animation) would otherwise throw
    // during render and take the whole screen down. An empty frame recovers on
    // the next camera update; a crash doesn't.
    let raw: ReturnType<typeof index.getClusters>;
    try {
      raw = index.getClusters([west, south, east, north], zoomStep);
    } catch (err) {
      if (__DEV__) console.warn('[clusters] getClusters failed', err);
      return [];
    }
    // NB: keyed on supercluster's `cluster_id`. Snapping keys to a spatial grid
    // instead (to try to keep marker identity across zoom steps, so Fabric would
    // update views rather than replace them) was tried and MEASURED as useless —
    // 315 vs 313 views destroyed+created across a full zoom sweep, 1 extra view
    // reused. Cluster centroids shift too much between zoom levels for any grid
    // snap to match. Don't re-try it without measuring first.
    // ⚠️ If declustering would flood the viewport, stay clustered. Checked on
    // the ACTUAL result rather than on zoom, because density varies hugely
    // between regions — the same zoom gives 70 pins in the Bernese Oberland and
    // 282 in the Dolomites.
    if (declusterAll) {
      const loose = raw.filter((f) => !(f.properties as { cluster?: boolean }).cluster);
      if (loose.length > MAX_PINS_PER_VIEWPORT) {
        try {
          // ⚠️ CLAMP TO maxZoom. Supercluster returns RAW POINTS at any zoom
          // above its maxZoom — that's how "no clustering" is asked for — so
          // falling back to Math.round(zoom) at z13 returns the identical
          // flood and the cap does nothing at all. Measured: it fired on 0% of
          // viewports before this clamp.
          raw = index.getClusters(
            [west, south, east, north],
            Math.min(Math.round(zoom), CLUSTER_TUNING.maxZoom),
          );
        } catch {
          /* keep the declustered result rather than nothing */
        }
      }
    }

    return raw.map<ClusterItem>((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const props = f.properties as LeafProps & {
        cluster?: boolean;
        cluster_id?: number;
        point_count?: number;
      };
      if (props.cluster) {
        const id = props.cluster_id!;
        return {
          kind: 'cluster',
          key: `cluster-${id}`,
          id,
          count: props.point_count ?? 0,
          lat,
          lon,
        };
      }
      return { kind: 'hut', key: props.hut.id, hut: props.hut };
    });
  }, [index, south, west, north, east, zoomStep, zoom, declusterAll]);

  // Nearest-to-what-you're-looking-at first. The map renders these into a fixed
  // pool of marker slots, so this ordering decides which huts get the low slot
  // indices — i.e. when you zoom into a corner of the map, that corner's huts
  // are the ones that take (and keep) slots, instead of whatever happened to be
  // first in the hut file. Also keeps slot assignment stable while panning,
  // since the centre moves smoothly.
  const centreLat = (south + north) / 2;
  const centreLon = (west + east) / 2;
  const ranked = useMemo(() => {
    const lonScale = Math.cos((centreLat * Math.PI) / 180);
    const d2 = (lat: number, lon: number) => {
      const dy = lat - centreLat;
      const dx = (lon - centreLon) * lonScale;
      return dy * dy + dx * dx;
    };
    return [...items].sort((a, b) => {
      const da = a.kind === 'cluster' ? d2(a.lat, a.lon) : d2(a.hut.lat, a.hut.lon);
      const db = b.kind === 'cluster' ? d2(b.lat, b.lon) : d2(b.hut.lat, b.hut.lon);
      return da - db;
    });
  }, [items, centreLat, centreLon]);

  // `getClusterExpansionZoom` THROWS ("No cluster with the specified id") for an
  // id the current index doesn't know. Cluster ids belong to a specific index
  // instance, and the index is rebuilt whenever the hut list changes identity —
  // so a bubble rendered from the previous index and tapped during that window
  // could carry a dead id, throwing straight through the press handler.
  //
  // Defensive, NOT a diagnosed bug: in practice supercluster derives ids
  // deterministically from tree position, and `useHuts`' merge only renames a
  // few Naturfreundehäuser, so a rebuild yields the same ids and this was NOT
  // reproducible. Kept because the guard is free and an uncaught throw here
  // takes the whole screen down. Returns null so the caller falls back.
  const expansionZoomFor = useMemo(
    () => (clusterId: number): number | null => {
      try {
        return Math.min(index.getClusterExpansionZoom(clusterId), 18);
      } catch {
        return null;
      }
    },
    [index],
  );

  return { items: ranked, expansionZoomFor };
}
