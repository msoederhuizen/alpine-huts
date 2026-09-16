/**
 * Every marker drawn on the Map tab: cluster bubbles, numbered route stops, hut
 * pins (and their pool), and the search-selection halo.
 *
 * Moved out of `app/(tabs)/index.tsx` verbatim — these are leaf components that
 * take props and render a `<Marker>`, so they were simply padding out a
 * 2250-line screen. The hard-won comments about marker pooling and
 * `tracksViewChanges` came with them; read those before changing anything here,
 * because most of this file is shaped by react-native-maps bugs rather than by
 * taste.
 */
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type ImageRequireSource } from 'react-native';
import { Marker } from 'react-native-maps';

import { COLORS } from '../../constants/theme';
import { useSlotAssignment, type ClusterBubble } from '../../hooks/useHutClusters';
import type { Hut, HutType } from '../../types/hut';
import { HUT_PIN_ANCHOR, hutPinColor, hutPinImage } from '../../utils/hutMeta';

/** Just the bit of the Marker instance we call — deselects the native pin. */
export type MarkerHandle = { hideCallout: () => void };

/** Where an unused marker-pool slot sits: null island, far from any Alpine
 *  viewport, at opacity 0. Slots stay mounted (see `ClusterMarker`) so parking
 *  them is how we "hide" one without an unmount. */
const PARKED_COORDINATE = { latitude: 0, longitude: 0 };

/** Slot identity for the hut pools. Module-level so it's referentially stable —
 *  an inline arrow would be a new function every render. */
const hutKey = (h: Hut) => h.id;

/**
 * True only until the view has painted once.
 *
 * `tracksViewChanges` makes react-native-maps re-snapshot a custom marker's view
 * into a bitmap on every change, which is ruinous when there are many markers
 * on screen. So: track just long enough to capture ONE painted frame, then turn
 * it off. Two `requestAnimationFrame`s (~2 frames, ~32 ms) guarantees the view
 * (icon glyph included — the vector-icon font is preloaded) has painted at least
 * once before we stop, vs. the old fixed 400–500 ms window that kept every
 * freshly-mounted pin churning long after it had settled. Re-arms whenever
 * `resetKey` changes (e.g. a route number changed and must be re-captured).
 */
function useTrackOncePainted(resetKey?: unknown): boolean {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setTracks(false));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [resetKey]);
  return tracks;
}

/**
 * A bubble standing in for several nearby huts, showing how many. Tapping it
 * zooms to where it breaks apart.
 *
 * This IS a custom-view marker (a count can't be a pre-baked image), which is
 * the expensive kind — but that's fine precisely because clustering means there
 * are only tens of them on screen instead of hundreds of pins. It still uses
 * `useTrackOncePainted` so each bubble is snapshotted once and then stops
 * churning. Scaled gently by count so a big group reads as bigger.
 */
export const ClusterMarker = memo(function ClusterMarker({
  cluster,
  onPress,
}: {
  /** Undefined = this pool slot is currently unused. */
  cluster?: ClusterBubble;
  onPress: (c: ClusterBubble) => void;
}) {
  const count = cluster?.count ?? 0;
  const tracks = useTrackOncePainted(count);
  const handlePress = useCallback(() => {
    if (cluster) onPress(cluster);
  }, [onPress, cluster]);
  const size = count >= 100 ? 52 : count >= 25 ? 46 : 40;

  // ⚠️ ALWAYS renders a <Marker>, never null — this is a POOL SLOT. Returning
  // null for an unused slot would unmount the native annotation, which is the
  // add/remove churn that crashes react-native-maps 1.20.1 under Fabric
  // (react-native-maps#5217). An unused slot is instead parked off-map at 0,0
  // with opacity 0 so it's invisible and untappable but stays mounted.
  return (
    <Marker
      coordinate={
        cluster
          ? { latitude: cluster.lat, longitude: cluster.lon }
          : PARKED_COORDINATE
      }
      opacity={cluster ? 1 : 0}
      onPress={handlePress}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracks}
    >
      <View
        style={[
          styles.cluster,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Text style={styles.clusterText}>{count}</Text>
      </View>
    </Marker>
  );
});

/**
 * A route stop shown as a numbered badge (its position in the Route tab).
 * Memoized so a parent re-render (e.g. every map pan) doesn't re-render it —
 * only a change to its own props (`hut`/`order`/`onSelect`) does.
 */
export const NumberedMarker = memo(function NumberedMarker({
  hut,
  orders,
  onSelect,
}: {
  hut: Hut;
  /** Every day this place is visited on. More than one for a roundtrip's
   *  start/finish, which is the same hut at both ends of the trip. */
  orders: number[];
  onSelect: (hut: Hut) => void;
}) {
  // "1·5" for a roundtrip's start/finish. Both numbers on ONE badge, because two
  // markers at identical coordinates just hide each other.
  const label = orders.join('·');
  const tracks = useTrackOncePainted(label);
  const onPress = useCallback(() => onSelect(hut), [onSelect, hut]);

  return (
    <Marker
      coordinate={{ latitude: hut.lat, longitude: hut.lon }}
      onPress={onPress}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={10}
      tracksViewChanges={tracks}
    >
      <View style={[styles.numMarker, orders.length > 1 && styles.numMarkerWide]}>
        <Text style={styles.numMarkerText}>{label}</Text>
      </View>
    </Marker>
  );
});

/**
 * A hut/accommodation pin: a small coloured badge with an icon for its category
 * (staffed hut, unstaffed hut, bivouac, hotel/guesthouse), plus a short tail so
 * it still reads as "pointing at" the exact coordinate — looks identical to the
 * old custom-view badge, but is now a pre-rasterized `image` (`hutPinImage`,
 * baked by `scripts/generate-pin-icons.cjs`).
 *
 * **This is THE fix for the "hundreds of pins is slow" perf issue.** A custom
 * `<Marker>` with View children isn't a real native annotation — MapKit/Google
 * Maps only understand images, so react-native-maps has to mount a native view
 * tree per pin AND repeatedly snapshot it into a bitmap (`tracksViewChanges`).
 * That per-pin view+snapshot machinery, not just re-rendering, is the
 * fundamental cost of hundreds of custom-view pins. An `image` marker skips all
 * of it — the map draws it exactly like its own native annotations, so there's
 * no `tracksViewChanges`/view-tree overhead left to optimize here at all.
 * Memoized for the same reason as before (no re-render on pan); `hut` stays
 * referentially stable from the cached hut list, `onSelect`/`onRef` are the
 * parent's `useCallback`s.
 */
export const HutMarker = memo(function HutMarker({
  hut,
  onSelect,
  onRef,
}: {
  hut: Hut;
  onSelect: (hut: Hut) => void;
  /** Only the main hut-list markers need this (for `hideCallout()` on deselect). */
  onRef?: (id: string, r: MarkerHandle | null) => void;
}) {
  const onPress = useCallback(() => onSelect(hut), [onSelect, hut]);
  const setRef = useCallback(
    (r: MarkerHandle | null) => onRef?.(hut.id, r),
    [onRef, hut.id],
  );

  return (
    <Marker
      ref={setRef}
      coordinate={{ latitude: hut.lat, longitude: hut.lon }}
      onPress={onPress}
      anchor={HUT_PIN_ANCHOR}
      image={hutPinImage(hut.type)}
    />
  );
});

/**
 * A pool-slot version of {@link HutMarker}: same pin, but it survives having no
 * hut to show. See `ClusterMarker` for why slots must never unmount — an empty
 * slot parks off-map instead of disappearing.
 *
 * Changing `image` on a live marker is fine (it's a plain prop); what
 * react-native-maps can't survive is swapping a marker between an image and a
 * custom view in place, which is why bubbles and pins have SEPARATE pools.
 */
const PooledHutMarker = memo(function PooledHutMarker({
  hut,
  image,
  onSelect,
  onRef,
}: {
  hut?: Hut;
  /** Fixed for this slot's whole life — see `PIN_POOL_TYPES`. Passing it in
   *  rather than deriving it from `hut` is the point: a slot that changed its
   *  own image mid-flight is what made pins appear to switch type. */
  image: ImageRequireSource;
  onSelect: (hut: Hut) => void;
  onRef?: (id: string, r: MarkerHandle | null) => void;
}) {
  const onPress = useCallback(() => {
    if (hut) onSelect(hut);
  }, [onSelect, hut]);
  // Keyed on the id so that when a slot re-targets, React invokes the PREVIOUS
  // callback with null first — which deregisters the old hut's ref — before
  // registering the new one. Without that the registry would leak dead handles.
  const id = hut?.id;
  const setRef = useCallback(
    (r: MarkerHandle | null) => {
      if (id) onRef?.(id, r);
    },
    [onRef, id],
  );

  return (
    <Marker
      ref={setRef}
      coordinate={
        hut ? { latitude: hut.lat, longitude: hut.lon } : PARKED_COORDINATE
      }
      opacity={hut ? 1 : 0}
      onPress={onPress}
      anchor={HUT_PIN_ANCHOR}
      image={image}
    />
  );
});

/**
 * One never-unmounting pool of pins, all sharing a single icon.
 *
 * Its own component so each type gets its own `useSlotAssignment` and slot
 * counter without calling hooks in a loop — the set of pools is the fixed
 * `PIN_POOL_TYPES` list, so the hook order is stable.
 */
export const HutPinPool = memo(function HutPinPool({
  type,
  huts,
  onSelect,
  onRef,
}: {
  type: HutType;
  huts: Hut[];
  onSelect: (hut: Hut) => void;
  onRef?: (id: string, r: MarkerHandle | null) => void;
}) {
  const at = useSlotAssignment(huts, hutKey);
  const [slots, setSlots] = useState(0);
  useEffect(() => {
    setSlots((n) => (at.length > n ? at.length : n));
  }, [at.length]);

  const image = hutPinImage(type);
  const out: ReactNode[] = [];
  for (let i = 0; i < slots; i++) {
    out.push(
      <PooledHutMarker
        key={`${type}-slot-${i}`}
        hut={at[i]}
        image={image}
        onSelect={onSelect}
        onRef={onRef}
      />,
    );
  }
  return <>{out}</>;
});

/**
 * A ring marking the place picked from search, so it's obvious which one it is
 * when neighbours are close. It's a separate marker layered over that place's
 * own pin — never a replacement — so hiding it can't disturb the pin underneath.
 *
 * It carries a dot in the place's type colour because the pin underneath isn't
 * visible while this is up: react-native-maps maps `zIndex` to MapKit's display
 * priority, and MapKit suppresses lower-priority annotations that overlap a
 * higher-priority one. So the dot stands in for the pin rather than trying (and
 * failing) to let it show through.
 */
export const HaloMarker = memo(function HaloMarker({
  hut,
  onSelect,
}: {
  hut: Hut;
  onSelect: (hut: Hut) => void;
}) {
  const tracks = useTrackOncePainted(hut.id);
  const onPress = useCallback(() => onSelect(hut), [onSelect, hut]);

  return (
    <Marker
      coordinate={{ latitude: hut.lat, longitude: hut.lon }}
      onPress={onPress}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={20}
      tracksViewChanges={tracks}
    >
      <View style={styles.halo}>
        <View
          style={[styles.haloDot, { backgroundColor: hutPinColor(hut.type) }]}
        />
      </View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  halo: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(239,108,0,0.15)',
    borderWidth: 3,
    borderColor: COLORS.trail,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stands in for the pin (which MapKit suppresses under the halo) — keeps the
  // place's type colour so you can still tell what it is.
  haloDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  // Route stops use the trail's orange (not a pin colour) so a selected hut is
  // instantly distinct from the green/blue/purple/brown/grey category pins —
  // and reads as "part of your (orange) route".
  numMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.trail,
    borderWidth: 2.5,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 2.5,
    elevation: 5,
  },
  // Widens into a pill when it carries two day numbers ("1·5") — a fixed 30px
  // circle would clip the second digit.
  numMarkerWide: {
    width: undefined,
    minWidth: 30,
    paddingHorizontal: 7,
  },
  numMarkerText: { color: 'white', fontWeight: '800', fontSize: 13 },
  // Hut-count bubble. Deliberately the hut green, not the route orange, so a
  // cluster never reads as a numbered route stop (which is what `numMarker` is).
  cluster: {
    backgroundColor: COLORS.green,
    borderWidth: 3,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  clusterText: { color: 'white', fontWeight: '800', fontSize: 14 },
});
