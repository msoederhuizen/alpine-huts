import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';

import {
  bboxToMapRegion,
  REGIONS,
  type Region,
} from '../constants/region';
import { coloredShadow, COLORS, GRADIENT, RADIUS } from '../constants/theme';
import { bundledRegionHutCount } from '../data/hutBundle';
import { useSelectedRegionsStore } from '../store/selectedRegionsStore';

/** Derived from REGIONS, not hardcoded — adding a country to `region.ts` should
 *  make it appear here with no further work. Declaration order is preserved so
 *  the list stays geographically sensible rather than alphabetical. */
const COUNTRIES: string[] = [...new Set(REGIONS.map((r) => r.country))];

/** A bit of breathing room around the focused region on the locator map, so you
 *  see it in the context of its surroundings rather than edge-to-edge. */
function locatorRegion(r: Region) {
  const base = bboxToMapRegion(r.bbox);
  return {
    ...base,
    latitudeDelta: base.latitudeDelta * 1.9,
    longitudeDelta: base.longitudeDelta * 1.9,
  };
}

/**
 * "Where do you want to walk?" region picker. Used both as the first-run gate
 * (`firstRun`, no close button — you must pick at least one to continue) and as
 * an in-app modal to add/remove regions later (`onClose` provided).
 *
 * Selection is edited LOCALLY (`pending`) and only committed to the persisted
 * store on "Start"/"Done", so first-run doesn't dismiss itself the instant you
 * tap your first region.
 */
export function RegionPicker({
  firstRun = false,
  onClose,
}: {
  firstRun?: boolean;
  onClose?: () => void;
}) {
  const committed = useSelectedRegionsStore((s) => s.selected);
  const setSelected = useSelectedRegionsStore((s) => s.setSelected);
  const [pending, setPending] = useState<Set<string>>(() => new Set(committed));

  const [country, setCountry] = useState<(typeof COUNTRIES)[number]>(
    COUNTRIES[0],
  );
  const countryRegions = useMemo(
    () => REGIONS.filter((r) => r.country === country),
    [country],
  );
  const [focusedId, setFocusedId] = useState(countryRegions[0].id);
  const focused =
    countryRegions.find((r) => r.id === focusedId) ?? countryRegions[0];

  /** How many regions are picked in each country, for the tab badges. */
  const countsByCountry = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of REGIONS) {
      if (!pending.has(r.id)) continue;
      m.set(r.country, (m.get(r.country) ?? 0) + 1);
    }
    return m;
  }, [pending]);

  /** Every picked region, in declaration order — the summary strip. */
  const pickedRegions = useMemo(
    () => REGIONS.filter((r) => pending.has(r.id)),
    [pending],
  );

  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  useEffect(() => {
    mapRef.current?.animateToRegion(locatorRegion(focused), 350);
  }, [focused]);

  // First run is SINGLE-select: you start in exactly one area (and can add more
  // later via "Manage regions", which is multi-select). Tapping a row in
  // first-run mode replaces the selection; in the in-app modal it toggles.
  const togglePending = (id: string) => {
    setFocusedId(id);
    if (firstRun) {
      setPending(new Set([id]));
      return;
    }
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = () => {
    setSelected([...pending]);
    onClose?.();
  };

  // ⚠️ Explicit insets, NOT <SafeAreaView edges={['top','bottom']}>.
  //
  // This screen is shown two ways: as the first-run gate, and as a <Modal> from
  // the Map tab's filter. Inside a React Native Modal the safe-area insets don't
  // reliably reach a SafeAreaView, so the padding collapsed to nothing — the ✕
  // ended up under the notch and the "Done" bar under the home indicator, both
  // unpressable. Reading the insets directly and flooring them means the layout
  // is right in both contexts, and still sane if the insets report 0.
  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Where do you want to walk?</Text>
          <Text style={styles.subtitle}>
            {firstRun
              ? 'Pick an area to start — you can add more anytime.'
              : 'Add or remove areas to load on the map.'}
          </Text>
        </View>
        {onClose && (
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={COLORS.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Country switch — horizontally scrollable: with seven countries, evenly
          split flex tabs were too narrow to read the names. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.countryRow}
        contentContainerStyle={styles.countryRowContent}
      >
        {COUNTRIES.map((c) => {
          const on = c === country;
          // ⚠️ The list only ever shows ONE country, so without this a region
          // picked in Switzerland is completely invisible while you're looking
          // at Italy — the footer's "3 selected" told you a number but never
          // where they were.
          const n = countsByCountry.get(c) ?? 0;
          return (
            <TouchableOpacity
              key={c}
              style={[styles.countryTab, on && styles.countryTabOn]}
              onPress={() => {
                setCountry(c);
                setFocusedId(REGIONS.find((r) => r.country === c)!.id);
              }}
              activeOpacity={0.8}
              accessibilityLabel={
                n > 0 ? `${c}, ${n} region${n === 1 ? '' : 's'} selected` : c
              }
            >
              <Text style={[styles.countryText, on && styles.countryTextOn]}>
                {c}
              </Text>
              {n > 0 && (
                <View style={[styles.countBadge, on && styles.countBadgeOn]}>
                  <Text style={[styles.countBadgeText, on && styles.countBadgeTextOn]}>
                    {n}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Locator map */}
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={locatorRegion(focused)}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          pointerEvents="none"
        >
          {countryRegions.map((r) => {
            const isFocused = r.id === focused.id;
            const isPicked = pending.has(r.id);
            return (
              <Marker
                key={r.id}
                coordinate={{
                  latitude: (r.bbox.south + r.bbox.north) / 2,
                  longitude: (r.bbox.west + r.bbox.east) / 2,
                }}
                pinColor={
                  isFocused ? COLORS.trail : isPicked ? COLORS.green : '#9aa5a0'
                }
              />
            );
          })}
        </MapView>
        <View style={styles.mapLabel} pointerEvents="none">
          <Text style={styles.mapLabelText} numberOfLines={1}>
            {focused.name}
          </Text>
        </View>
      </View>

      {/* Everything currently picked, across ALL countries, tappable to remove.
          Only in the manage-regions modal: first-run is single-select, so a
          summary of one thing you just tapped would be noise. */}
      {!firstRun && pickedRegions.length > 0 && (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>
            Loaded on the map ({pickedRegions.length})
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.summaryRow}
          >
            {pickedRegions.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.summaryChip}
                onPress={() => togglePending(r.id)}
                activeOpacity={0.75}
                accessibilityLabel={`Remove ${r.name}`}
              >
                <Text style={styles.summaryChipText} numberOfLines={1}>
                  {r.name}
                </Text>
                <Ionicons name="close" size={14} color={COLORS.greenDeep} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Subregion list */}
      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 12 }}>
        {countryRegions.map((r) => {
          const picked = pending.has(r.id);
          const isFocused = r.id === focused.id;
          // A region can exist before its offline data does (newly added
          // countries ship empty until generated). Show it, but don't let someone
          // pick it and land on a blank map.
          const noData = bundledRegionHutCount(r.id) === 0;
          return (
            <TouchableOpacity
              key={r.id}
              // ⚠️ Order matters: `rowPicked` must win over `rowFocused`. Focus is
              // just "the row you last tapped, shown on the locator map"; being
              // SELECTED is the thing you're deciding, so it takes the strong
              // treatment and focus is reduced to a thin outline.
              style={[
                styles.row,
                isFocused && !picked && styles.rowFocused,
                picked && styles.rowPicked,
                noData && styles.rowDisabled,
              ]}
              onPress={() => !noData && togglePending(r.id)}
              activeOpacity={noData ? 1 : 0.7}
              disabled={noData}
              accessibilityRole={firstRun ? 'radio' : 'checkbox'}
              accessibilityState={{ checked: picked, disabled: noData }}
            >
              <Ionicons
                name={
                  firstRun
                    ? picked
                      ? 'radio-button-on'
                      : 'radio-button-off'
                    : picked
                      ? 'checkbox'
                      : 'square-outline'
                }
                size={24}
                color={picked ? COLORS.green : '#c2ccc6'}
              />
              <View style={styles.rowText}>
                <Text style={[styles.rowName, picked && styles.rowNamePicked]}>
                  {r.name}
                </Text>
                <Text style={styles.rowBlurb}>
                  {noData ? 'Offline data not downloaded yet' : r.blurb}
                </Text>
              </View>
              {/* A word, not just a tick — the checkbox alone was easy to miss. */}
              {picked && !firstRun && (
                <View style={styles.loadedPill}>
                  <Text style={styles.loadedPillText}>Loaded</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Confirm */}
      <View style={styles.footer}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={confirm}
          disabled={pending.size === 0}
        >
          <LinearGradient
            colors={pending.size === 0 ? ['#c2ccc6', '#c2ccc6'] : GRADIENT.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.startBtn}
          >
            <Text style={styles.startText}>
              {firstRun
                ? pending.size > 0
                  ? `Start walking  ·  ${REGIONS.find((r) => pending.has(r.id))?.name ?? ''}`
                  : 'Start walking'
                : `Done${pending.size > 0 ? `  ·  ${pending.size} selected` : ''}`}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    // Sits below the safe-area top padding the container adds. 8 was too tight —
    // the ✕ crowded the status bar even when the inset did apply.
    paddingTop: 14,
    paddingBottom: 12,
  },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.ink },
  subtitle: { fontSize: 13, color: COLORS.muted, marginTop: 4 },
  countryRow: { flexGrow: 0, marginBottom: 12 },
  countryRowContent: { gap: 8, paddingHorizontal: 20 },
  countryTab: {
    // No `flex: 1` — tabs size to their label and the row scrolls instead.
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    backgroundColor: COLORS.surface,
  },
  /** "2 picked here" badge on an unselected tab — green on white. */
  countBadge: {
    minWidth: 19,
    height: 19,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.green,
  },
  /** On the active (green) tab, invert so the badge stays legible. */
  countBadgeOn: { backgroundColor: 'white' },
  countBadgeText: { fontSize: 11.5, fontWeight: '800', color: 'white' },
  countBadgeTextOn: { color: COLORS.greenDeep },
  countryTabOn: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  countryText: { fontSize: 14, fontWeight: '700', color: COLORS.muted },
  countryTextOn: { color: 'white' },
  mapWrap: {
    marginHorizontal: 20,
    height: 160,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    ...coloredShadow(COLORS.green, 0.14),
  },
  map: { ...StyleSheet.absoluteFillObject },
  mapLabel: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.sm,
  },
  mapLabelText: { fontSize: 13, fontWeight: '700', color: COLORS.ink },
  list: { flex: 1, marginTop: 12, paddingHorizontal: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    marginBottom: 6,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  /** Last-tapped row — what the locator map is showing. Deliberately faint: it
   *  is not a selection, and a strong outline here was being read as one. */
  rowFocused: { borderColor: COLORS.trailSoft },
  /** SELECTED. Tinted fill + green border so it reads across the whole list at a
   *  glance, rather than depending on a 24 px checkbox. */
  rowPicked: { backgroundColor: COLORS.greenTint, borderColor: COLORS.green },
  /** Region declared but its offline data not generated yet. */
  rowDisabled: { opacity: 0.45 },
  rowText: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '700', color: COLORS.ink },
  rowNamePicked: { color: COLORS.greenDeep },
  loadedPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.green,
  },
  loadedPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: 'white',
    letterSpacing: 0.3,
  },
  summary: { paddingHorizontal: 20, paddingTop: 12 },
  summaryLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: COLORS.muted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  summaryRow: { gap: 8, paddingRight: 20 },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.greenTint,
    borderWidth: 1,
    borderColor: COLORS.green,
  },
  summaryChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.greenDeep,
    maxWidth: 190,
  },
  rowBlurb: { fontSize: 12.5, color: COLORS.muted, marginTop: 2 },
  // `paddingBottom` was missing entirely, so the button sat flush against the
  // screen edge (and under the home indicator whenever the inset didn't apply).
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
  startBtn: {
    borderRadius: RADIUS.md,
    paddingVertical: 15,
    alignItems: 'center',
    ...coloredShadow(COLORS.greenDeep, 0.22),
  },
  startText: { color: 'white', fontSize: 16, fontWeight: '800' },
});
