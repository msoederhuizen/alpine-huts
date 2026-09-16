import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { fetchAccommodations, fetchCoreHuts } from '../api/overpass';
import { effectiveScope, inScope } from '../constants/region';
import {
  BUNDLE_GENERATED_AT,
  bundledAccommodations,
  bundledCoreHuts,
} from '../data/hutBundle';
import { useSelectedRegionsStore } from '../store/selectedRegionsStore';
import type { Hut } from '../types/hut';
import { collapseDuplicatePlaces } from '../utils/dedupePlaces';
import {
  isFallbackHutName,
  isOvernightCapable,
  unnamedHutLabel,
} from '../utils/hutMeta';
import { cleanAccommodations } from '../utils/lodging';
import { useVillages } from './useVillages';

/** OSM address keys that name the settlement, most specific first. */
const ADDR_PLACE_KEYS = [
  'addr:village',
  'addr:hamlet',
  'addr:suburb',
  'addr:place',
  'addr:city',
];

/** Specificity of a hut TYPE, for picking between two mappings of one place.
 *  "Rifugio Col Alt" exists in OSM as both an alpine_hut and a guest_house; the
 *  alpine_hut is the more useful truth, so it should win regardless of which
 *  element happens to carry more tags. */
const TYPE_RANK: Record<string, number> = {
  alpine_hut: 3,
  wilderness_hut: 3,
  shelter: 2,
  guesthouse: 1,
};

/** How "informative" an element is — used to keep the best of several OSM
 *  elements that map the same physical place. */
function placeScore(h: Hut): number {
  let s = Object.keys(h.tags).length * 0.01;
  if (h.tags.tourism) s += 4;
  if (ADDR_PLACE_KEYS.some((k) => h.tags[k])) s += 2;
  if (h.tags.ele) s += 1;
  if (h.id.startsWith('node/')) s += 0.5; // the POI point, not a building outline
  // Outranks `ele` and tag-count noise, but not `tourism` — a tagged POI still
  // beats an untagged building outline of a "better" type.
  s += (TYPE_RANK[h.type] ?? 0) * 1.5;
  return s;
}

function haversineKm(a: Hut, b: Hut): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The settlement a hut sits in: its `addr:*` place tag if present, else the
 *  nearest fetched village within ~8 km (null if nothing close). */
function localityFor(hut: Hut, villages: Hut[]): string | null {
  for (const k of ADDR_PLACE_KEYS) {
    const v = hut.tags[k]?.trim();
    if (v) return v;
  }
  let best: Hut | null = null;
  let bestKm = Infinity;
  for (const v of villages) {
    const km = haversineKm(hut, v);
    if (km < bestKm) {
      bestKm = km;
      best = v;
    }
  }
  return best && bestKm <= 8 ? best.name : null;
}

/**
 * All huts for the user's chosen regions — the picked subregions plus their
 * ~150 km neighbourly halo (`regionsWithinKm`, driven by
 * `useSelectedRegionsStore`). Only these regions are ever fetched or merged, so
 * the map holds a bounded handful of regions' worth of huts, never all 14.
 *
 * Each region contributes two queries (core huts + heavier accommodations,
 * sequenced so they don't compete for Overpass), but display never waits on
 * them: the shipped offline bundle is read DIRECTLY as a base layer in the
 * merge below, so pins are present from the first frame and live results only
 * ever overlay/freshen them.
 */
export function useHuts() {
  const selected = useSelectedRegionsStore((s) => s.selected);
  // The picked regions + a HALO_KM border strip. Recompute only when the
  // selection actually changes.
  const selectedKey = [...selected].sort().join(',');
  const scope = useMemo(
    () => effectiveScope(selected),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKey],
  );

  /**
   * ⚠️ TWO-PHASE LOAD — the region you PICKED comes first.
   *
   * `effectiveScope` returns the picked region plus every neighbour reaching
   * into its HALO_KM border, which is 5–8 region files. Parsing them all before
   * the first render means your own region's huts queue behind up to seven
   * others: measured, a pick can pull 2 833 huts across 8 files. The map then
   * looks empty, or half-populated, for as long as that takes — which is
   * exactly the "huts appear late / disappear" complaint.
   *
   * So: render the picked region(s) alone on the first pass, then bring in the
   * border strip on the next tick. The halo only ever adds huts near the edges,
   * so the map is correct — just smaller — for that moment, and never goes
   * backwards.
   */
  const primaryRegions = useMemo(
    () => scope.regions.filter((r) => selected.includes(r.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKey, scope],
  );
  const [haloReady, setHaloReady] = useState(false);
  useEffect(() => {
    setHaloReady(false);
    // A tick, not an interaction handle: this must run even if the user never
    // touches the screen, and it must not block the first paint.
    const t = setTimeout(() => setHaloReady(true), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const effectiveRegions = haloReady ? scope.regions : primaryRegions;
  /** True while the border strip is still to come — for a subtle "loading" hint. */
  const isExpandingScope = !haloReady && scope.regions.length > primaryRegions.length;

  const coreResults = useQueries({
    queries: effectiveRegions.map((r) => ({
      queryKey: ['huts', 'core', r.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchCoreHuts(r.bbox, signal),
      // ⚠️ `staleTime: Infinity` — the shipped bundle IS the data. Don't
      // auto-refetch from Overpass on every launch: the bundle is seeded via
      // `initialData` (so `isLoading` is false immediately) AND read directly in
      // the merge, so the map is instant and network-free. This makes the app
      // fully OFFLINE for huts (great in the mountains) and stops hammering the
      // free public mirrors. Freshness comes from regenerating the bundle
      // (`npm run generate-huts`) before a release — OSM huts change rarely.
      // A manual `refetch()` still fetches live if ever wired to a UI control.
      staleTime: Infinity,
      initialData: () => bundledCoreHuts(r.id),
      initialDataUpdatedAt: BUNDLE_GENERATED_AT,
    })),
  });

  const accResults = useQueries({
    queries: effectiveRegions.map((r) => ({
      queryKey: ['huts', 'accommodations', r.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchAccommodations(r.bbox, signal),
      staleTime: Infinity, // bundle is the data — see the core query above
      retry: 1,
      initialData: () => bundledAccommodations(r.id),
      initialDataUpdatedAt: BUNDLE_GENERATED_AT,
    })),
  });

  // Villages for the same regions (used here just to label Naturfreundehäuser).
  const villages = useVillages();

  // Recombine only when a query actually resolves (stable updated-at signature),
  // not on every render.
  const coreSig = coreResults.map((q) => q.dataUpdatedAt).join(',');
  const accSig = accResults.map((q) => q.dataUpdatedAt).join(',');
  const villageSig = villages.length;

  const huts = useMemo(() => {
    const byId = new Map<string, Hut>();
    // ⚠️ BASE LAYER: the shipped offline snapshot for the EFFECTIVE regions,
    // read DIRECTLY from the bundle — not via react-query. This is what makes
    // the map fully populated from the very first frame and keeps it that way,
    // no matter what the query cache is doing (initialData shadowing, an
    // in-flight fetch, etc.). Live results below simply OVERLAY this per hut id,
    // so the offline data is never absent, only ever freshened. Scoped to
    // effectiveRegions so only the user's chosen area(s) + halo are shown.
    // Every hut is border-cropped to the scope (picked areas + HALO_KM). A
    // neighbouring region's file may be parsed for its border strip, but only
    // the huts actually near the picked area are kept — that's what keeps the
    // working set ~3× smaller than taking whole neighbours.
    // Also drops shelters you can't sleep in (weather shelters, lean-tos, rock
    // overhangs) — see `isOvernightCapable`. Applied here rather than only in the
    // generator so it takes effect on the already-shipped bundle.
    const keep = (h: Hut) => inScope(scope, h.lat, h.lon) && isOvernightCapable(h);
    for (const r of effectiveRegions) {
      for (const h of bundledCoreHuts(r.id) ?? []) if (keep(h)) byId.set(h.id, h);
    }
    for (const q of coreResults)
      for (const h of q.data ?? []) if (keep(h)) byId.set(h.id, h);

    // Accommodations must never overwrite a core hut of the same id, so snapshot
    // the core ids first; then layer bundle + live accommodations onto the rest.
    // Gathered separately from the core huts because the quality passes below
    // apply to THIS layer only — alpine huts/shelters are never filtered out.
    const coreIds = new Set(byId.keys());
    const accById = new Map<string, Hut>();
    for (const r of effectiveRegions) {
      for (const h of bundledAccommodations(r.id) ?? [])
        if (!coreIds.has(h.id) && keep(h)) accById.set(h.id, h);
    }
    for (const q of accResults)
      for (const h of q.data ?? [])
        if (!coreIds.has(h.id) && keep(h)) accById.set(h.id, h); // live overlays bundle

    // Strip non-lodging POIs the name-based query swept in (webcams, monitoring
    // stations…) and hotels packed into towns. See `cleanAccommodations`.
    for (const h of cleanAccommodations([...accById.values()], villages))
      byId.set(h.id, h);

    // Collapse the same physical place mapped as several OSM elements — a node
    // + building ways + a relation, all named the same a few metres apart (one
    // Naturfreundehaus was showing as 5 stacked pins). Compares real distance
    // against the 3×3 grid neighbourhood; the earlier version keyed on a
    // ~110 m CELL, so two elements 11 m apart either side of a boundary were
    // never even compared, which is why "Rifugio Col Alt" survived twice — once
    // as an alpine_hut and once as a guesthouse — and appeared to change its
    // icon on zoom. See `collapseDuplicatePlaces`.
    const collapsed = collapseDuplicatePlaces(
      Array.from(byId.values()),
      placeScore,
    );

    // ⚠️ Naming runs AFTER the place-collapse above, deliberately. The collapse
    // treats an element with no `name` tag as a duplicate only of a NAMED
    // neighbour, never of another unnamed one; if we relabelled first, two
    // distinct "Weather shelter"s would both look named and could be merged.
    return collapsed.map((h) => {
      // Give OSM's nameless huts a descriptive label — a bivouac is worth
      // planning around, a lean-to isn't, and "Unnamed shelter" hid the
      // difference. Applied here (not only in `buildHut`) so it also fixes the
      // already-shipped bundle, which has the old strings baked in.
      let name = h.name;
      if (/^Unnamed (shelter|hut)$/.test(name)) {
        name = unnamedHutLabel(h.type, h.tags);
      }

      // Generic names repeat constantly, so add the nearest settlement to tell
      // them apart in search and the route list. Same trick already used for
      // identically-named Naturfreundehäuser.
      if (/naturfreunde/i.test(name) || isFallbackHutName(name)) {
        const place = localityFor(h, villages);
        if (place && !name.toLowerCase().includes(place.toLowerCase())) {
          name = `${name} (${place})`;
        }
      }

      return name === h.name ? h : { ...h, name };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreSig, accSig, villageSig, selectedKey]);

  // Status is over the effective regions' queries (that's all there are). With
  // the bundle providing initialData these are rarely "loading" at all.
  const activeCore = coreResults;
  const activeAcc = accResults;

  return {
    isExpandingScope,
    huts,
    // Loading only while NO region has returned yet; error only if ALL failed.
    isLoading: activeCore.length > 0 && activeCore.every((q) => q.isLoading),
    isError: activeCore.length > 0 && activeCore.every((q) => q.isError),
    error: activeCore.find((q) => q.error)?.error,
    isFetching:
      activeCore.some((q) => q.isFetching) ||
      activeAcc.some((q) => q.isFetching),
    refetch: () => {
      coreResults.forEach((q) => q.refetch());
      accResults.forEach((q) => q.refetch());
    },
  };
}
