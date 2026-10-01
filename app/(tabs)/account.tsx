/**
 * Account, and everything else that was hiding behind a gesture or a header icon.
 *
 * ⚠️ THIS TAB EXISTS BECAUSE FINDABILITY IS A FEATURE. Reporting a missing hut
 * began as a long-press on the map: it works, it puts the report exactly where
 * the hut is, and essentially nobody discovers it — a gesture with no
 * affordance is a feature only its author knows about. The privacy policy and
 * About were two taps inside another tab's header icon. The long-press stays,
 * because it is still the best way to mark a hut you can see from a distance,
 * but none of these are hidden any more.
 *
 * ⚠️ AND THE APP STILL OPENS TO THE MAP. An account is needed to KEEP and SHARE
 * things, never to look at them — a first launch in a valley with no signal has
 * to show a map, not a sign-up form, and Apple's rule 5.1.1(v) says much the
 * same: an app may not demand personal information to function.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { communityEnabled } from '../../src/api/community';
import Account from '../../src/components/Account';
import DeleteMyData from '../../src/components/DeleteMyData';
import OpenSharedRoute from '../../src/components/OpenSharedRoute';
import ReportMissingHut, { type MissingHutSpot } from '../../src/components/ReportMissingHut';
import { PRIVACY_URL } from '../../src/constants/links';
import { COLORS, RADIUS, coloredShadow } from '../../src/constants/theme';

function Row({
  icon,
  label,
  hint,
  onPress,
  disabled,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable style={s.action} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={20} color={danger ? COLORS.danger : COLORS.green} />
      <View style={s.actionText}>
        <Text style={[s.actionLabel, danger && { color: COLORS.danger }]}>{label}</Text>
        <Text style={s.actionHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={COLORS.muted} />
    </Pressable>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const [spot, setSpot] = useState<MissingHutSpot | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [openingShare, setOpeningShare] = useState(false);

  /**
   * ⚠️ "WHERE I AM" IS THE RIGHT DEFAULT HERE, AND THE MAP IS THE FALLBACK.
   * Somebody opening this tab to report a hut is usually standing at it, and
   * their own position is more accurate than anything they could pick by eye.
   * When the fix fails or is refused, the long-press still works and the
   * message says so rather than leaving a dead button.
   */
  const reportHere = async () => {
    setLocationError('');
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setLocationError('Without location access, press and hold the hut’s spot on the map instead.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setSpot({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    } catch {
      setLocationError('Could not get a fix. Press and hold the hut’s spot on the map instead.');
    } finally {
      setLocating(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {communityEnabled && (
        <>
          <Text style={s.sectionLabel}>Your account</Text>
          <View style={s.card}>
            <Account />
          </View>
          <Text style={s.caption}>
            Needed to save a trip, to share one, and to send in a photo or a review. Looking at the
            map and the huts never needs one.
          </Text>

          <Text style={s.sectionLabel}>Routes</Text>
          <View style={s.card}>
            <Row
              icon="download-outline"
              label="Open a shared route"
              hint="Enter the eight-character code somebody sent you."
              onPress={() => setOpeningShare(true)}
            />
            <View style={s.divider} />
            <Row
              icon="bookmark-outline"
              label="Your saved trips"
              hint="Open one to share it, rename it or walk it."
              onPress={() => router.navigate('/saved')}
            />
          </View>

          <Text style={s.sectionLabel}>Help the map</Text>
          <View style={s.card}>
            <Row
              icon="add-circle-outline"
              label={locating ? 'Finding where you are…' : 'Report a hut that is missing'}
              hint="Uses where you are now. You can also press and hold anywhere on the map."
              onPress={reportHere}
              disabled={locating}
            />
            {!!locationError && <Text style={s.error}>{locationError}</Text>}
          </View>
        </>
      )}

      <Text style={s.sectionLabel}>This app</Text>
      <View style={s.card}>
        <Row
          icon="information-circle-outline"
          label="About"
          hint="What the app does, and where its hut data and photographs come from."
          onPress={() => router.push('/about')}
        />
        <View style={s.divider} />
        <Row
          icon="shield-checkmark-outline"
          label="Privacy policy"
          hint="What is kept, what is sent, and what you can delete."
          onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}
        />
      </View>

      {communityEnabled && (
        <>
          <Text style={s.sectionLabel}>Your data</Text>
          <View style={s.card}>
            <DeleteMyData />
          </View>
        </>
      )}

      <ReportMissingHut spot={spot} origin="here" onClose={() => setSpot(null)} />
      <OpenSharedRoute visible={openingShare} onClose={() => setOpeningShare(false)} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 22,
    marginBottom: 9,
    marginLeft: 4,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 4,
    ...coloredShadow(COLORS.green, 0.08),
  },
  caption: { fontSize: 12, color: COLORS.muted, lineHeight: 17, marginTop: 9, marginHorizontal: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#e2e8e4' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  actionText: { flex: 1 },
  actionLabel: { fontSize: 14.5, fontWeight: '700', color: COLORS.ink },
  actionHint: { fontSize: 12.5, color: COLORS.muted, marginTop: 2, lineHeight: 17 },
  error: { fontSize: 12.5, color: COLORS.trail, marginBottom: 10, lineHeight: 17 },
});
