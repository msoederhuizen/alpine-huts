import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useQueryClient } from '@tanstack/react-query';

import { coloredShadow, COLORS, GRADIENT, RADIUS } from '../../src/constants/theme';
import { legQueryOptions } from '../../src/hooks/useRouteLegs';
import {
  useSavedTripsStore,
  type SavedTrip,
} from '../../src/store/savedTripsStore';
import { useTripStore } from '../../src/store/tripStore';
import { unpackLeg } from '../../src/utils/packLeg';

export default function SavedTripsScreen() {
  const queryClient = useQueryClient();
  const trips = useSavedTripsStore((s) => s.trips);
  const hydrated = useSavedTripsStore((s) => s._hydrated);
  const removeTrip = useSavedTripsStore((s) => s.removeTrip);
  const rename = useSavedTripsStore((s) => s.rename);
  const loadInto = useTripStore((s) => s.setTrip);
  const currentCount = useTripStore((s) => s.huts.length);
  const router = useRouter();

  const [renaming, setRenaming] = useState<SavedTrip | null>(null);
  const [renameText, setRenameText] = useState('');

  const load = (trip: SavedTrip) => {
    const go = () => {
      // Seed the leg cache from the trip's stored geometry BEFORE switching the
      // trip store over, so the Route tab and the map's trail render from it
      // immediately rather than firing off a BRouter request they can't complete
      // without signal. `staleTime`/`gcTime: Infinity` on these queries mean the
      // seed is then treated as fresh and never evicted (see useRouteLegs).
      // Trips saved before geometry was stored have no `legs` and simply route
      // on open, as they always did.
      if (trip.legs) {
        const scenic = trip.scenic ?? false;
        trip.huts.slice(1).forEach((to, i) => {
          const packed = trip.legs?.[i];
          if (!packed) return;
          const ride = trip.rides?.[i] ?? null;
          queryClient.setQueryData(
            legQueryOptions(trip.huts[i], to, scenic, ride).queryKey,
            unpackLeg(packed),
          );
        });
      }
      loadInto(trip.huts, trip.scenic ?? false, trip.rides ?? []);
      router.navigate('/route');
    };
    if (currentCount > 0) {
      Alert.alert(
        'Load this trip?',
        'This replaces the huts currently in your route.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Load', onPress: go },
        ],
      );
    } else {
      go();
    }
  };

  const confirmDelete = (trip: SavedTrip) => {
    Alert.alert('Delete trip', `Delete “${trip.name}”?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeTrip(trip.id) },
    ]);
  };

  const openRename = (trip: SavedTrip) => {
    setRenameText(trip.name);
    setRenaming(trip);
  };

  const confirmRename = () => {
    if (renaming) rename(renaming.id, renameText);
    setRenaming(null);
  };

  if (hydrated && trips.length === 0) {
    return (
      <View style={styles.empty}>
        <LinearGradient
          colors={['#eaf4ee', '#dcece2']}
          style={styles.emptyIconWrap}
        >
          <Ionicons name="bookmark" size={40} color={COLORS.greenBright} />
        </LinearGradient>
        <Text style={styles.emptyTitle}>No saved trips</Text>
        <Text style={styles.emptySubtitle}>
          Build a route on the Map, then tap “Save trip” on the Route tab to
          keep it here.
        </Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: SavedTrip }) => {
    const first = item.huts[0]?.name ?? '';
    const last = item.huts[item.huts.length - 1]?.name ?? '';
    const summary =
      item.huts.length > 1 ? `${first} → ${last}` : first || 'Empty trip';
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => load(item)}
        activeOpacity={0.7}
      >
        <LinearGradient
          colors={GRADIENT.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardBadge}
        >
          <Ionicons name="trail-sign" size={18} color="white" />
        </LinearGradient>
        <View style={styles.cardMain}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.cardSummary} numberOfLines={1}>
            {item.huts.length} {item.huts.length === 1 ? 'hut' : 'huts'} ·{' '}
            {summary}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => openRename(item)}
          hitSlop={8}
          style={styles.cardIcon}
          accessibilityLabel={`Rename ${item.name}`}
        >
          <Ionicons name="pencil" size={16} color={COLORS.green} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => confirmDelete(item)}
          hitSlop={8}
          style={styles.cardIconDanger}
          accessibilityLabel={`Delete ${item.name}`}
        >
          <Ionicons name="trash" size={16} color={COLORS.danger} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={trips}
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />

      <Modal
        visible={renaming != null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Rename trip</Text>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              placeholder="Trip name"
              style={styles.input}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmRename}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalCancel, styles.cancelPill]}
                activeOpacity={0.85}
                onPress={() => setRenaming(null)}
              >
                <Text style={styles.cancelPillText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.85} onPress={confirmRename}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: 14 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: RADIUS.lg,
    marginBottom: 10,
    gap: 12,
    ...coloredShadow(COLORS.green, 0.1),
  },
  cardBadge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMain: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '700', color: COLORS.ink },
  cardSummary: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  cardIcon: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: COLORS.greenTint,
  },
  cardIconDanger: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(192,57,43,0.09)',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 8,
    backgroundColor: COLORS.bg,
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
    color: COLORS.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,25,20,0.5)',
    justifyContent: 'center',
    padding: 28,
  },
  modalSheet: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: 22,
    ...coloredShadow(COLORS.ink, 0.25),
  },
  modalTitle: { fontSize: 19, fontWeight: '800', color: COLORS.ink, marginBottom: 16 },
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
    color: '#ffffff',
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
});
