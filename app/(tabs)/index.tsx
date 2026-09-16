import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Polyline, type Region as MapCamera } from 'react-native-maps';

import { useQueryClient } from '@tanstack/react-query';

import { isRouterUnavailable, type LatLng } from '../../src/api/brouter';
import { legQueryOptions } from '../../src/hooks/useRouteLegs';
import { coloredShadow, COLORS, GRADIENT, RADIUS } from '../../src/constants/theme';
import { HutSelectionCard } from '../../src/components/HutSelectionCard';
import {
  ClusterMarker,
  HaloMarker,
  HutMarker,
  HutPinPool,
  NumberedMarker,
  type MarkerHandle,
} from '../../src/components/map/MapMarkers';
import {
  DECLUSTER_SCALE_M,
  ScaleBar,
  scaleBarDistanceM,
} from '../../src/components/map/ScaleBar';
import { RegionPicker } from '../../src/components/RegionPicker';
import {
  bboxToMapRegion,
  REGIONS,
  unionBBox,
} from '../../src/constants/region';
import { bundledRegionOf, searchBundledPlaces } from '../../src/data/hutBundle';
import { useHuts } from '../../src/hooks/useHuts';
import { useRouteLegs } from '../../src/hooks/useRouteLegs';
import { useVillages } from '../../src/hooks/useVillages';
import {
  useHutClusters,
  useSlotAssignment,
  zoomForLongitudeDelta,
  type ClusterBubble,
  type ClusterLeaf,
} from '../../src/hooks/useHutClusters';
import { useAlternativesStore } from '../../src/store/alternativesStore';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSelectedRegionsStore } from '../../src/store/selectedRegionsStore';
import { useTripStore } from '../../src/store/tripStore';
import type { Hut, HutType } from '../../src/types/hut';
import { formatDistance, formatElevation } from '../../src/utils/format';
import {
  ACCOM_TYPES,
  hutPinColor,
  hutPinIcon,
  hutTypeLabel,
  hutTypeShortLabel,
} from '../../src/utils/hutMeta';
import { villagesShadowedByHut } from '../../src/utils/dedupePlaces';

/** Gap between the status bar and the floating search bar. Smaller than the
 *  old header inset, so the bar sits slightly higher than before. */
const SEARCH_TOP_GAP = 6;

// Slot identity for the bubble pool. Module-level so it's referentially
// stable — an inline arrow would be a new function every render.
const bubbleKey = (b: ClusterBubble) => `c${b.id}`;

/**
 * One marker pool PER PIN TYPE, so a slot's `image` is fixed for its entire life
 * and re-targeting only ever moves it.
 *
 * WHY: a single mixed pool re-pointed slot 7 from a wilderness hut to a
 * guesthouse in one commit — changing `coordinate` AND `image` together. iOS
 * resolves a new marker image asynchronously, so the pin jumped to the new place
 * while still wearing the old icon, then corrected a frame later. That is why
 * isolated "Berghotel Faulhorn" (nothing else within 1.5 km, so no duplicate to
 * blame) appeared as a wilderness hut before settling into a guesthouse: zooming
 * past the decluster threshold broke its bubble apart and handed it a slot some
 * wilderness hut had been using.
 *
 * Splitting by type makes that impossible to express — a guesthouse slot only
 * ever shows the guesthouse image, empty or not. Costs the sum of the per-type
 * peaks rather than one global peak; measured at ~50 pins on screen that is a
 * few dozen extra parked markers, well under the pool ceiling that already ran
 * fine at 98–128.
 *
 * ⚠️ Must list EVERY HutType, or huts of an omitted type would silently never
 * render.
 */
const PIN_POOL_TYPES: readonly HutType[] = [
  'alpine_hut',
  'wilderness_hut',
  'shelter',
  'guesthouse',
  'village',
];

const NO_HUTS: Hut[] = [];

/**
 * One accent per filter CATEGORY for the chips under the search bar — every
 * chip within a category shares it, so a glance tells you whether you're looking
 * at a place, a kind of accommodation, or a requirement.
 *
 * ⚠️ Type chips therefore do NOT use their pin colours here. On the map those
 * four colours distinguish types from each other; in this row that would be four
 * different colours for what is really one filter, drowning out the grouping.
 */
const CHIP_ACCENT = {
  region: { fg: COLORS.green, bg: COLORS.greenTint },
  type: { fg: COLORS.trail, bg: COLORS.trailTint },
} as const;

type ChipCategory = keyof typeof CHIP_ACCENT;

/**
 * Zoom from which village pins appear — ~2 km on the scale bar, which is also
 * where hut clustering stops (see CLUSTER_TUNING.maxZoom), so "zoom to 2 km and
 * you see everything individually" is one consistent rule.
 *
 * Measured, not guessed: 11 was the first choice, but in the densest part of
 * Ticino (750 villages in scope, lots of small hamlets) z11 puts 126 village
 * pins on screen at once — precisely the clutter the old "villages aren't drawn
 * as pins" note warned about. z12 brings that worst case to 60, and Bernese
 * Oberland to 26.
 */
const VILLAGE_MIN_ZOOM = 12;

/** The viewport's bounds, padded 30% on each side so a pin near the edge doesn't
 *  pop away before it's actually offscreen. This is the box the cluster index is
 *  queried for (see `useHutClusters`) — nothing is ranked or hidden, huts
 *  outside it are simply off-screen. */
function cameraBoundsPadded(cam: MapCamera) {
  const latPad = cam.latitudeDelta * 0.3;
  const lonPad = cam.longitudeDelta * 0.3;
  return {
    south: cam.latitude - cam.latitudeDelta / 2 - latPad,
    north: cam.latitude + cam.latitudeDelta / 2 + latPad,
    west: cam.longitude - cam.longitudeDelta / 2 - lonPad,
    east: cam.longitude + cam.longitudeDelta / 2 + lonPad,
  };
}

export default function MapScreen() {
  const selected = useTripStore((s) => s.huts);
  const toggle = useTripStore((s) => s.toggle);
  const scenic = useTripStore((s) => s.scenic);
  const queryClientForAdd = useQueryClient();

  /**
   * Add a hut — but check first that you can actually WALK there from the
   * current last stop, and say so here if you can't.
   *
   * ⚠️ The check happens on ADD, not on the Route tab. Previously an
   * unreachable hut was accepted silently and only revealed itself as a failed
   * day once you switched tabs — by which point you'd often added several more
   * and had to work out which one broke it.
   *
   * Removing is never blocked, and neither is the FIRST hut: with nothing to
   * walk from there is nothing to check.
   *
   * ⚠️ A router that cannot be REACHED must not block the add. `isRouterUnavailable`
   * separates "the router says there's no path" from "we never got an answer" —
   * treating a dead tunnel as "unreachable hut" would make the app unusable
   * offline, which is exactly when someone is standing in a valley planning
   * tomorrow.
   */
  const addOrRemove = useCallback(
    async (hut: Hut) => {
      const already = selected.some((h) => h.id === hut.id);
      const last = selected[selected.length - 1];
      if (already || !last) {
        toggle(hut);
        return;
      }
      try {
        await queryClientForAdd.ensureQueryData(legQueryOptions(last, hut, scenic));
        toggle(hut);
      } catch (err) {
        if (isRouterUnavailable(err)) {
          // Couldn't ask. Add it and let the Route tab retry.
          toggle(hut);
          return;
        }
        Alert.alert(
          `No walking route to ${hut.name}`,
          `${err instanceof Error ? err.message : 'No route was found.'}\n\n` +
            `Add it anyway if you plan to get there another way — the day will ` +
            `show as unroutable on the Route tab.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Add anyway', onPress: () => toggle(hut) },
          ],
        );
      }
    },
    [selected, toggle, queryClientForAdd, scenic],
  );
  const appendHut = useTripStore((s) => s.append);
  const setTrip = useTripStore((s) => s.setTrip);
  // The map is edge-to-edge, so the window width is the map's on-screen width —
  // used by the scale bar to turn a pixel width into a real-world distance.
  const { width: mapWidth } = useWindowDimensions();
  const router = useRouter();

  // react-native-maps won't paint Polyline overlays that were attached while the
  // map was off screen. A generated route lands in the store while this tab is
  // still backgrounded (it stays mounted), so the trail's overlays were built
  // against an off-screen map and stayed invisible until something forced a
  // redraw — tapping a pin (which mounts the hut card, causing a layout pass).
  //
  // Poking the live map to force that redraw doesn't work and isn't safe:
  // mounting the trail on focus was still too early (the tab is mid-transition),
  // and re-creating the overlays a beat later crashed the app natively.
  //
  // The regions the user chose in the picker. The huts/villages hooks read this
  // same store, so `huts` already contains ONLY these regions' (+ their ~150 km
  // halo) huts — bounded to a handful of regions, so the map just renders them
  // with no thinning/lazy-loading needed. `regionPickerOpen` drives the in-app
  // "manage regions" modal.
  const selectedRegionIds = useSelectedRegionsStore((s) => s.selected);
  const selectedRegions = useMemo(
    () => REGIONS.filter((r) => selectedRegionIds.includes(r.id)),
    [selectedRegionIds],
  );
  const insets = useSafeAreaInsets();

  /**
   * Whether to draw the native blue "you are here" dot.
   *
   * ⚠️ Permission must be requested EXPLICITLY. Setting react-native-maps'
   * `showsUserLocation` on its own does not reliably prompt on iOS — the map
   * simply shows no dot and it looks like the feature is broken. Asked once, on
   * first view of the map, so the prompt arrives with the map visible and the
   * reason obvious, rather than at cold start before anything is on screen.
   */
  const [showUserLocation, setShowUserLocation] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await Location.getForegroundPermissionsAsync();
        const granted = existing.granted
          ? existing
          : await Location.requestForegroundPermissionsAsync();
        if (!cancelled) setShowUserLocation(granted.granted);
      } catch {
        // Location is a convenience here — the map, route and huts all work
        // without it, so a failure must never surface as an error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const removeRegion = useSelectedRegionsStore((s) => s.remove);
  const addRegion = useSelectedRegionsStore((s) => s.add);
  const [regionPickerOpen, setRegionPickerOpen] = useState(false);
  const regionKey = [...selectedRegionIds].sort().join(',');

  // Rebuild the MapView (fresh mount) when the route changed while this tab was
  // backgrounded — react-native-maps won't paint Polyline overlays attached to
  // an off-screen map, so a fresh mount ensures the trail is present from the
  // first render — OR when the selected regions change (so the camera reframes
  // on them). The route case is only checked on focus (editing the route while
  // looking at the map updates in place); a region change rebuilds immediately
  // via the effect below.
  const mapSig = `${regionKey}#${selected.map((h) => h.id).join('|')}`;
  const mapSigRef = useRef(mapSig);
  mapSigRef.current = mapSig;
  const [mapKey, setMapKey] = useState(mapSig);
  /**
   * What the camera should be looking at — set by whichever happened LAST.
   *
   * Arriving on the tab means "show me my route". Changing the selected regions
   * while already here means "show me that region" — the newer instruction wins,
   * and must not be overridden by the route framing that a remount would
   * otherwise trigger. Leaving and coming back sets it straight back to 'route'.
   */
  const frameIntentRef = useRef<'route' | 'region'>('route');
  /** Latest `applyFrame`, so the effects below can stay dependency-free. */
  const applyFrameRef = useRef<(animated: boolean) => void>(() => {});

  useFocusEffect(
    // ⚠️ Deps MUST stay empty: this is about ARRIVING, not about the route
    // changing. Editing the route while looking at the map updates the trail in
    // place, and re-framing mid-edit would yank the camera out from under you.
    useCallback(() => {
      frameIntentRef.current = 'route';
      setMapKey(mapSigRef.current);
      // If the map remounts, `onMapReady` applies this. If it doesn't (route
      // unchanged since the last visit) that never fires, so this covers it.
      const t = setTimeout(() => applyFrameRef.current(false), 150);
      return () => clearTimeout(t);
    }, []),
  );

  // Region changed while we're already here → the region becomes the target.
  const firstRegionRun = useRef(true);
  useEffect(() => {
    if (firstRegionRun.current) {
      // Mount: the focus effect above already asked for 'route'. This effect
      // also runs on mount, and letting it through would immediately overwrite
      // that — landing you on the region instead of your route on first open.
      firstRegionRun.current = false;
      return;
    }
    frameIntentRef.current = 'region';
    setMapKey(mapSigRef.current);
    const t = setTimeout(() => applyFrameRef.current(true), 150);
    return () => clearTimeout(t);
  }, [regionKey]);

  // The current (settled) camera — drives which pins are rendered (plain
  // viewport crop). Reset to frame the selected regions whenever the map rebuilds.
  const [camera, setCamera] = useState<MapCamera>(() =>
    bboxToMapRegion(unionBBox(selectedRegions)),
  );
  useEffect(() => {
    setCamera(bboxToMapRegion(unionBBox(selectedRegions)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey]);

  const { huts, isLoading, isError, error, refetch, isExpandingScope } = useHuts();
  // Villages (not drawn as pins — too many, they'd clutter — but searchable).
  const villages = useVillages();

  // react-native-maps' onRegionChangeComplete is misleadingly named — on iOS it
  // fires repeatedly DURING an interactive pan/pinch, not once at the end. Each
  // call would recompute the viewport crop, so debounce it: only update `camera`
  // (which drives which pins render) once movement has settled for a beat.
  // Back down to a snappy value now that the marker POOL (see `plainMarkers`)
  // means a camera change re-targets existing markers instead of adding and
  // removing them. This was briefly raised to 450 ms to dodge the
  // react-native-maps add/remove crash; that didn't work, and the pool addresses
  // the cause instead — so there's no reason to make zooming feel laggy.
  const CAMERA_SETTLE_MS = 120;
  const cameraDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRegionChangeComplete = useCallback((region: MapCamera) => {
    if (cameraDebounceRef.current) clearTimeout(cameraDebounceRef.current);
    cameraDebounceRef.current = setTimeout(() => setCamera(region), CAMERA_SETTLE_MS);
  }, []);
  useEffect(
    () => () => {
      if (cameraDebounceRef.current) clearTimeout(cameraDebounceRef.current);
    },
    [],
  );

  const [activeHut, setActiveHut] = useState<Hut | null>(null);
  // The place picked from search gets a halo so it's obvious which pin it is
  // when neighbours are close together. Cleared by dismissCard() — i.e. by the
  // card's ✕ or by tapping the map.
  const [highlighted, setHighlighted] = useState<Hut | null>(null);
  // ...but the place itself stays pinned after the halo clears. Villages have no
  // pin of their own, so without this, dismissing the card made the thing you
  // just searched for vanish off the map entirely.
  const [foundPlace, setFoundPlace] = useState<Hut | null>(null);
  const activeHutRef = useRef<Hut | null>(null);
  useEffect(() => {
    activeHutRef.current = activeHut;
  }, [activeHut]);

  // On iOS, tapping a Marker also fires the MapView's onPress a beat later,
  // which would instantly dismiss the card the marker just opened. Record when
  // a marker was tapped and ignore a map press that lands right after it.
  const lastMarkerPress = useRef(0);

  // A tapped native pin stays "selected" (enlarged) until it's deselected.
  // Closing the card via the ✕ doesn't touch the map, so we deselect it
  // ourselves: react-native-maps' hideCallout() runs deselectAnnotation
  // natively, which shrinks the pin back — without removing it.
  const markerRefs = useRef(new Map<string, MarkerHandle>());
  // Stable ref registrar so `HutMarker` can be memoized — an inline
  // `markerRef={(r) => …}` closure would be a new prop every render and defeat
  // React.memo, re-rendering every pin on every pan.
  const registerMarkerRef = useCallback(
    (id: string, r: MarkerHandle | null) => {
      if (r) markerRefs.current.set(id, r);
      else markerRefs.current.delete(id);
    },
    [],
  );

  const selectHut = useCallback((hut: Hut) => {
    lastMarkerPress.current = Date.now();
    setActiveHut(hut);
  }, []);

  const dismissCard = useCallback(() => {
    const current = activeHutRef.current;
    if (current) markerRefs.current.get(current.id)?.hideCallout();
    setActiveHut(null);
    setHighlighted(null);
  }, []);

  const handleMapPress = useCallback(() => {
    Keyboard.dismiss();
    setFilterOpen(false);
    if (Date.now() - lastMarkerPress.current > 300) dismissCard();
  }, [dismissCard]);

  // Search across huts/accommodations and villages by name. Deliberately
  // unaffected by the pin filter below — search should always be able to find
  // a specific named place, even one that's currently filtered off the map.
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  /** Leave the search entirely: clear it, drop focus, put the keyboard away. */
  const exitSearch = useCallback(() => {
    setQuery('');
    // blur() as well as dismissing the keyboard — dismissing alone leaves the
    // field focused, so the caret stays and the next tap re-opens the keyboard.
    searchInputRef.current?.blur();
    Keyboard.dismiss();
  }, []);
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    // Loaded regions first: those huts have been through the merge (deduped,
    // relabelled), so they're the better objects when we have them.
    const loaded = [...(huts ?? []), ...(villages ?? [])].filter((h) =>
      h.name.toLowerCase().includes(q),
    );
    const seen = new Set(loaded.map((h) => h.id));
    // ⚠️ Then the REST OF THE WORLD. Search must not be limited to the selected
    // regions — being told "Kandersteg" doesn't exist because it sits one region
    // over is simply wrong. Picking one of these adds its region (see
    // `onPickSearch`). Parses every region file, but only once you search.
    const elsewhere = searchBundledPlaces(q, 40)
      .filter((e) => !seen.has(e.hut.id))
      .map((e) => e.hut);
    return [...loaded, ...elsewhere].slice(0, 25);
  }, [query, huts, villages]);

  // Which pins show on the map: accommodation type + facility filters (region
  // is no longer a filter — the loaded huts are already scoped to the chosen
  // regions). Types start "all on"; facilities start empty. A hut must match one
  // of the checked types AND have every checked facility (all-of, not any-of).
  const [filterOpen, setFilterOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<Set<HutType>>(
    () => new Set(ACCOM_TYPES),
  );
  // Villages are a separate layer from the Type filter on purpose — they're not
  // an accommodation category (see ACCOM_TYPES), they're places you route
  // THROUGH. On by default; they only draw once zoomed in past VILLAGE_MIN_ZOOM.
  const [showVillages, setShowVillages] = useState(true);
  const toggleTypeFilter = useCallback((t: HutType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);
  const resetFilters = useCallback(() => {
    setTypeFilter(new Set(ACCOM_TYPES));
  }, []);
  /** Drop one type from the active-filter row. Unlike `toggleTypeFilter` this
   *  can only ever REMOVE — and removing the last remaining type would leave a
   *  blank map, which is not a filter anyone means to apply, so it falls back to
   *  showing everything. */
  const dropTypeFilter = useCallback((t: HutType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      next.delete(t);
      return next.size === 0 ? new Set(ACCOM_TYPES) : next;
    });
  }, []);
  const filtersActive = typeFilter.size < ACCOM_TYPES.length;
  const activeFilterCount = ACCOM_TYPES.length - typeFilter.size;

  const passesFilter = useCallback(
    (hut: Hut) => typeFilter.has(hut.type),
    [typeFilter],
  );

  /**
   * What's currently narrowing the map, as dismissible chips under the search
   * bar — so the filters are visible without opening the panel.
   *
   * Type chips list what IS shown rather than what's hidden, and appear only
   * once the set is actually narrowed (all four on = no filter = no chips).
   * Facilities are pure restrictions, so every checked one gets a chip.
   */
  const filterChips = useMemo(() => {
    const out: {
      key: string;
      label: string;
      icon: React.ComponentProps<typeof Ionicons>['name'];
      category: ChipCategory;
      /** Renders a ✕ that clears just this filter. */
      onRemove?: () => void;
      /** Makes the whole chip tappable (chevron instead of ✕). */
      onPress?: () => void;
    }[] = [];

    for (const r of selectedRegions) {
      out.push({
        key: `region-${r.id}`,
        label: r.name,
        icon: 'map-outline',
        category: 'region',
        // Removing the ONLY region would leave the app with no area at all and
        // bounce you back to the first-run picker — so instead of a dead chip
        // with no ✕, that one opens the region picker when tapped.
        onRemove:
          selectedRegions.length > 1 ? () => removeRegion(r.id) : undefined,
        onPress:
          selectedRegions.length > 1
            ? undefined
            : () => setRegionPickerOpen(true),
      });
    }

    // ⚠️ ALWAYS listed, even when nothing is filtered — all four types are on by
    // default, so "all four chips" IS the honest answer to "which types am I
    // seeing". Showing them only once narrowed meant the row said nothing about
    // types in the state people are in most of the time.
    //
    // Same rule as regions: the LAST remaining type has no ✕, because a map
    // showing no accommodation at all isn't a filter anyone means to apply.
    for (const t of ACCOM_TYPES) {
      if (!typeFilter.has(t)) continue;
      out.push({
        key: `type-${t}`,
        label: hutTypeShortLabel(t),
        icon: hutPinIcon(t),
        category: 'type',
        onRemove: typeFilter.size > 1 ? () => dropTypeFilter(t) : undefined,
      });
    }

    return out;
  }, [selectedRegions, typeFilter, removeRegion, dropTypeFilter]);

  /** True when something other than the region selection is narrowing the map —
   *  i.e. there is something a "Clear all" chip could usefully clear. */
  const hasClearableFilters = typeFilter.size < ACCOM_TYPES.length;

  // The current camera's (padded) bounds — the box the cluster index is queried
  // for. Padded so a pin/bubble near the edge doesn't pop away before it's
  // actually offscreen.
  const viewportBounds = useMemo(() => cameraBoundsPadded(camera), [camera]);

  // id -> EVERY position it's visited at, so one pin can show all of them.
  //
  // A roundtrip starts and ends at the same hut, so that id legitimately appears
  // twice in `selected`. This was a `Map<string, number>`, which meant the second
  // visit overwrote the first and the start pin showed only the final number
  // (day 1 vanished). An array keeps both, and the marker renders them together
  // ("1·5") — one pin at one coordinate, rather than two stacked pins where only
  // the top one is visible.
  const orderById = useMemo(() => {
    const m = new Map<string, number[]>();
    selected.forEach((h, i) => {
      const at = m.get(h.id);
      if (at) at.push(i + 1);
      else m.set(h.id, [i + 1]);
    });
    return m;
  }, [selected]);

  // Real trail geometry (and stats) for each consecutive pair of huts.
  const legs = useRouteLegs();
  // Any route leg still routing along the trail network (BRouter) — surfaced in
  // the status badge as "Loading routes…", distinct from the hut data loading.
  const legsLoading = legs.some((l) => l.isLoading);

  // Frame the whole route once the (rebuilt) map reports itself ready, but only
  // when the route's stops are within the selected regions — otherwise (a route
  // saved in a region you're not currently in) leave the camera on the selected
  // regions' overview rather than yanking to it. `onMapReady` fires only for a
  // fresh map, so switching tabs with an unchanged route leaves your pan alone.
  const mapRef = useRef<MapView>(null);

  /**
   * Point the camera at the whole route.
   *
   * Frames EVERY stop, not only those inside the selected regions: if you're
   * looking at your route you want to see all of it, even the part that runs
   * into a neighbouring area. Route stops always draw (see `extraMarkers`), so
   * nothing is invisible out there — there just won't be other huts around.
   */
  const frameRoute = useCallback(
    (animated: boolean): boolean => {
      const coords = selected.map((h) => ({ latitude: h.lat, longitude: h.lon }));
      if (coords.length < 2) return false;
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 130, right: 60, bottom: 170, left: 60 },
        animated,
      });
      return true;
    },
    [selected],
  );

  /**
   * Put the camera on whatever `frameIntentRef` currently asks for.
   *
   * ⚠️ Both reasons the map remounts — focusing the tab, and changing regions —
   * end up here, and `onMapReady` alone cannot tell them apart. The intent flag
   * is what does; framing the route unconditionally here is what made a region
   * change snap straight back to the route.
   */
  const applyFrame = useCallback(
    (animated: boolean) => {
      if (frameIntentRef.current === 'route' && frameRoute(animated)) return;
      // No route (or the region is what was asked for): frame the selection.
      const target = bboxToMapRegion(unionBBox(selectedRegions));
      mapRef.current?.animateToRegion(target, animated ? 400 : 1);
    },
    [frameRoute, selectedRegions],
  );
  applyFrameRef.current = applyFrame;

  const handleMapReady = useCallback(() => {
    applyFrameRef.current(false);
  }, []);

  /** Put the camera on the walker. Zoomed in tight enough to see which side of a
   *  junction you're on — that's the question this answers. */
  const centreOnMe = useCallback(async () => {
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      mapRef.current?.animateToRegion(
        {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        450,
      );
    } catch {
      // No fix (indoors, airplane mode). The dot is absent for the same reason,
      // so the state is already visible — an alert would only nag.
    }
  }, []);

  // Swipe-to-compare: when the Plan tab couldn't fully match the criteria, it
  // remembers the (≤3) alternatives it offered so they can be browsed here too
  // — swiping updates the trip (trail + pins on this map, and the Route tab's
  // day list, since both read the same tripStore) and re-frames the camera on
  // each swipe. previewTrip (not setTrip) so trying one on doesn't end the
  // comparison — only "Use this route" or editing the route does that.
  const altOptions = useAlternativesStore((s) => s.options);
  const altActiveIndex = useAlternativesStore((s) => s.activeIndex);
  const altScenic = useAlternativesStore((s) => s.scenic);
  const previewTrip = useTripStore((s) => s.previewTrip);
  const [altPanelWidth, setAltPanelWidth] = useState(0);
  const altScrollRef = useRef<ScrollView>(null);
  const lastAltScrollIndex = useRef(altActiveIndex);

  // Keep the strip's scroll position in sync if the active alternative changed
  // some other way (e.g. paged from the Plan tab's own carousel).
  useEffect(() => {
    if (altPanelWidth > 0 && altActiveIndex !== lastAltScrollIndex.current) {
      lastAltScrollIndex.current = altActiveIndex;
      altScrollRef.current?.scrollTo({
        x: altActiveIndex * altPanelWidth,
        animated: false,
      });
    }
  }, [altActiveIndex, altPanelWidth]);

  const previewAlternative = useCallback(
    (index: number) => {
      const opt = altOptions[index];
      if (!opt) return;
      lastAltScrollIndex.current = index;
      useAlternativesStore.getState().setActiveIndex(index);
      previewTrip(opt.outcome.huts, altScenic, opt.outcome.legRides);
      const coords = opt.outcome.huts.map((h) => ({
        latitude: h.lat,
        longitude: h.lon,
      }));
      if (coords.length >= 2) {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 90, right: 60, bottom: 200, left: 60 },
          animated: true,
        });
      }
    },
    [altOptions, altScenic, previewTrip],
  );

  const useAltRoute = useCallback(
    (index: number) => {
      const opt = altOptions[index];
      if (!opt) return;
      // Finalise: setTrip (not previewTrip) ends the comparison, since the
      // user has now decided.
      setTrip(opt.outcome.huts, altScenic, opt.outcome.legRides);
    },
    [altOptions, altScenic],
  );

  // Picking a search result: clear the search, fly to the place, halo it so it's
  // distinguishable from close neighbours, and open its card.
  const onPickSearch = useCallback(
    (hut: Hut) => {
      setQuery('');
      Keyboard.dismiss();
      // If this place lives in a region you haven't selected, load that region
      // too — otherwise the map would fly to it and show a single pin floating
      // in an empty landscape, with no huts around it and no route options.
      const homeRegion = bundledRegionOf(hut.id);
      if (homeRegion && !selectedRegionIds.includes(homeRegion)) {
        const label = REGIONS.find((r) => r.id === homeRegion)?.name ?? homeRegion;
        addRegion(homeRegion);
        Alert.alert(
          `${label} added`,
          `“${hut.name}” is in ${label}, which wasn't among your selected areas — it's now been added so its huts and trails load too. You can remove it again from the region chips or the filter panel.`,
        );
      }
      setHighlighted(hut);
      setFoundPlace(hut);
      mapRef.current?.animateToRegion(
        {
          latitude: hut.lat,
          longitude: hut.lon,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        },
        400,
      );
      selectHut(hut);
    },
    [selectHut, selectedRegionIds, addRegion],
  );

  // Selected huts use a *different component* (NumberedMarker) than the plain
  // pin. Rendering a different element type at the same key makes React
  // remount cleanly on select/deselect, instead of mutating a native pin into
  // a custom view in place (which react-native-maps drops). A hut already in
  // the route stays visible regardless of the filter/viewport/thinning below —
  // only PLAIN (not-yet-selected) pins are ever hidden or thinned.
  const numberedMarkers = useMemo(
    () =>
      (huts ?? [])
        .map((hut: Hut) => {
          const orders = orderById.get(hut.id);
          if (orders == null) return null;
          return (
            <NumberedMarker
              key={hut.id}
              hut={hut}
              orders={orders}
              onSelect={selectHut}
            />
          );
        })
        .filter((m) => m !== null),
    [huts, orderById, selectHut],
  );

  // Every hut eligible for a plain pin: passes the Type/Facility filters and
  // isn't already a route stop. NOT viewport-cropped — the cluster index below
  // does the spatial query, and keeping this stable across pans means the index
  // is built once rather than on every camera move.
  const clusterCandidates = useMemo(
    () => (huts ?? []).filter((hut) => orderById.get(hut.id) == null && passesFilter(hut)),
    [huts, orderById, passesFilter],
  );

  // Cluster them for the current viewport/zoom. ~450 pins in the opening camera
  // is what made the map take ~a minute to draw; bubbling them collapses that to
  // tens of markers. Zoom in and bubbles split until every hut is its own pin.
  const zoom = useMemo(
    () => zoomForLongitudeDelta(camera.longitudeDelta),
    [camera.longitudeDelta],
  );
  // Bubbles disappear once the scale bar reads DECLUSTER_SCALE_M or less. Driven
  // by the bar rather than by `zoom` because the two don't line up the same way
  // on every screen width — see DECLUSTER_SCALE_M.
  const declusterAll = useMemo(() => {
    const bar = scaleBarDistanceM(camera, mapWidth);
    return bar != null && bar <= DECLUSTER_SCALE_M;
  }, [camera, mapWidth]);

  const { items: clusterItems, expansionZoomFor } = useHutClusters(
    clusterCandidates,
    viewportBounds,
    zoom,
    declusterAll,
  );

  // ── Villages as tappable route stops ──────────────────────────────────────
  // Villages aren't accommodation (they're deliberately absent from
  // ACCOM_TYPES), but they ARE useful stops — a valley you pass through, a
  // trailhead, a place to resupply. Tapping one opens the same card, so "Add to
  // route" works exactly as it does for a hut.
  //
  // Only shown from VILLAGE_MIN_ZOOM in: at Alpine latitudes that's roughly a
  // 5 km scale bar, i.e. once you're looking at a single day rather than a whole
  // region. Drawing all ~3 600 at overview zoom is what the original "villages
  // would clutter the map" note was about, and clustering them alongside huts
  // would dilute the hut bubbles. A separate layer keeps hut counts untouched.
  // Villages standing on top of a hut pin are dropped entirely. Measured in the
  // shipped bundle: 8–13 per region sit within 40 m of a guesthouse (village
  // "Stechelberg" is 24 m from "Hotel Restaurant Stechelberg"). Below
  // VILLAGE_MIN_ZOOM only the guesthouse pin draws; crossing that zoom used to
  // lay the village pin over it, and at 24 m apart that reads as one pin
  // changing its icon. See `villagesShadowedByHut` for why the hut wins.
  //
  // ⚠️ Computed from the FULL hut list, not what's on screen — a viewport- or
  // zoom-dependent rule would just move the flicker to pan instead of zoom.
  const shadowedVillageIds = useMemo(
    () => villagesShadowedByHut(villages ?? [], huts ?? []),
    [villages, huts],
  );

  const shownVillages = useMemo(() => {
    if (!showVillages || zoom < VILLAGE_MIN_ZOOM) return [];
    return (villages ?? []).filter(
      (v) =>
        orderById.get(v.id) == null && // already a numbered route stop
        !shadowedVillageIds.has(v.id) &&
        v.lat >= viewportBounds.south &&
        v.lat <= viewportBounds.north &&
        v.lon >= viewportBounds.west &&
        v.lon <= viewportBounds.east,
    );
  }, [
    showVillages,
    zoom,
    villages,
    orderById,
    viewportBounds,
    shadowedVillageIds,
  ]);

  // Ids drawn as their OWN pin (bubbled huts don't count) — `foundPin` uses this
  // to decide whether a searched place still needs a pin of its own. Villages
  // included, so searching one that's already on screen doesn't stack a second
  // pin on top of it.
  const shownPlainIds = useMemo(
    () =>
      new Set([
        ...clusterItems
          .filter((i) => i.kind === 'hut')
          .map((i) => (i as ClusterLeaf).hut.id),
        ...shownVillages.map((v) => v.id),
      ]),
    [clusterItems, shownVillages],
  );

  // Tapping a bubble zooms to the point where it breaks apart, rather than
  // opening anything — the standard cluster affordance.
  const onClusterPress = useCallback(
    (c: ClusterBubble) => {
      // null when the bubble's id predates an index rebuild (see
      // `expansionZoomFor`) — just step in a couple of levels instead. The
      // bubble the user tapped is gone by then anyway; what matters is that the
      // tap still zooms where they aimed rather than throwing.
      const targetZoom = expansionZoomFor(c.id) ?? Math.min(zoom + 2, 18);
      const lonDelta = 360 / 2 ** targetZoom;
      mapRef.current?.animateToRegion(
        {
          latitude: c.lat,
          longitude: c.lon,
          latitudeDelta: lonDelta * 0.8,
          longitudeDelta: lonDelta,
        },
        350,
      );
    },
    [expansionZoomFor, zoom],
  );

  // ── Marker pools ──────────────────────────────────────────────────────────
  // react-native-maps 1.20.1 on the New Architecture crashes natively when map
  // children are added AND removed in quick succession — AIRMap.m's
  // `insertReactSubview:atIndex:` takes a nil subview and aborts the process
  // (react-native-maps#5217, expo#34614). It's unfixed upstream, the fix is a
  // native patch, and Expo Go ships fixed native code so we can't apply one.
  //
  // So: never remove a marker. Render a FIXED set of slots with stable keys and
  // re-target them by props as the viewport changes; a slot with nothing to show
  // parks off-map at opacity 0 rather than unmounting. Slot COUNT only ever
  // grows, so the only native mutation left is an occasional append — which the
  // pre-clustering code did happily for hundreds of pins without ever crashing.
  //
  // Bubbles and pins get SEPARATE pools because a marker cannot be swapped
  // between a custom view and an `image` in place (react-native-maps drops it).
  const bubbles = useMemo(
    () => clusterItems.filter((i): i is ClusterBubble => i.kind === 'cluster'),
    [clusterItems],
  );
  const leaves = useMemo(
    () => clusterItems.filter((i): i is ClusterLeaf => i.kind === 'hut'),
    [clusterItems],
  );

  // Each hut/bubble keeps the slot it already holds, so a pin doesn't change
  // colour and icon under you while panning — `useSlotAssignment` explains why
  // filling slots in list order caused exactly that. `clusterItems` arrives
  // ranked nearest-to-viewport-centre, so newly-visible huts nearest to where
  // you're looking claim the free slots first.
  const bubbleAt = useSlotAssignment(bubbles, bubbleKey);

  // Split every pin — declustered huts AND the village layer — by type, so each
  // type gets its own pool and no slot ever changes its icon. See
  // `PIN_POOL_TYPES`. Villages are merged in here rather than kept as a separate
  // pool so that a village-typed hut arriving via the main layer still lands
  // somewhere instead of being silently dropped.
  const pinsByType = useMemo(() => {
    const m = new Map<HutType, Hut[]>();
    const add = (h: Hut) => {
      const bucket = m.get(h.type);
      if (bucket) bucket.push(h);
      else m.set(h.type, [h]);
    };
    for (const l of leaves) add(l.hut);
    for (const v of shownVillages) add(v);
    return m;
  }, [leaves, shownVillages]);

  const [bubbleSlots, setBubbleSlots] = useState(0);
  useEffect(() => {
    setBubbleSlots((n) => (bubbleAt.length > n ? bubbleAt.length : n));
  }, [bubbleAt.length]);
  const plainMarkers = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let i = 0; i < bubbleSlots; i++) {
      out.push(
        <ClusterMarker
          key={`bubble-slot-${i}`}
          cluster={bubbleAt[i]}
          onPress={onClusterPress}
        />,
      );
    }
    return out;
  }, [bubbleAt, bubbleSlots, onClusterPress]);

  const pinPools = useMemo(
    () =>
      PIN_POOL_TYPES.map((t) => (
        <HutPinPool
          key={`pool-${t}`}
          type={t}
          huts={pinsByType.get(t) ?? NO_HUTS}
          onSelect={selectHut}
          onRef={registerMarkerRef}
        />
      )),
    [pinsByType, selectHut, registerMarkerRef],
  );

  // Route stops that aren't in the fetched hut list (a generated route's start
  // or a one-way village endpoint) still need their numbered pin.
  const extraMarkers = useMemo(() => {
    const known = new Set((huts ?? []).map((h) => h.id));
    // ⚠️ Dedupe by id. A roundtrip's start appears twice in `selected`, and
    // rendering it twice produced React's "two children with the same key"
    // warning — plus a second marker stacked invisibly on the first. One pin per
    // place; `orderById` carries both day numbers.
    const seen = new Set<string>();
    const out: React.ReactNode[] = [];
    for (const h of selected) {
      if (known.has(h.id) || seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(
        <NumberedMarker
          key={h.id}
          hut={h}
          orders={orderById.get(h.id) ?? []}
          onSelect={selectHut}
        />,
      );
    }
    return out;
  }, [selected, huts, orderById, selectHut]);

  // A searched-for place with no pin of its own gets one here — either a
  // village (never in `huts` at all) or a hut the filter/viewport/thinning is
  // currently hiding (you searched for it on purpose, so it should still get a
  // pin even though it doesn't match the browse filter or isn't in the shown
  // selection). Deliberately independent of the halo: swapping this marker
  // between "haloed" and "plain" made react-native-maps tear down the
  // annotation and drop it, so the pin vanished on ✕. Mount it once and leave
  // it alone.
  const foundPin = useMemo(() => {
    if (!foundPlace) return null;
    if (orderById.has(foundPlace.id)) return null; // `extraMarkers` draws it
    if (shownPlainIds.has(foundPlace.id)) return null; // `plainMarkers` draws it
    return (
      <HutMarker
        key={`found-${foundPlace.id}`}
        hut={foundPlace}
        onSelect={selectHut}
      />
    );
  }, [foundPlace, orderById, shownPlainIds, selectHut]);

  // The halo is its own marker layered over whatever pin is already there, so
  // showing/hiding it never touches that pin.
  const haloMarker = useMemo(
    () =>
      highlighted ? (
        <HaloMarker
          key={`halo-${highlighted.id}`}
          hut={highlighted}
          onSelect={selectHut}
        />
      ) : null,
    [highlighted, selectHut],
  );

  const activeSelected =
    activeHut != null && orderById.has(activeHut.id);

  return (
    <View style={styles.container}>
      <MapView
        // Rebuilt when the route changed while this tab was backgrounded — see
        // the note above the `mapKey` state.
        key={mapKey}
        ref={mapRef}
        style={styles.map}
        initialRegion={bboxToMapRegion(unionBBox(selectedRegions))}
        showsUserLocation={showUserLocation}
        showsMyLocationButton={false}
        onMapReady={handleMapReady}
        onRegionChangeComplete={handleRegionChangeComplete}
        onPress={handleMapPress}
      >
        {legs.flatMap((leg) => {
          const key = `${leg.from.id}->${leg.to.id}`;
          const from = { latitude: leg.from.lat, longitude: leg.from.lon };
          const to = { latitude: leg.to.lat, longitude: leg.to.lon };

          // The 1–3 coloured sub-lines this leg draws. A leg that uses a lift/
          // train comes back as walk + ride + walk: hiking parts orange, the ride
          // a distinct violet dashed line so it reads as "not hiked".
          const segs = leg.data?.segments;
          let lines: {
            coords: LatLng[];
            color: string;
            width: number;
            dash?: number[];
          }[];
          if (segs) {
            lines = segs.map((s) => ({
              coords: s.coordinates,
              color: s.mode === 'walk' ? '#ef6c00' : '#7c3aed',
              // Same width as the walk line — no compensation for dashing.
              width: 5,
              dash: s.mode === 'walk' ? undefined : [10, 8],
            }));
          } else if (leg.data) {
            lines = [{ coords: leg.data.coordinates, color: '#ef6c00', width: 5 }];
          } else {
            lines = [
              {
                coords: [from, to],
                color: leg.isError ? '#c0392b' : '#9aa0a6',
                width: 3,
                dash: [8, 6],
              },
            ];
          }

          // Emit a FIXED 3 slots per leg with stable keys. A ride leg resolves
          // from one loading line into three segments; if the keys changed
          // (1 → 3) the polylines would REMOUNT, and react-native-maps blanks
          // remounted overlays — which is exactly why the cable-car/lift
          // segments weren't drawing. Stable keys make each line update in
          // place; unused slots are an invisible zero-width line.
          return [0, 1, 2].map((i) => {
            const line = lines[i];
            return (
              <Polyline
                key={`${key}#${i}`}
                coordinates={line ? line.coords : [from, to]}
                strokeColor={line ? line.color : 'transparent'}
                strokeWidth={line ? line.width : 0}
                lineDashPattern={line?.dash}
              />
            );
          });
        })}
        {numberedMarkers}
        {plainMarkers}
        {pinPools}
        {extraMarkers}
        {foundPin}
        {haloMarker}
      </MapView>

      {/* `box-none` so only the search bar / filter panel take touches and the
          rest of this full-height overlay passes taps through to the map. */}
      <View
        style={[styles.searchWrap, { top: insets.top + SEARCH_TOP_GAP }]}
        pointerEvents="box-none"
      >
        <View style={styles.searchBar}>
          <Ionicons name="search" size={17} color="#999" />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search huts, hotels, villages…"
            placeholderTextColor="#aaa"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="never"
          />
          {/* Shown whenever there's text OR the field has focus, so there's
              always a visible way OUT of the search — previously it appeared
              only once you'd typed, and clearing the text left the field still
              focused with the keyboard up. */}
          {(query.length > 0 || searchFocused) && (
            <TouchableOpacity
              onPress={exitSearch}
              hitSlop={14}
              style={styles.searchClear}
              accessibilityLabel="Close search"
            >
              <Ionicons name="close" size={17} color="#5c6b63" />
            </TouchableOpacity>
          )}

          <View style={styles.searchDivider} />

          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              setFilterOpen((v) => !v);
            }}
            hitSlop={10}
            accessibilityLabel="Filter huts"
            accessibilityState={{ expanded: filterOpen }}
          >
            <View>
              <Ionicons
                name="options-outline"
                size={20}
                color={filtersActive || filterOpen ? COLORS.green : '#999'}
              />
              {filtersActive && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>

        {filterOpen && (
          <View style={styles.filterPanel}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.filterHeader}>
                <Text style={styles.filterTitle}>Filter huts</Text>
                <View style={styles.filterHeaderActions}>
                  {filtersActive && (
                    <TouchableOpacity onPress={resetFilters} hitSlop={8}>
                      <Text style={styles.filterReset}>Reset</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => setFilterOpen(false)}
                    hitSlop={8}
                    accessibilityLabel="Minimize filter"
                  >
                    <Ionicons name="remove-circle-outline" size={20} color="#999" />
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.filterSectionLabel}>Regions</Text>
              <TouchableOpacity
                style={styles.manageRegionsBtn}
                onPress={() => {
                  setFilterOpen(false);
                  setRegionPickerOpen(true);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="map-outline" size={18} color={COLORS.green} />
                <Text style={styles.manageRegionsText} numberOfLines={1}>
                  {selectedRegions.length === 0
                    ? 'Choose regions'
                    : selectedRegions.length === 1
                      ? selectedRegions[0].name
                      : `${selectedRegions[0].name} +${selectedRegions.length - 1} more`}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#aaa" />
              </TouchableOpacity>

              <Text style={styles.filterSectionLabel}>Type</Text>
              <View style={styles.filterChipRow}>
                {ACCOM_TYPES.map((t) => {
                  const on = typeFilter.has(t);
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.filterChip, on && styles.filterChipOn]}
                      onPress={() => toggleTypeFilter(t)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={hutPinIcon(t)}
                        size={13}
                        color={on ? 'white' : hutPinColor(t)}
                      />
                      <Text style={[styles.filterChipText, on && styles.filterChipTextOn]}>
                        {hutTypeLabel(t)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Separate from Type: a village isn't a kind of accommodation,
                  it's somewhere you route through. */}
              <Text style={styles.filterSectionLabel}>Villages</Text>
              <TouchableOpacity
                style={[styles.filterChip, showVillages && styles.filterChipOn]}
                onPress={() => setShowVillages((v) => !v)}
                activeOpacity={0.7}
                accessibilityRole="switch"
                accessibilityState={{ checked: showVillages }}
              >
                <Ionicons
                  name={hutPinIcon('village')}
                  size={13}
                  color={showVillages ? 'white' : hutPinColor('village')}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    showVillages && styles.filterChipTextOn,
                  ]}
                >
                  {showVillages ? 'Shown when zoomed in' : 'Hidden'}
                </Text>
              </TouchableOpacity>

            </ScrollView>
          </View>
        )}

        {/* Hidden while the filter panel is open (it shows the same controls in
            full) and while searching (the results list belongs directly under
            the input). */}
        {!filterOpen && query.trim().length < 2 && filterChips.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.activeChipRow}
            contentContainerStyle={styles.activeChipRowContent}
          >
            {filterChips.map((c) => {
              const accent = CHIP_ACCENT[c.category];
              const body = (
                <>
                  <Ionicons name={c.icon} size={13} color={accent.fg} />
                  <Text
                    style={[styles.activeChipText, { color: accent.fg }]}
                    numberOfLines={1}
                  >
                    {c.label}
                  </Text>
                  {c.onRemove ? (
                    <TouchableOpacity
                      onPress={c.onRemove}
                      hitSlop={12}
                      accessibilityLabel={`Remove filter ${c.label}`}
                    >
                      <Ionicons name="close" size={15} color={accent.fg} />
                    </TouchableOpacity>
                  ) : c.onPress ? (
                    <Ionicons
                      name="chevron-forward"
                      size={13}
                      color={accent.fg}
                    />
                  ) : null}
                </>
              );
              const chipStyle = [
                styles.activeChip,
                { backgroundColor: accent.bg },
              ];
              return c.onPress ? (
                <TouchableOpacity
                  key={c.key}
                  style={chipStyle}
                  onPress={c.onPress}
                  activeOpacity={0.7}
                >
                  {body}
                </TouchableOpacity>
              ) : (
                <View key={c.key} style={chipStyle}>
                  {body}
                </View>
              );
            })}

            {/* A guaranteed one-tap escape from every type/facility filter, so
                clearing never requires reopening the panel. */}
            {hasClearableFilters && (
              <TouchableOpacity
                style={[styles.activeChip, styles.activeChipClear]}
                onPress={resetFilters}
                activeOpacity={0.7}
                accessibilityLabel="Clear all filters"
              >
                <Ionicons name="close-circle" size={13} color={COLORS.muted} />
                <Text style={[styles.activeChipText, styles.activeChipClearText]}>
                  Clear all
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {!filterOpen && query.trim().length >= 2 && (
          <View style={styles.searchResults}>
            {searchResults.length === 0 ? (
              <Text style={styles.searchEmpty}>No places match “{query.trim()}”</Text>
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.searchRow}
                    onPress={() => onPickSearch(item)}
                  >
                    <Ionicons
                      name="location"
                      size={15}
                      color={hutPinColor(item.type)}
                    />
                    <View style={styles.searchRowText}>
                      <Text style={styles.searchName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.searchMeta}>
                        {hutTypeLabel(item.type)}
                        {item.elevation != null
                          ? ` · ${Math.round(item.elevation)} m`
                          : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        )}
      </View>

      {/* ⚠️ Deliberately gated on `isLoading`, NOT `isFetching`. Every region
          is seeded instantly from the bundle (see [[bundle-dataset-milestone]])
          and is then immediately "stale" (the bundle is always older than an
          hour), so ALL active regions kick off a background live refresh on
          every cold start — `isFetching` stays true for potentially SEVERAL
          MINUTES while that grinds through the Overpass concurrency limiter,
          even though the map is already fully populated and usable from the
          bundle. Showing "Loading huts…" for that whole window made the app
          look stuck/incomplete when it wasn't — `isLoading` (true only while
          an active region genuinely has no data yet) is what's actually worth
          surfacing now; the background refresh is intentionally invisible. */}
      {(isLoading || legsLoading) && (
        <View style={styles.badge}>
          <ActivityIndicator size="small" color="#2f6f4f" />
          <Text style={styles.badgeText}>
            {isLoading ? 'Loading huts…' : 'Loading routes…'}
          </Text>
        </View>
      )}

      {/* Honest about the two-phase load: the picked region draws immediately,
          the neighbouring border strip arrives a beat later. Without this the
          map looks finished while huts are still to come. */}
      {isExpandingScope && (
        <View style={styles.loadingPill} pointerEvents="none">
          <ActivityIndicator size="small" color={COLORS.green} />
          <Text style={styles.loadingPillText}>Loading nearby areas…</Text>
        </View>
      )}

      {/* Re-frame the route after you've panned away. Changing region re-frames
          on the REGION (the map remounts on `regionKey`), so this is how you get
          back to the route without leaving and re-entering the tab. */}
      {!activeHut && altOptions.length <= 1 && (
        <View style={styles.mapControls} pointerEvents="box-none">
          {showUserLocation && (
            <TouchableOpacity
              style={styles.locateBtn}
              onPress={centreOnMe}
              activeOpacity={0.85}
              accessibilityLabel="Centre the map on my location"
            >
              <Ionicons name="locate" size={19} color={COLORS.green} />
            </TouchableOpacity>
          )}
          {selected.length >= 2 && (
            <TouchableOpacity
              style={styles.goToRouteBtn}
              onPress={() => frameRoute(true)}
              activeOpacity={0.85}
              accessibilityLabel="Zoom to your route"
            >
              <Ionicons name="trail-sign" size={15} color="white" />
              <Text style={styles.goToRouteText}>Go to route</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Scale bar (bottom-right). Hidden while a hut card or the alternatives
          strip is up, since those bottom overlays would cover it. */}
      {!activeHut && altOptions.length <= 1 && (
        <View style={styles.scaleBarWrap} pointerEvents="none">
          <ScaleBar camera={camera} mapWidth={mapWidth} />
        </View>
      )}

      {isError && (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Couldn’t load huts</Text>
          <Text style={styles.errorMsg}>
            {error instanceof Error ? error.message : 'Unknown error'}
          </Text>
          <TouchableOpacity activeOpacity={0.85} onPress={() => refetch()}>
            <LinearGradient
              colors={GRADIENT.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.retryBtn}
            >
              <Text style={styles.retryText}>Retry</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Swipe-to-compare: the (≤3) alternatives the Plan tab offered, so you
          can pick the best one by how it looks on the map, not just its stats.
          Swiping previews that route here (and in Route, same store) and
          re-frames the camera; hidden while a hut card is open so they don't
          overlap (both are bottom overlays). */}
      {altOptions.length > 1 && !activeHut && (
        <View style={styles.altWrap}>
          <View style={styles.altHeader}>
            <Text style={styles.altHeaderText} numberOfLines={1}>
              Comparing {altOptions.length} alternatives — swipe to compare
            </Text>
            <TouchableOpacity
              onPress={() => useAlternativesStore.getState().clear()}
              hitSlop={10}
              accessibilityLabel="Stop comparing alternatives"
            >
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          </View>

          <View onLayout={(e) => setAltPanelWidth(e.nativeEvent.layout.width)}>
            {altPanelWidth > 0 && (
              <ScrollView
                ref={altScrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) =>
                  previewAlternative(
                    Math.round(e.nativeEvent.contentOffset.x / altPanelWidth),
                  )
                }
              >
                {altOptions.map((opt, i) => {
                  const d = Math.max(1, opt.outcome.plannedDays);
                  return (
                    <View
                      key={opt.key}
                      style={[styles.altCard, { width: altPanelWidth }]}
                    >
                      <View
                        style={[
                          styles.altBadge,
                          opt.recommended && styles.altBadgeMain,
                        ]}
                      >
                        <Ionicons
                          name={opt.recommended ? 'star' : 'trail-sign-outline'}
                          size={13}
                          color="white"
                        />
                        <Text style={styles.altBadgeText}>{opt.label}</Text>
                      </View>
                      <Text style={styles.altStats}>
                        {opt.outcome.plannedDays}{' '}
                        {opt.outcome.plannedDays === 1 ? 'day' : 'days'} ·{' '}
                        {formatDistance(opt.outcome.totalDistance / d)}/day · ↑
                        {formatElevation(opt.outcome.totalAscent / d)}/day
                      </Text>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => useAltRoute(i)}
                      >
                        <LinearGradient
                          colors={GRADIENT.primary}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.altUseBtn}
                        >
                          <Ionicons name="checkmark" size={16} color="white" />
                          <Text style={styles.altUseText}>Use this route</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>

          <View style={styles.altDotsRow}>
            {altOptions.map((_, i) => (
              <View
                key={i}
                style={[styles.altDot, i === altActiveIndex && styles.altDotActive]}
              />
            ))}
          </View>
        </View>
      )}

      {activeHut && (
        <HutSelectionCard
          hut={activeHut}
          selected={activeSelected}
          // Offered only when it would actually mean something: the hut is
          // already a stop, there's a route to close, and it isn't the finish
          // already. Tapping your START again then closes the loop instead of
          // deleting it, which is what `toggle` alone would do.
          onCloseLoop={
            activeSelected &&
            selected.length >= 2 &&
            selected[selected.length - 1]?.id !== activeHut.id
              ? () => {
                  appendHut(activeHut);
                  setActiveHut(null);
                }
              : undefined
          }
          onToggle={() => addOrRemove(activeHut)}
          onClose={dismissCard}
          onDetails={() =>
            router.push({ pathname: '/hut/[id]', params: { id: activeHut.id } })
          }
        />
      )}

      {/* In-app "manage regions" — add/remove areas to load. */}
      <Modal
        visible={regionPickerOpen}
        animationType="slide"
        onRequestClose={() => setRegionPickerOpen(false)}
      >
        {/* ⚠️ Mount ONLY while open. A Modal renders its children even when
            `visible` is false, so RegionPicker previously mounted once and never
            again — and it seeds its local `pending` selection from the store in a
            useState initialiser, which therefore ran exactly once for the app's
            lifetime. Consequences: ticking a region and dismissing with ✕ left
            the tick in place on reopen, and removing a region from the Map tab's
            filter chips didn't clear it here either. Remounting per open makes
            `pending` start from the committed selection every time. */}
        {regionPickerOpen && (
          <RegionPicker onClose={() => setRegionPickerOpen(false)} />
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  // Bottom-right, just above the tab bar. Plain offset, NOT
  // `useBottomTabBarHeight()` — the bar isn't absolutely positioned, so the
  // screen already ends above it and adding its height double-counted, floating
  // this up to mid-screen.
  loadingPill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    ...coloredShadow(COLORS.green, 0.2),
  },
  loadingPillText: { fontSize: 12, fontWeight: '700', color: COLORS.ink },
  mapControls: {
    position: 'absolute',
    left: 14,
    bottom: 14,
    alignItems: 'flex-start',
    gap: 10,
  },
  locateBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    ...coloredShadow(COLORS.green, 0.22),
  },
  goToRouteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.green,
    ...coloredShadow(COLORS.green, 0.3),
  },
  goToRouteText: { color: 'white', fontWeight: '700', fontSize: 13 },
  scaleBarWrap: { position: 'absolute', right: 14, bottom: 14 },
  // Marker styles (cluster, numMarker, halo, scale bar) live with their
  // components in src/components/map/.
  // Spans the full height (top..bottom) rather than hugging the top, so the
  // filter panel below is bounded by real available space and can't run off the
  // bottom of the screen. It's `pointerEvents="box-none"`, so covering the map
  // costs nothing — only its children take touches.
  // `top` is applied inline from the safe-area inset — the Map tab has no
  // header, so without that the search bar would sit under the status bar /
  // notch. See SEARCH_TOP_GAP.
  searchWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...coloredShadow(COLORS.green, 0.16),
  },
  searchInput: { flex: 1, fontSize: 15, color: COLORS.ink, padding: 0 },
  // A filled grey circle, so the exit affordance reads as a button rather than
  // a faint glyph tucked beside the text.
  searchClear: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2ef',
  },
  searchDivider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: '#e2e8e4',
  },
  filterBadge: {
    position: 'absolute',
    top: -6,
    right: -7,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: COLORS.trail,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: 'white', fontSize: 10, fontWeight: '800' },
  filterPanel: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    marginTop: 8,
    // `flexShrink` instead of a fixed `maxHeight: 340`: the parent now spans to
    // the bottom of the screen, so the panel simply takes what's left after the
    // search bar and its inner ScrollView handles any overflow. The old magic
    // number didn't know how much room it actually had, so on shorter screens
    // (or with the keyboard up) the bottom of the panel ran off.
    flexShrink: 1,
    padding: 14,
    ...coloredShadow(COLORS.green, 0.16),
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  filterHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  filterTitle: { fontSize: 15, fontWeight: '800', color: COLORS.ink },
  filterReset: { fontSize: 13, color: COLORS.danger, fontWeight: '700' },
  filterSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 12,
    marginBottom: 8,
  },
  manageRegionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    backgroundColor: COLORS.surface,
    marginBottom: 4,
  },
  manageRegionsText: { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.ink },
  filterChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: COLORS.surface,
  },
  filterChipOn: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  filterChipText: { fontSize: 12, color: '#555', fontWeight: '600' },
  filterChipTextOn: { color: 'white' },
  // A SINGLE row that scrolls sideways like a carousel. `flexGrow/flexShrink: 0`
  // keeps it to its content height inside the column `searchWrap` lays out —
  // without them the ScrollView stretches and swallows the map below it.
  activeChipRow: { marginTop: 8, flexGrow: 0, flexShrink: 0 },
  // `paddingRight` leaves the last chip clear of the edge; chips beyond the
  // fold clip mid-shape, which is the cue that the row scrolls.
  activeChipRowContent: { gap: 8, paddingRight: 6, alignItems: 'center' },
  // Colour comes from CHIP_ACCENT per category — background here is only the
  // fallback for the "Clear all" chip, which belongs to no category.
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingLeft: 11,
    paddingRight: 9,
    paddingVertical: 7,
    maxWidth: 210,
    ...coloredShadow(COLORS.green, 0.12),
  },
  activeChipText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  activeChipClear: { backgroundColor: COLORS.surface },
  activeChipClearText: { color: COLORS.muted },
  searchResults: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    marginTop: 8,
    // 260 is a deliberate cap so the dropdown stays compact over the map;
    // `flexShrink` is the safety net that keeps it inside the available space on
    // a short screen or with the keyboard up.
    maxHeight: 260,
    flexShrink: 1,
    overflow: 'hidden',
    ...coloredShadow(COLORS.green, 0.16),
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2ef',
  },
  searchRowText: { flex: 1 },
  searchName: { fontSize: 15, color: COLORS.ink, fontWeight: '600' },
  searchMeta: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  searchEmpty: {
    fontSize: 14,
    color: COLORS.muted,
    padding: 14,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: 72,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    gap: 8,
    ...coloredShadow(COLORS.green, 0.16),
  },
  badgeText: { fontSize: 14, color: COLORS.ink, fontWeight: '600' },
  errorCard: {
    position: 'absolute',
    top: 118,
    left: 20,
    right: 20,
    backgroundColor: COLORS.surface,
    padding: 18,
    borderRadius: RADIUS.lg,
    ...coloredShadow(COLORS.ink, 0.2),
  },
  errorTitle: { fontWeight: '800', fontSize: 16, marginBottom: 4, color: COLORS.danger },
  errorMsg: { fontSize: 13, color: '#555', marginBottom: 14 },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
  },
  retryText: { color: 'white', fontWeight: '700' },
  altWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    // Just above the tab bar — see `scaleBarWrap` for why this is a plain offset.
    bottom: 12,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingTop: 12,
    paddingBottom: 10,
    ...coloredShadow(COLORS.green, 0.22),
  },
  altHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  altHeaderText: { flex: 1, fontSize: 12, color: COLORS.muted, fontWeight: '700' },
  altCard: { paddingHorizontal: 16, gap: 8 },
  altBadge: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#9aa5a0',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  altBadgeMain: { backgroundColor: COLORS.green },
  altBadgeText: { color: 'white', fontWeight: '800', fontSize: 12 },
  altStats: { fontSize: 13, color: '#444', fontWeight: '500' },
  altUseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    marginTop: 2,
    ...coloredShadow(COLORS.greenDeep, 0.25),
  },
  altUseText: { color: 'white', fontWeight: '800', fontSize: 14 },
  altDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  altDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#d5ded8',
  },
  altDotActive: { backgroundColor: COLORS.green, width: 16 },
});
