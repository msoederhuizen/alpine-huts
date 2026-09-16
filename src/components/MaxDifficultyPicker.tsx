import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePreferencesStore } from '../store/preferencesStore';
import {
  SAC_SCALE_COLOR,
  SAC_SCALE_DIFFICULTY,
  SAC_SCALE_GRADE,
  SAC_SCALE_ORDER,
  type SacScale,
} from '../utils/sacScale';
import { SacInfoButton } from './SacInfoButton';

/**
 * The hardest trail the router is allowed to use, T1–T6.
 *
 * ⚠️ This is a CEILING on routing, not a promise about the ground. Most OSM
 * trail segments carry no `sac_scale` at all, so an untagged path of any
 * difficulty is still eligible at every setting. The hint below says so —
 * do not reword it into a guarantee.
 *
 * Lowering it can make a hut genuinely unreachable, and that is the intended
 * behaviour: the Map tab then says so, instead of drawing a long way round.
 */
export function MaxDifficultyPicker() {
  const maxSac = usePreferencesStore((s) => s.maxSac);
  const setMaxSac = usePreferencesStore((s) => s.setMaxSac);
  const selectedIdx = SAC_SCALE_ORDER.indexOf(maxSac);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="trending-up-outline" size={19} color="#2f6f4f" />
        </View>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Hardest trail to use</Text>
            <SacInfoButton />
          </View>
          <Text style={styles.hint}>
            Routes will use trails up to {SAC_SCALE_GRADE[maxSac]} (
            {SAC_SCALE_DIFFICULTY[maxSac].toLowerCase()}). Lower this and harder
            trails are avoided — which can leave some huts unreachable. Many
            paths carry no grade at all, so this can&apos;t rule out hard ground
            entirely.
          </Text>
        </View>
      </View>

      <View style={styles.scale}>
        {SAC_SCALE_ORDER.map((scale, i) => {
          // Everything up to the chosen grade is "allowed", so the control reads
          // as a threshold rather than six unrelated buttons.
          const included = i <= selectedIdx;
          return (
            <TouchableOpacity
              key={scale}
              style={[
                styles.step,
                included && { backgroundColor: SAC_SCALE_COLOR[scale] },
                i === selectedIdx && styles.stepSelected,
              ]}
              activeOpacity={0.8}
              onPress={() => setMaxSac(scale)}
              accessibilityRole="radio"
              accessibilityState={{ selected: i === selectedIdx }}
              accessibilityLabel={`Allow trails up to ${SAC_SCALE_GRADE[scale]}, ${SAC_SCALE_DIFFICULTY[scale]}`}
            >
              <Text style={[styles.stepText, included && styles.stepTextOn]}>
                {SAC_SCALE_GRADE[scale]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.selectedLabel}>{SAC_SCALE_DIFFICULTY[maxSac]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f3ec',
  },
  headerText: { flex: 1 },
  // The ⓘ sits on the row, not on the label — `title` carries vertical margins
  // and anchoring to it pushed the icon above the text's cap height.
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 15, fontWeight: '600', color: '#1d2b24' },
  hint: { fontSize: 12.5, lineHeight: 17, color: '#6b7770', marginTop: 3 },
  scale: { flexDirection: 'row', gap: 6, marginTop: 12 },
  step: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#eef2ef',
  },
  stepSelected: { borderWidth: 2, borderColor: '#1d2b24' },
  stepText: { fontSize: 13, fontWeight: '700', color: '#9aa0a6' },
  stepTextOn: { color: '#fff' },
  selectedLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#2f6f4f',
    marginTop: 8,
    textAlign: 'center',
  },
});
