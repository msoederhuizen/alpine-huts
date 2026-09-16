import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { ElevationChart } from '../../src/components/ElevationChart';
import { positionAlongRoute } from '../../src/utils/elevationProfile';
import { SacInfoButton } from '../../src/components/SacInfoButton';
import { useCallback, useEffect, useRef, useState } from 'react';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { fetchLegGuide, type LegWaypoint } from '../../src/api/legGuide';
import { coloredShadow, COLORS, GRADIENT, RADIUS } from '../../src/constants/theme';
import { useRouteLegs } from '../../src/hooks/useRouteLegs';
import { useTripStore } from '../../src/store/tripStore';
import { rideDisplayName, rideEmoji } from '../../src/types/ride';
import { formatDistance, formatDuration, formatElevation } from '../../src/utils/format';
import {
  SAC_SCALE_COLOR,
  SAC_SCALE_DIFFICULTY,
  SAC_SCALE_GRADE,
} from '../../src/utils/sacScale';

/**
 * One day, in enough detail to walk it from this screen alone.
 *
 * Deliberately shaped as an ITINERARY, not a data dump: which signposted routes
 * to follow, then the named points you pass IN ORDER with distance, height and
 * running time to each. The first version listed route relations unordered — it
 * told you what existed, not how to walk it.
 */
export default function LegDetailScreen() {
  const { index } = useLocalSearchParams<{ index: string }>();
  const router = useRouter();
  const i = Number(index);
  const huts = useTripStore((s) => s.huts);
  const legs = useRouteLegs();

  const from = huts[i];
  const to = huts[i + 1];
  const leg = legs[i]?.data;

  const guide = useQuery({
    queryKey: ['legGuide', from?.id, to?.id],
    queryFn: ({ signal }) =>
      fetchLegGuide(
        leg!.coordinates,
        { startEle: from?.elevation, endEle: to?.elevation },
        signal,
      ),
    enabled: !!leg && leg.coordinates.length > 1,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  if (!from || !to) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Day' }} />
        <Text style={styles.muted}>This day is no longer part of your route.</Text>
        <BackButton onPress={() => router.back()} />
      </View>
    );
  }


  /** The modal presentation gives no back arrow on iOS (only a swipe-down), so
   *  provide one explicitly in the header. */
  const miniMap = useRef<MapView>(null);
  /**
   * True while a finger is on the mini map.
   *
   * ⚠️ A zoomable map inside a ScrollView fights it: a vertical drag is
   * ambiguous — pan the map, or scroll the page? Locking the page while the map
   * is being touched resolves it in the map's favour for the duration of the
   * gesture, and hands scrolling straight back on release.
   */
  const [mapActive, setMapActive] = useState(false);
  /**
   * Custom marker views must stop tracking once painted, or every one of them
   * re-renders on each frame and the map crawls. But switching tracking off
   * immediately can paint them blank on iOS (the view hasn't laid out yet), so
   * track briefly, then stop.
   */
  const [markersSettling, setMarkersSettling] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setMarkersSettling(false), 1200);
    return () => clearTimeout(t);
  }, []);
  /** Frame the whole day once the map is up. Padded generously so the trail
   *  isn't glued to the edges of a small view. */
  const fitMini = useCallback(
    (animated = false) => {
      const c = leg?.coordinates;
      if (!c || c.length < 2) return;
      miniMap.current?.fitToCoordinates(c, {
        edgePadding: { top: 34, right: 34, bottom: 34, left: 34 },
        animated,
      });
    },
    [leg],
  );

  const headerBack = useCallback(
    () => (
      <TouchableOpacity
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityLabel="Back to route"
        style={styles.headerBack}
      >
        <Ionicons name="chevron-back" size={24} color={COLORS.green} />
      </TouchableOpacity>
    ),
    [router],
  );

  /**
   * Where the walker is along THIS leg, for the height profile's blue dot.
   *
   * ⚠️ Asks only for a permission ALREADY GRANTED — never prompts. The Map tab
   * owns that conversation; a permission dialog appearing because you opened a
   * day's detail would be unexpected and easy to refuse for the wrong reason.
   *
   * One fix on open rather than a live subscription: this screen is read while
   * standing still deciding what's next, and a watcher would keep the GPS warm
   * for the whole time the screen is open.
   */
  const [alongM, setAlongM] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled || !leg?.coordinates?.length) return;
        const at = positionAlongRoute(leg.coordinates, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        setAlongM(at ? at.distanceM : null);
      } catch {
        // No fix, no dot. Never a blocking error — the chart is useful without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leg]);

  const stops: LegWaypoint[] = guide.data?.waypoints ?? [];

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{ title: `Day ${i + 1}`, headerLeft: headerBack }}
      />
      <ScrollView contentContainerStyle={styles.scroll} scrollEnabled={!mapActive}>
        <LinearGradient
          colors={GRADIENT.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <Text style={styles.headerDay}>Day {i + 1}</Text>
          <Text style={styles.headerRoute}>
            {from.name} → {to.name}
          </Text>
          {leg && (
            <View style={styles.headerStats}>
              <Stat label="Distance" value={formatDistance(leg.distance)} />
              <Stat label="Ascent" value={`+${formatElevation(leg.ascent)}`} />
              <Stat label="Descent" value={`−${formatElevation(leg.descent)}`} />
              <Stat label="Time" value={formatDuration(leg.duration)} />
            </View>
          )}
        </LinearGradient>

        {!leg && (
          <View style={styles.card}>
            <ActivityIndicator color={COLORS.green} />
            <Text style={styles.muted}>Working out this day…</Text>
          </View>
        )}

        {/* 1 — WHAT TO FOLLOW. At a junction the first question is "which sign?" */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Follow the signs for</Text>
          {guide.isLoading && <Loading label="Reading the waymarks…" />}
          {guide.isError && <Offline />}
          {guide.data && guide.data.routes.length === 0 && (
            <Text style={styles.muted}>
              No numbered route covers this day — follow the local footpath signs
              towards {to.name}.
            </Text>
          )}
          {guide.data?.routes.map((r) => (
            <View key={r.id} style={styles.routeRow}>
              <View
                style={[styles.routeBadge, { backgroundColor: networkColor(r.network) }]}
              >
                <Text style={styles.routeBadgeText}>{r.ref ?? '✓'}</Text>
              </View>
              <View style={styles.routeText}>
                <Text style={styles.routeName} numberOfLines={2}>
                  {r.name ?? `Route ${r.ref}`}
                </Text>
                <Text style={styles.muted}>{networkLabel(r.network)}</Text>
              </View>
            </View>
          ))}
          {!!guide.data?.routes.length && (
            <Text style={styles.footnote}>
              Numbers appear where a route has one. Many local trails are
              signposted by destination instead.
            </Text>
          )}
        </View>

        {/* 2 — THE WAY ITSELF, in order. This is what makes the screen walkable. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your way, in order</Text>
          {guide.isLoading && <Loading label="Finding the waypoints…" />}
          {guide.isError && <Offline />}
          {guide.data && stops.length === 0 && (
            <Text style={styles.muted}>
              No named landmarks are mapped along this day — keep the map and the
              trail line to hand.
            </Text>
          )}

          {stops.length > 0 && (
            <View style={styles.timeline}>
              <Row
                first
                name={from.name}
                sub="Start"
                right="0:00"
                elevation={from.elevation}
                kind="hut"
              />
              {stops.map((w) => (
                <Row
                  key={w.id}
                  name={w.name}
                  sub={`${(w.atMeters / 1000).toFixed(1)} km · ${kindLabel(w.kind)}`}
                  right={w.minutes != null ? formatMins(w.minutes) : undefined}
                  elevation={w.elevation}
                  kind={w.kind}
                />
              ))}
              <Row
                last
                name={to.name}
                sub={leg ? formatDistance(leg.distance) : 'Finish'}
                right={leg ? formatDuration(leg.duration) : undefined}
                elevation={to.elevation}
                kind="hut"
              />
            </View>
          )}
          {stops.length > 0 && (
            <Text style={styles.footnote}>
              Times are cumulative from the start and include the rest allowance.
              Distances follow the trail, not the crow.
            </Text>
          )}
        </View>

        {leg?.ride && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Transport on this day</Text>
            <Text style={styles.rideLine}>
              {rideEmoji(leg.ride.mode)} {rideDisplayName(leg.ride)}
            </Text>
            <Text style={styles.muted}>
              Walk to the lower station, ride up, then walk on. The distance and
              climb above exclude the ride.
            </Text>
          </View>
        )}

        {leg?.sacScale && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Hardest terrain</Text>
            <View style={styles.row}>
              <View
                style={[styles.sacBadge, { backgroundColor: SAC_SCALE_COLOR[leg.sacScale] }]}
              >
                <Text style={styles.sacBadgeText}>{SAC_SCALE_GRADE[leg.sacScale]}</Text>
              </View>
              <Text style={styles.sacText}>{SAC_SCALE_DIFFICULTY[leg.sacScale]}</Text>
              {/* This is the screen you walk from, so the grade matters most
                  here — the explanation opens on this leg's own grade. */}
              <SacInfoButton highlight={leg.sacScale} size={19} />
            </View>
          </View>
        )}

        {/* ⚠️ Its OWN card, not a line inside "Hardest terrain" — that card only
            renders when a SAC grade exists, and a via ferrata can appear on a
            leg with no grade at all, which is precisely when the warning matters
            most. It is also a KIT requirement rather than a difficulty, so it
            should not be read as one notch up the same scale. */}
        {leg?.viaFerrata && (
          <View style={[styles.card, styles.ferrataCard]}>
            <View style={styles.row}>
              <Ionicons name="warning" size={20} color="#7a1f4b" />
              <Text style={styles.ferrataTitle}>
                Via ferrata on this day (grade {leg.viaFerrata})
              </Text>
            </View>
            <Text style={styles.ferrataBody}>
              Part of this leg is a secured climbing route. You need a harness, a
              via-ferrata lanyard with an energy absorber, and a helmet — a head
              for heights alone isn’t enough. If you don’t have the kit, look for
              a bypass before you set off.
            </Text>
          </View>
        )}

        {/* Height profile — put ABOVE the map: the first question about a day
            is how much climbing it is, and that is answered here, not by the
            plan view. */}
        {leg && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Height profile</Text>
            <ElevationChart profile={leg.profile} atDistanceM={alongM} />
          </View>
        )}

        {leg && leg.coordinates.length > 1 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>This day on the map</Text>
            <View
              style={styles.mapWrap}
              onTouchStart={() => setMapActive(true)}
              onTouchEnd={() => setMapActive(false)}
              onTouchCancel={() => setMapActive(false)}
            >
              <MapView
                ref={miniMap}
                style={styles.miniMap}
                // Pan and zoom so you can look up the villages, lifts and peaks
                // around the line. Rotate and pitch stay off — they only make a
                // small map disorienting, and there's no compass to recover with.
                scrollEnabled
                zoomEnabled
                rotateEnabled={false}
                pitchEnabled={false}
                onMapReady={() => fitMini(false)}
              >
                <Polyline
                  coordinates={leg.coordinates}
                  strokeColor={COLORS.trail}
                  strokeWidth={4}
                />
                {/* The same stops as the list above, so the two read together:
                    you can see WHERE the 3.3 km pass actually is. */}
                {stops.map((w) => (
                  <Marker
                    key={w.id}
                    coordinate={{ latitude: w.lat, longitude: w.lon }}
                    title={w.name}
                    description={`${(w.atMeters / 1000).toFixed(1)} km${
                      w.elevation != null ? ` · ${Math.round(w.elevation)} m` : ''
                    }`}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={markersSettling}
                    zIndex={1}
                  >
                    <View style={[styles.wpDot, { backgroundColor: dotColor(w.kind) }]}>
                      <Ionicons name={kindIcon(w.kind)} size={9} color="white" />
                    </View>
                  </Marker>
                ))}
                {/* Labelled rather than plain pins: two identical teardrops
                    don't say which end you start from, and on an out-and-back or
                    a doubled-back day that's the one thing you need at a glance.
                    zIndex maps to MapKit's display priority — when annotations
                    overlap it HIDES the lower one, so the endpoints must outrank
                    the waypoint dots. */}
                <Marker
                  coordinate={leg.coordinates[0]}
                  title={from.name}
                  description="Start of the day"
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={markersSettling}
                  zIndex={10}
                >
                  <EndMarker label="Start" icon="play" color={COLORS.greenDeep} />
                </Marker>
                <Marker
                  coordinate={leg.coordinates[leg.coordinates.length - 1]}
                  title={to.name}
                  description="End of the day"
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={markersSettling}
                  zIndex={10}
                >
                  <EndMarker label="Finish" icon="flag" color={COLORS.trail} />
                </Marker>
              </MapView>
              {/* Easy to zoom in and lose the day; this puts it back. */}
              <TouchableOpacity
                style={styles.mapReset}
                onPress={() => fitMini(true)}
                activeOpacity={0.85}
                accessibilityLabel="Fit the whole day"
              >
                <Ionicons name="scan" size={16} color={COLORS.green} />
              </TouchableOpacity>
            </View>
            <Text style={styles.footnote}>
              Pinch to zoom and drag to look around — the page stays put while
              you do.
            </Text>
          </View>
        )}

        <BackButton onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}

function Row({
  name,
  sub,
  right,
  elevation,
  kind,
  first,
  last,
}: {
  name: string;
  sub: string;
  right?: string;
  elevation?: number;
  kind: LegWaypoint['kind'];
  first?: boolean;
  last?: boolean;
}) {
  return (
    <View style={styles.stopRow}>
      <View style={styles.stopRail}>
        <View style={[styles.railLine, first && styles.railLineHidden]} />
        <View
          style={[
            styles.stopDot,
            (first || last) && styles.stopDotEnd,
            kind === 'pass' && styles.stopDotPass,
          ]}
        >
          <Ionicons name={kindIcon(kind)} size={11} color="white" />
        </View>
        <View style={[styles.railLine, last && styles.railLineHidden]} />
      </View>
      <View style={styles.stopBody}>
        <Text style={styles.stopName} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.stopSub}>
          {sub}
          {elevation != null ? ` · ${Math.round(elevation)} m` : ''}
        </Text>
      </View>
      {right && <Text style={styles.stopTime}>{right}</Text>}
    </View>
  );
}

/** A start/finish marker that says which it is, without needing a tap. */
const EndMarker = ({
  label,
  icon,
  color,
}: {
  label: string;
  icon: 'play' | 'flag';
  color: string;
}) => (
  <View style={styles.endMarker}>
    <View style={[styles.endDot, { backgroundColor: color }]}>
      <Ionicons name={icon} size={12} color="white" />
    </View>
    <View style={[styles.endLabel, { backgroundColor: color }]}>
      <Text style={styles.endLabelText}>{label}</Text>
    </View>
  </View>
);

const BackButton = ({ onPress }: { onPress: () => void }) => (
  <TouchableOpacity style={styles.backBtn} onPress={onPress} activeOpacity={0.85}>
    <Ionicons name="arrow-back" size={16} color="white" />
    <Text style={styles.backText}>Back to route</Text>
  </TouchableOpacity>
);

const Loading = ({ label }: { label: string }) => (
  <View style={styles.row}>
    <ActivityIndicator color={COLORS.green} />
    <Text style={styles.muted}>{label}</Text>
  </View>
);

const Offline = () => (
  <Text style={styles.muted}>
    Couldn’t load the trail details — this part needs a connection. Your route
    and its figures above are unaffected.
  </Text>
);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const formatMins = (m: number) =>
  `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

function kindIcon(k: LegWaypoint['kind']) {
  switch (k) {
    case 'pass':
      return 'triangle' as const;
    case 'hut':
      return 'home' as const;
    case 'viewpoint':
      return 'eye' as const;
    case 'place':
      return 'business' as const;
    default:
      return 'ellipse' as const;
  }
}
function dotColor(k: LegWaypoint['kind']): string {
  switch (k) {
    case 'pass':
      return COLORS.trail;
    case 'hut':
      return COLORS.greenDeep;
    default:
      return COLORS.greenBright;
  }
}
function kindLabel(k: LegWaypoint['kind']): string {
  switch (k) {
    case 'pass':
      return 'pass';
    case 'hut':
      return 'hut';
    case 'viewpoint':
      return 'viewpoint';
    case 'place':
      return 'hamlet';
    default:
      return 'signpost';
  }
}
function networkLabel(n?: string): string {
  switch (n) {
    case 'iwn':
      return 'International route';
    case 'nwn':
      return 'National route';
    case 'rwn':
      return 'Regional route';
    case 'lwn':
      return 'Local route';
    default:
      return 'Waymarked route';
  }
}
function networkColor(n?: string): string {
  switch (n) {
    case 'iwn':
    case 'nwn':
      return COLORS.greenDeep;
    case 'rwn':
      return COLORS.green;
    default:
      return COLORS.greenBright;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  scroll: { padding: 14, paddingBottom: 30, gap: 12 },
  header: { borderRadius: RADIUS.lg, padding: 18, gap: 4 },
  headerDay: { color: '#cfe8da', fontSize: 12, fontWeight: '700' },
  headerRoute: { color: 'white', fontSize: 18, fontWeight: '800' },
  headerStats: { flexDirection: 'row', marginTop: 12, gap: 18 },
  stat: { gap: 2 },
  statValue: { color: 'white', fontSize: 15, fontWeight: '800' },
  statLabel: { color: '#cfe8da', fontSize: 11, fontWeight: '600' },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    gap: 10,
    ...coloredShadow(COLORS.green, 0.1),
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: COLORS.ink },
  muted: { fontSize: 13, color: COLORS.muted, flexShrink: 1 },
  footnote: { fontSize: 11, color: COLORS.muted, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeBadge: {
    minWidth: 36,
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeBadgeText: { color: 'white', fontWeight: '800', fontSize: 14 },
  routeText: { flex: 1, gap: 1 },
  routeName: { fontSize: 14, fontWeight: '700', color: COLORS.ink },

  timeline: { marginTop: 2 },
  stopRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  stopRail: { width: 22, alignItems: 'center' },
  railLine: { flex: 1, width: 2, backgroundColor: '#dce6df' },
  railLineHidden: { backgroundColor: 'transparent' },
  stopDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.greenBright,
  },
  stopDotEnd: { backgroundColor: COLORS.greenDeep },
  stopDotPass: { backgroundColor: COLORS.trail },
  stopBody: { flex: 1, paddingVertical: 8, gap: 1 },
  stopName: { fontSize: 14, fontWeight: '700', color: COLORS.ink },
  stopSub: { fontSize: 12, color: COLORS.muted },
  stopTime: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.green,
    paddingVertical: 8,
  },

  headerBack: { paddingHorizontal: 4, paddingVertical: 2 },
  mapWrap: {
    height: 210,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  miniMap: { flex: 1 },
  endMarker: { alignItems: 'center' },
  endDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: 'white',
  },
  endLabel: {
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'white',
  },
  endLabelText: { color: 'white', fontSize: 9, fontWeight: '800' },
  wpDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  mapReset: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    ...coloredShadow(COLORS.green, 0.25),
  },
  rideLine: { fontSize: 14, fontWeight: '700', color: COLORS.ink },
  ferrataCard: { borderWidth: 1.5, borderColor: '#7a1f4b', backgroundColor: '#fdf4f8' },
  ferrataTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#7a1f4b' },
  ferrataBody: { fontSize: 13.5, color: COLORS.ink, lineHeight: 20, marginTop: 8 },
  sacBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  sacBadgeText: { color: 'white', fontWeight: '800', fontSize: 13 },
  sacText: { fontSize: 13, color: COLORS.ink, flexShrink: 1 },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.green,
    borderRadius: 999,
    paddingVertical: 13,
    marginTop: 4,
    ...coloredShadow(COLORS.green, 0.3),
  },
  backText: { color: 'white', fontWeight: '700', fontSize: 15 },
});
