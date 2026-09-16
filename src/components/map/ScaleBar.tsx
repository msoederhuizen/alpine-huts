/**
 * The map's scale bar, and the decluster threshold that is defined in terms of
 * what it reads.
 *
 * Moved out of `app/(tabs)/index.tsx`. `scaleBarDistanceM` is exported because
 * the Map screen decides when to break clusters apart from the SAME number the
 * bar prints — keeping the two in one module is what stops them disagreeing.
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Region as MapCamera } from 'react-native-maps';

import { COLORS } from '../../constants/theme';

/** "Nice" round distances (metres) a scale bar is allowed to show, so the label
 *  is always a clean 1/2/5·10ⁿ figure rather than an arbitrary number. */
const SCALE_NICE_M = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000,
  100000, 250000, 500000,
];

/**
 * The distance the scale bar currently reads, in metres — the "nice" value it
 * would print. Shared by `ScaleBar` and the decluster decision in `MapScreen`
 * so the two can never disagree about what the bar says.
 *
 * Returns null when the camera isn't measurable yet.
 */
export function scaleBarDistanceM(cam: MapCamera, mapWidth: number): number | null {
  const metersPerDegLon = 111320 * Math.cos((cam.latitude * Math.PI) / 180);
  const metersPerPx = (cam.longitudeDelta * metersPerDegLon) / mapWidth;
  if (!Number.isFinite(metersPerPx) || metersPerPx <= 0) return null;
  const maxMeters = metersPerPx * 90; // longest bar we'll draw
  let dist = SCALE_NICE_M[0];
  for (const s of SCALE_NICE_M) {
    if (s <= maxMeters) dist = s;
    else break;
  }
  return dist;
}

/**
 * Once the scale bar reads this or less, every hut gets its own pin — no bubbles.
 *
 * Keyed to the BAR, not to a zoom level, because the zoom at which the bar shows
 * 2 km depends on screen width: 9.4 on a 768 px iPad, 10.4 on a 393 px phone,
 * 10.6 on a 320 px one. An integer zoom threshold (the previous
 * `CLUSTER_TUNING.maxZoom` approach) therefore left bubbles on screen at 2 km on
 * some devices — which is exactly what got reported.
 *
 * Costs ~180 pins in the worst case measured (densest Bernese Oberland on a
 * 393 px phone), against 450–625 for the original unclustered map. The marker
 * pool means those mount once rather than churning.
 */
export const DECLUSTER_SCALE_M = 2000;

/**
 * A small map scale bar (bottom-right). Picks the largest "nice" round distance
 * that fits within ~90 px at the current zoom and draws a ticked bar of exactly
 * that real-world width, with the distance labelled above it. Reads the settled
 * `camera` (updated on `onRegionChangeComplete`), so it re-scales after each
 * pan/zoom — good enough for a scale bar and avoids per-frame recompute.
 */
export const ScaleBar = memo(function ScaleBar({
  camera,
  mapWidth,
}: {
  camera: MapCamera;
  mapWidth: number;
}) {
  const dist = scaleBarDistanceM(camera, mapWidth);
  if (dist == null) return null;
  const metersPerDegLon = 111320 * Math.cos((camera.latitude * Math.PI) / 180);
  const metersPerPx = (camera.longitudeDelta * metersPerDegLon) / mapWidth;
  const barPx = Math.round(dist / metersPerPx);
  const label = dist >= 1000 ? `${dist / 1000} km` : `${dist} m`;

  return (
    <View style={styles.scaleBar}>
      <Text style={styles.scaleLabel}>{label}</Text>
      <View style={[styles.scaleLine, { width: barPx }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  scaleBar: { alignItems: 'flex-end' },
  scaleLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.ink,
    marginBottom: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.78)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  // Left/right/bottom borders only → an open-topped "⊔" bar with end ticks, the
  // classic scale-bar shape. The faint white fill keeps it legible on dark map
  // terrain.
  scaleLine: {
    height: 5,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: COLORS.ink,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
