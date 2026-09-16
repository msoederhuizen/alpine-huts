import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchVillages } from '../api/overpass';
import { effectiveScope, inScope } from '../constants/region';
import { BUNDLE_GENERATED_AT, bundledVillages } from '../data/hutBundle';
import { useSelectedRegionsStore } from '../store/selectedRegionsStore';
import type { Hut } from '../types/hut';

/**
 * Villages & towns for the user's chosen regions (+ ~150 km halo, same
 * `regionsWithinKm` scope as {@link import('./useHuts').useHuts}), combined and
 * de-duped. The offline bundle is read directly as a base layer so search /
 * locality-labelling always have the villages regardless of fetch state; live
 * results overlay it.
 */
export function useVillages(): Hut[] {
  const selected = useSelectedRegionsStore((s) => s.selected);
  const selectedKey = [...selected].sort().join(',');
  const scope = useMemo(
    () => effectiveScope(selected),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKey],
  );
  const effectiveRegions = scope.regions;

  const results = useQueries({
    queries: effectiveRegions.map((r) => ({
      queryKey: ['villages', r.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchVillages(r.bbox, signal),
      staleTime: Infinity, // bundle is the data — no launch refetch (see useHuts)
      initialData: () => bundledVillages(r.id),
      initialDataUpdatedAt: BUNDLE_GENERATED_AT,
    })),
  });

  const sig = results.map((q) => q.dataUpdatedAt).join(',');
  return useMemo(() => {
    const byId = new Map<string, Hut>();
    // BASE LAYER: bundled villages for the effective regions, read directly (not
    // via react-query); live results overlay.
    const keep = (v: Hut) => inScope(scope, v.lat, v.lon);
    for (const r of effectiveRegions) {
      for (const v of bundledVillages(r.id) ?? []) if (keep(v)) byId.set(v.id, v);
    }
    for (const q of results)
      for (const v of q.data ?? []) if (keep(v)) byId.set(v.id, v);
    return [...byId.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, selectedKey]);
}
