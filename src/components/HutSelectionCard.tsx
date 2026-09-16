import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { useHutCoverPhoto } from '../hooks/useHutCoverPhoto';
import type { Hut } from '../types/hut';
import { hutTypeLabel } from '../utils/hutMeta';
import { displayUri } from '../utils/hutImage';

interface Props {
  hut: Hut;
  selected: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDetails: () => void;
  /** Append this hut as the final stop, closing a loop. Absent when that isn't
   *  possible — it's only offered for a hut ALREADY in the route that isn't
   *  already the last stop. */
  onCloseLoop?: () => void;
}

/**
 * Floating card shown when a hut pin is tapped. For Milestone 2 it carries the
 * name/elevation and the add/remove-from-route action; the full photo detail
 * view arrives in Milestone 3.
 */
export function HutSelectionCard({
  hut,
  selected,
  onToggle,
  onClose,
  onDetails,
  onCloseLoop,
}: Props) {
  const kind = hutTypeLabel(hut.type);
  const { photo } = useHutCoverPhoto(hut);

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.close}
        onPress={onClose}
        hitSlop={10}
        accessibilityLabel="Close"
      >
        <Ionicons name="close" size={20} color="#888" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.topRow} onPress={onDetails} activeOpacity={0.7}>
        {photo ? (
          <Image source={{ uri: displayUri(photo) }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="image-outline" size={22} color="#c4c4c4" />
          </View>
        )}
        <View style={styles.topText}>
          <Text style={styles.name} numberOfLines={2}>
            {hut.name}
          </Text>
          <Text style={styles.meta}>
            {kind}
            {hut.elevation != null ? ` · ${Math.round(hut.elevation)} m` : ''}
          </Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.action, selected ? styles.remove : styles.add]}
        onPress={onToggle}
      >
        <Ionicons
          name={selected ? 'checkmark-circle' : 'add-circle-outline'}
          size={18}
          color="white"
        />
        <Text style={styles.actionText}>
          {selected ? 'In route — tap to remove' : 'Add to route'}
        </Text>
      </TouchableOpacity>

      {onCloseLoop && (
        <TouchableOpacity style={styles.loopBtn} onPress={onCloseLoop}>
          <Ionicons name="repeat" size={18} color="white" />
          <Text style={styles.actionText}>Finish here — round trip</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.detailsBtn}
        onPress={onDetails}
        hitSlop={6}
      >
        <Ionicons name="information-circle-outline" size={16} color={COLORS.green} />
        <Text style={styles.detailsText}>View details & photo</Text>
        <Ionicons name="chevron-forward" size={15} color={COLORS.green} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    // Sits just above the tab bar. Note this is a PLAIN offset, not
    // `useBottomTabBarHeight()` — the tab bar has no `position: 'absolute'` (see
    // app/(tabs)/_layout.tsx), so it takes up layout space and the screen's own
    // bottom edge is already the top of the bar. Adding the bar height on top
    // double-counted it and floated the card ~110px up, near mid-screen.
    bottom: 16,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    paddingRight: 40,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  close: { position: 'absolute', top: 10, right: 10, padding: 4, zIndex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  thumb: { width: 60, height: 60, borderRadius: 10, backgroundColor: '#eee' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  topText: { flex: 1 },
  name: { fontSize: 17, fontWeight: '700', color: COLORS.ink, marginBottom: 2 },
  meta: { fontSize: 13, color: '#666' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 10,
  },
  add: { backgroundColor: COLORS.green },
  // Offered only when it's actually possible — see `onCloseLoop` on the Map.
  loopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: COLORS.trail,
  },
  remove: { backgroundColor: '#b5651d' },
  actionText: { color: 'white', fontWeight: '600', fontSize: 15 },
  detailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 12,
    paddingBottom: 2,
  },
  detailsText: { color: COLORS.green, fontWeight: '600', fontSize: 14 },
});
