import { useQueries, useQuery } from '@tanstack/react-query';
import { fetchLeg, fetchLegWithRide, type RouteLeg } from '../api/brouter';
import { currentMaxSac, usePreferencesStore } from '../store/preferencesStore';
import { useTripStore } from '../store/tripStore';
import type { Hut } from '../types/hut';
import type { RideUse } from '../types/ride';
import type { SacScale } from '../utils/sacScale';

/** A routed leg with distance, elevation and estimated walking time. */
export type LegStats = RouteLeg;

export interface LegResult {
  from: Hut;
  to: Hut;
  data?: LegStats;
  isLoading: boolean;
  isError: boolean;
}

export const legQueryOptions = (
  from: Hut,
  to: Hut,
  scenic = false,
  ride?: RideUse | null,
  /** The walker's SAC ceiling. Read once by the caller so every query in a
   *  render sees the same value. */
  maxSac: SacScale = currentMaxSac(),
) => ({
  // `scenic` and the ride id are part of the key so fast/scenic/ride geometries
  // cache separately (a leg walked vs ridden is a different route).
  // `via` belongs in the key too: the same hut pair routed through waypoints is
  // a different geometry, and a saved trip seeded without them must not be
  // served for a leg that has them.
  // ⚠️ `maxSac` belongs in the key. It selects the BRouter profile, so the same
  // hut pair is a DIFFERENT geometry at a different ceiling — leaving it out
  // would serve the old line after the walker changed the setting, and legs are
  // cached with `gcTime: Infinity` so it would never self-correct.
  queryKey: [
    'leg',
    from.id,
    to.id,
    scenic ? 'scenic' : 'fast',
    ride?.id ?? 'walk',
    to.via?.map((v) => `${v.lat},${v.lon}`).join('|') ?? 'direct',
    maxSac,
  ] as const,
  queryFn: ({ signal }: { signal: AbortSignal }): Promise<LegStats> =>
    ride
      ? fetchLegWithRide(
          { latitude: from.lat, longitude: from.lon },
          { latitude: to.lat, longitude: to.lon },
          ride,
          signal,
          scenic,
          maxSac,
        )
      : fetchLeg(
          { latitude: from.lat, longitude: from.lon },
          { latitude: to.lat, longitude: to.lon },
          signal,
          scenic,
          // ⚠️ Only the plain path carries vias. A leg that also uses a lift is
          // already stitched from two sub-routes around the ride, and forcing
          // extra waypoints through that would be ambiguous — no classic route
          // currently needs both.
          to.via,
          maxSac,
        ),
  staleTime: Infinity,
  // ⚠️ Never garbage-collect a routed leg. Opening a saved trip SEEDS this cache
  // from the trip's stored geometry (see app/(tabs)/saved.tsx); with the default
  // 5-minute gcTime that seed would be dropped as soon as you left the Route tab
  // for a while, and with no signal there'd be no way to get it back. Legs are
  // small in memory and bounded by how many huts a trip has.
  gcTime: Infinity,
  retry: 1,
});

/**
 * Route a single leg. Used per-row so a leg resolving only re-renders its own
 * card instead of the whole draggable list. Shares the ['leg', from, to] cache
 * with useRouteLegs, so no duplicate fetching.
 */
export function useLeg(
  from: Hut,
  to: Hut,
  ride?: RideUse | null,
): { data?: LegStats; isLoading: boolean; isError: boolean } {
  const scenic = useTripStore((s) => s.scenic);
  // Subscribed, not read via getState: changing the ceiling must re-render and
  // re-key the query, otherwise the old geometry stays on screen.
  const maxSac = usePreferencesStore((s) => s.maxSac);
  const q = useQuery(legQueryOptions(from, to, scenic, ride, maxSac));
  return { data: q.data, isLoading: q.isLoading, isError: q.isError };
}

/**
 * Route every consecutive pair of selected huts along real trails (BRouter).
 * Each leg is cached by its hut pair, so reordering the route only fetches the
 * newly-adjacent pairs rather than recomputing everything.
 */
export function useRouteLegs(): LegResult[] {
  const huts = useTripStore((s) => s.huts);
  const scenic = useTripStore((s) => s.scenic);
  const rides = useTripStore((s) => s.rides);
  const maxSac = usePreferencesStore((s) => s.maxSac);

  const pairs = huts.slice(1).map((to, i) => ({ from: huts[i], to }));

  const results = useQueries({
    queries: pairs.map(({ from, to }, i) =>
      legQueryOptions(from, to, scenic, rides[i] ?? null, maxSac),
    ),
  });

  return pairs.map(({ from, to }, i) => ({
    from,
    to,
    data: results[i]?.data,
    isLoading: results[i]?.isLoading ?? false,
    isError: results[i]?.isError ?? false,
  }));
}
