import { Ionicons } from '@expo/vector-icons';
import { SacInfoButton } from '../../src/components/SacInfoButton';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coloredShadow, COLORS, GRADIENT, RADIUS } from '../../src/constants/theme';
import { useLeg, useRouteLegs } from '../../src/hooks/useRouteLegs';
import { packLeg } from '../../src/utils/packLeg';
import { useSavedTripsStore } from '../../src/store/savedTripsStore';
import { useTripStore } from '../../src/store/tripStore';
import type { Hut } from '../../src/types/hut';
import {
  rideDisplayName,
  rideEmoji,
  RIDE_LABEL,
  type RideUse,
} from '../../src/types/ride';
import { formatDistance, formatDuration, formatElevation } from '../../src/utils/format';
import { hutTypeLabel } from '../../src/utils/hutMeta';
import {
  SAC_SCALE_COLOR,
  SAC_SCALE_DIFFICULTY,
  SAC_SCALE_GRADE,
} from '../../src/utils/sacScale';

export default function RouteScreen() {
  const huts = useTripStore((s) => s.huts);
  const scenic = useTripStore((s) => s.scenic);
  const rides = useTripStore((s) => s.rides);
  const reorder = useTripStore((s) => s.reorder);
  const remove = useTripStore((s) => s.remove);
  const clear = useTripStore((s) => s.clear);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const saveTrip = useSavedTripsStore((s) => s.save);
  const legs = useRouteLegs();

  const [saveOpen, setSaveOpen] = useState(false);
  const [tripName, setTripName] = useState('');

  const openSave = () => {
    const suggested =
      huts.length > 1
        ? `${huts[0].name} → ${huts[huts.length - 1].name}`
        : huts[0]?.name ?? '';
    setTripName(suggested);
    setSaveOpen(true);
  };

  /**
   * Clear wipes the whole itinerary and there is no undo, so it asks first.
   *
   * ⚠️ Worth the extra tap: a route can represent a lot of work, Clear now sits
   * as a filled red pill right beside Save, and the two are easy to confuse in a
   * hurry. Naming the count in the prompt is what makes it a real check rather
   * than a reflex — "Clear all 12 huts?" is answerable, "Are you sure?" isn't.
   *
   * A trip already SAVED is untouched by this; only the working route is lost.
   */
  const confirmClear = () => {
    Alert.alert(
      `Clear all ${huts.length} ${huts.length === 1 ? 'hut' : 'huts'}?`,
      'This empties the route you’re building. Saved trips aren’t affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clear },
      ],
    );
  };

  const confirmSave = () => {
    // Store the routed geometry with the trip so it reopens without network —
    // the trail on the map and every leg's stats come straight from here. Only
    // possible if all legs have actually resolved; if any is still routing or
    // errored we save the huts alone and the trip re-routes on open, as before.
    const routed = legs.every((l) => l.data)
      ? legs.map((l) => packLeg(l.data!))
      : undefined;
    saveTrip(tripName, huts, scenic, rides, routed);
    setSaveOpen(false);
    Alert.alert(
      'Trip saved',
      routed
        ? `“${tripName.trim() || 'Untitled trip'}” is in Saved trips, with its route stored for offline use.`
        : `“${tripName.trim() || 'Untitled trip'}” is now in Saved trips. Its route wasn't fully calculated yet, so it'll need a connection to redraw.`,
    );
  };

  const renderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<Hut>) => {
      const index = getIndex() ?? 0;
      const next = huts[index + 1];
      return (
        <View>
          <ScaleDecorator>
            <View style={[styles.row, isActive && styles.rowActive]}>
              <LinearGradient
                colors={GRADIENT.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.orderBadge}
              >
                <Text style={styles.orderText}>{index + 1}</Text>
              </LinearGradient>

              <TouchableOpacity
                style={styles.rowText}
                onPress={() =>
                  router.push({ pathname: '/hut/[id]', params: { id: item.id } })
                }
                activeOpacity={0.6}
              >
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {hutTypeLabel(item.type)}
                  {item.elevation != null
                    ? ` · ${Math.round(item.elevation)} m`
                    : ''}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => remove(item.id)}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityLabel={`Remove ${item.name}`}
              >
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              </TouchableOpacity>

              <TouchableOpacity
                // Grab the moment you touch the handle — no long-press wait.
                onPressIn={drag}
                delayPressIn={0}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.dragHandle}
                accessibilityLabel="Drag to reorder"
              >
                <Ionicons name="reorder-three" size={22} color={COLORS.greenBright} />
              </TouchableOpacity>
            </View>
          </ScaleDecorator>

          {!isActive && next && (
            <LegCard
              day={index + 1}
              from={item}
              to={next}
              ride={rides[index] ?? null}
              onOpen={() =>
                router.push({
                  pathname: '/leg/[index]',
                  params: { index: String(index) },
                })
              }
            />
          )}
        </View>
      );
    },
    [huts, rides, remove, router],
  );

  // ⚠️ Index-suffixed: a roundtrip legitimately contains the SAME hut twice (it
  // starts and finishes there), so a bare `item.id` produced duplicate keys —
  // React's "two children with the same key" warning, and a list where the two
  // rows could be confused for one another while dragging. This list is
  // positional anyway (drag reorders by position), so position belongs in the key.
  const keyExtractor = useCallback(
    (item: Hut, index: number) => `${item.id}#${index}`,
    [],
  );

  if (huts.length === 0) {
    return (
      <View style={styles.empty}>
        <LinearGradient
          colors={['#eaf4ee', '#dcece2']}
          style={styles.emptyIconWrap}
        >
          <Ionicons name="trail-sign-outline" size={44} color={COLORS.greenBright} />
        </LinearGradient>
        <Text style={styles.emptyTitle}>No huts yet</Text>
        <Text style={styles.emptySubtitle}>
          Open the Map tab, tap a hut pin, and choose “Add to route”. Then come
          back here to set the order you’ll walk them.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headerCount}>
            {huts.length} {huts.length === 1 ? 'hut' : 'huts'}
          </Text>
          <Text style={styles.headerHint}>Drag to reorder</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerPillGhost}
            onPress={confirmClear}
            hitSlop={8}
            activeOpacity={0.85}
          >
            <Text style={styles.headerPillGhostText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.85} onPress={openSave} hitSlop={8}>
            <LinearGradient
              colors={GRADIENT.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerPillSolid}
            >
              <Ionicons name="bookmark" size={14} color="white" />
              <Text style={styles.headerPillSolidText}>Save</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>

      {huts.length >= 2 && <RouteSummary />}

      <DraggableFlatList
        data={huts}
        onDragEnd={({ data }) => reorder(data)}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        // No activationDistance override: the library wraps the WHOLE list in a
        // single Pan gesture (not just the drag handle), so a low value here
        // made that gesture claim almost any vertical touch before the list's
        // own scroll could — normal scrolling had to fight it and felt
        // unresponsive. The handle stays instant via onPressIn below, which is
        // unrelated to this setting; leaving it at the library's default (0,
        // i.e. untouched) lets ordinary scroll gestures win as expected.
        // DraggableFlatList's own wrapper doesn't flex by default, so as a flex
        // child here it sized to its content and got clipped by the parent —
        // the last days of a long route were unreachable instead of scrollable.
        containerStyle={styles.list}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      />

      <Modal
        visible={saveOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Save trip</Text>
            <Text style={styles.modalSubtitle}>
              {huts.length} {huts.length === 1 ? 'hut' : 'huts'} in this route
            </Text>
            <TextInput
              value={tripName}
              onChangeText={setTripName}
              placeholder="Trip name"
              style={styles.input}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmSave}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalCancel, styles.cancelPill]}
                activeOpacity={0.85}
                onPress={() => setSaveOpen(false)}
              >
                <Text style={styles.cancelPillText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.85} onPress={confirmSave}>
                <LinearGradient
                  colors={GRADIENT.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.modalSave}
                >
                  <Text style={styles.modalSaveText}>Save</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SummaryStat({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statIconWrap}>
        <Ionicons name={icon} size={17} color={COLORS.green} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * One day's leg between two huts. Fetches its *own* leg query, so a leg
 * resolving only re-renders this card — not the whole draggable list (which was
 * the cause of the drag lag).
 */
function LegCard({
  day,
  from,
  to,
  ride,
  onOpen,
}: {
  day: number;
  from: Hut;
  to: Hut;
  ride?: RideUse | null;
  /** Open the day's detail screen (which trails to follow). */
  onOpen: () => void;
}) {
  const { data, isLoading, isError } = useLeg(from, to, ride);
  return (
    <TouchableOpacity
      style={[styles.leg, ride && styles.legWithRide]}
      onPress={onOpen}
      activeOpacity={0.75}
      accessibilityLabel={`Day ${day} details`}
    >
      <View style={styles.legLine} />
      <View style={styles.legBody}>
        <View style={styles.legDayRow}>
          <Text style={styles.legDay}>Day {day}</Text>
          {data?.sacScale && (
            <View style={styles.legDifficultyWrap}>
              <View
                style={[
                  styles.legDifficultyBadge,
                  { backgroundColor: SAC_SCALE_COLOR[data.sacScale] },
                ]}
              >
                <Ionicons name="analytics-outline" size={10} color="white" />
                <Text style={styles.legDifficultyText}>
                  {SAC_SCALE_GRADE[data.sacScale]} ·{' '}
                  {SAC_SCALE_DIFFICULTY[data.sacScale]}
                </Text>
              </View>
              <SacInfoButton highlight={data.sacScale} size={15} />
            </View>
          )}
          {/* ⚠️ Shown INDEPENDENTLY of the SAC badge, not folded into it. A via
              ferrata is a kit requirement, not a difficulty level, and BRouter
              has returned one inside a leg graded T3 — so a walker reading only
              "Challenging" would set off without a harness. It also renders when
              sacScale is absent, which is exactly when the badge above is not
              there to carry the warning. */}
          {data?.viaFerrata && (
            <View style={styles.ferrataBadge}>
              <Ionicons name="warning" size={11} color="#7a1f4b" />
              <Text style={styles.ferrataText}>
                Via ferrata ({data.viaFerrata}) · harness needed
              </Text>
            </View>
          )}
        </View>
        {isLoading && (
          <View style={styles.legLoading}>
            <ActivityIndicator size="small" color="#7a8a80" />
            <Text style={styles.legMuted}>Finding trail…</Text>
          </View>
        )}
        {isError && (
          <Text style={styles.legError} numberOfLines={1}>
            No trail route found for this leg
          </Text>
        )}
        {data && (
          <Text style={styles.legStats} numberOfLines={1}>
            {formatDistance(data.distance)} · ↑{formatElevation(data.ascent)}{' '}
            · ↓{formatElevation(data.descent)} · {formatDuration(data.duration)}
          </Text>
        )}
        {ride && (
          <View style={styles.legRideBlock}>
            <Text style={styles.legRide}>
              {rideEmoji(ride.mode)} {rideDisplayName(ride)} ·{' '}
              {RIDE_LABEL[ride.mode]}
            </Text>
            <Text style={styles.legRideNote}>
              Stats above are the walk only — the ride itself isn’t counted.
            </Text>
          </View>
        )}
      </View>
      {/* Affordance: without it the card looks like a static stats strip. Muted
          so it hints rather than competes with the day's own figures. */}
      <Ionicons
        name="chevron-forward"
        size={16}
        color="#b9c4be"
        style={styles.legChevron}
      />
    </TouchableOpacity>
  );
}

/**
 * Trip totals, isolated in its own component so its re-renders (as legs resolve)
 * don't touch the draggable list.
 */
function RouteSummary() {
  const legs = useRouteLegs();
  const scenic = useTripStore((s) => s.scenic);
  const setScenic = useTripStore((s) => s.setScenic);
  const totals = legs.reduce(
    (acc, leg) => {
      if (leg.data) {
        acc.distance += leg.data.distance;
        acc.ascent += leg.data.ascent;
        acc.descent += leg.data.descent;
        acc.duration += leg.data.duration;
      }
      return acc;
    },
    { distance: 0, ascent: 0, descent: 0, duration: 0 },
  );
  const anyLoading = legs.some((l) => l.isLoading);
  const anyError = legs.some((l) => l.isError);

  return (
    <View style={styles.summary}>
      <View style={styles.summaryRow}>
        <SummaryStat
          icon="walk-outline"
          value={formatDistance(totals.distance)}
          label="distance"
        />
        <SummaryStat
          icon="trending-up-outline"
          value={formatElevation(totals.ascent)}
          label="ascent"
        />
        <SummaryStat
          icon="trending-down-outline"
          value={formatElevation(totals.descent)}
          label="descent"
        />
        <SummaryStat
          icon="time-outline"
          value={formatDuration(totals.duration)}
          label="est. time"
        />
      </View>
      <Text style={styles.summaryNote}>
        {legs.length} {legs.length === 1 ? 'day' : 'days'} · one leg per day
        {anyLoading ? ' · routing…' : ''}
        {anyError ? ' · some legs couldn’t be routed' : ''}
      </Text>

      {legs.length > 0 && (
        <View style={styles.scenicRow}>
          <Ionicons name="leaf-outline" size={18} color={COLORS.green} />
          <View style={styles.scenicText}>
            <Text style={styles.scenicTitle}>Scenic route</Text>
            <Text style={styles.scenicHint}>
              Prefer mountain paths over the fastest way between huts
            </Text>
          </View>
          <Switch
            value={scenic}
            onValueChange={setScenic}
            trackColor={{ false: '#d5ded8', true: COLORS.greenBright }}
            thumbColor="#fff"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    backgroundColor: 'white',
    borderBottomLeftRadius: RADIUS.lg,
    borderBottomRightRadius: RADIUS.lg,
    // A light lift, not a block of colour — the day/leg cards below stay the
    // visual focus (user feedback: the dark gradient header was "in your
    // face" next to how subtle those are).
    ...coloredShadow(COLORS.green, 0.08),
  },
  headerText: { gap: 2 },
  headerCount: { fontSize: 19, fontWeight: '800', color: COLORS.ink },
  headerHint: { fontSize: 13, color: COLORS.muted, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  /**
   * Filled red pill, matching Plan's `cancelPill`.
   *
   * ⚠️ Sized to sit BESIDE Save, not to match Plan's dimensions. Plan's cancel is
   * a standalone action at the bottom of a sheet (24/12 padding, 15pt); this one
   * shares a header row with Save, so it takes Save's 14/9 and 13pt instead.
   * Copying the sheet's measurements verbatim would have made Clear noticeably
   * bigger than the primary action next to it.
   */
  headerPillGhost: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    // ⚠️ No `coloredShadow` here, unlike Plan's cancelPill. That one floats over
    // a dark scrim where a glow separates it from the background; this sits flat
    // in the header next to Save, where the same glow reads as a red smudge.
  },
  headerPillGhostText: { fontSize: 13, color: COLORS.surface, fontWeight: '800' },
  // Save keeps a small gradient accent — it's the one primary action here, and
  // a compact pill (unlike a full-width header fill) reads as an accent, not
  // a dominant block.
  headerPillSolid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
  },
  headerPillSolidText: { fontSize: 13, color: 'white', fontWeight: '800' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,25,20,0.5)',
    justifyContent: 'center',
    padding: 28,
  },
  modalSheet: {
    backgroundColor: 'white',
    borderRadius: RADIUS.xl,
    padding: 22,
    ...coloredShadow(COLORS.ink, 0.25),
  },
  modalTitle: { fontSize: 19, fontWeight: '800', color: COLORS.ink },
  modalSubtitle: { fontSize: 13, color: '#888', marginTop: 2, marginBottom: 16 },
  input: {
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    backgroundColor: '#f8faf8',
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.ink,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 12 },
  // Red pill cancel — solid `COLORS.danger` fill, white label, fully rounded.
  cancelPill: {
    backgroundColor: COLORS.danger,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    ...coloredShadow(COLORS.danger, 0.28),
  },
  cancelPillText: {
    color: COLORS.surface,
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  modalSave: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    ...coloredShadow(COLORS.greenDeep, 0.3),
  },
  modalSaveText: { fontSize: 15, color: 'white', fontWeight: '700' },
  summary: {
    backgroundColor: 'white',
    marginHorizontal: 14,
    marginTop: 14,
    marginBottom: 8,
    padding: 16,
    borderRadius: RADIUS.lg,
    ...coloredShadow(COLORS.green, 0.08),
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1, gap: 4 },
  statIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.greenTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { fontSize: 16, fontWeight: '800', color: COLORS.ink },
  statLabel: { fontSize: 11, color: COLORS.muted, fontWeight: '600' },
  summaryNote: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 10,
  },
  scenicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8e4',
  },
  scenicText: { flex: 1 },
  scenicTitle: { fontSize: 14, fontWeight: '700', color: COLORS.ink },
  scenicHint: { fontSize: 11.5, color: COLORS.muted, marginTop: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    marginHorizontal: 14,
    marginTop: 8,
    padding: 14,
    borderRadius: RADIUS.lg,
    gap: 12,
    ...coloredShadow(COLORS.green, 0.1),
  },
  rowActive: { shadowOpacity: 0.3, shadowRadius: 18, elevation: 10 },
  orderBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderText: { color: 'white', fontWeight: '800', fontSize: 15 },
  rowText: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '700', color: COLORS.ink },
  rowMeta: { fontSize: 12, color: '#777', marginTop: 2 },
  iconBtn: {
    padding: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(192,57,43,0.08)',
  },
  // Bigger touch target than the trash button so the drag handle is easy to grab.
  dragHandle: {
    paddingVertical: 7,
    paddingHorizontal: 7,
    marginLeft: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(74,157,112,0.1)',
  },
  leg: {
    flexDirection: 'row',
    marginHorizontal: 14,
    paddingLeft: 27,
    paddingVertical: 6,
    // Fixed height so a leg switching between loading/stats/error never changes
    // the row height — which would make the drag jump. `ride` doesn't change
    // over a leg's lifetime (it's baked in when the route is generated), so
    // giving ride legs a taller fixed height doesn't reintroduce that jump.
    height: 44,
  },
  // Tall enough for the full two-line ride sentence (name + note) to never
  // clip, even when the line/name text wraps on a narrow screen.
  legWithRide: { height: 104 },
  legLine: {
    width: 3,
    backgroundColor: COLORS.trailSoft,
    marginRight: 14,
    borderRadius: 2,
  },
  legBody: { flex: 1, justifyContent: 'center' },
  legChevron: { alignSelf: 'center', marginLeft: 4, marginRight: 2 },
  legDayRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legDay: { fontSize: 11, fontWeight: '700', color: COLORS.green },
  /** Deliberately NOT the SAC palette: this is a kit warning, not another
   *  difficulty grade, so it must not read as 'one step harder than orange'. */
  ferrataBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#f7e4ef',
    borderWidth: 1,
    borderColor: '#7a1f4b',
  },
  ferrataText: { fontSize: 11, fontWeight: '800', color: '#7a1f4b' },
  legDifficultyWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legDifficultyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  legDifficultyText: { fontSize: 10, fontWeight: '800', color: 'white' },
  legStats: { fontSize: 13, color: '#555', marginTop: 1 },
  legRideBlock: { marginTop: 4, gap: 2 },
  legRide: { fontSize: 12, color: '#6a4bb0', fontWeight: '700', lineHeight: 16 },
  legRideNote: { fontSize: 11, color: '#8b7ab0', lineHeight: 14 },
  legLoading: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  legMuted: { fontSize: 13, color: '#7a8a80' },
  legError: { fontSize: 13, color: '#b5651d', marginTop: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 8,
  },
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 19, fontWeight: '800', color: '#333', marginTop: 8 },
  emptySubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
});
