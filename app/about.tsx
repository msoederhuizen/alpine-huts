import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS, RADIUS, coloredShadow } from '../src/constants/theme';

/**
 * About / credits.
 *
 * ⚠️ THIS SCREEN EXISTS FOR A LEGAL REASON, not as a nicety. The hut data comes
 * from OpenStreetMap under the ODbL, which requires the source to be credited
 * where users can see it, and Apple asks a submitter to confirm they hold the
 * rights to third-party content. Before this screen the app named OpenStreetMap
 * only in passing body text and credited nothing.
 *
 * So: don't remove the attribution block, and if a new data source is added,
 * add it here at the same time.
 */

/** ⚠️ SET BEFORE SUBMITTING — Apple requires a reachable privacy policy and a
 *  support contact, and both are checked during review. */
const PRIVACY_URL = 'https://example.com/alpine-huts/privacy';
const SUPPORT_EMAIL = 'support@example.com';

const SOURCES = [
  {
    icon: 'map-outline' as const,
    name: 'OpenStreetMap',
    what: 'Every hut, refuge, bivouac, guesthouse and village in the app, and the trails themselves.',
    licence: '© OpenStreetMap contributors · ODbL',
    url: 'https://www.openstreetmap.org/copyright',
  },
  {
    icon: 'trending-up-outline' as const,
    name: 'Open-Meteo',
    what: 'Elevation for places OpenStreetMap has no height for.',
    licence: 'Open-Meteo elevation API · CC BY 4.0',
    url: 'https://open-meteo.com/',
  },
  {
    icon: 'git-branch-outline' as const,
    name: 'BRouter',
    what: 'Walking routes along real paths, and the T1–T6 difficulty grading.',
    licence: 'BRouter · GPL',
    url: 'https://github.com/abrensch/brouter',
  },
  {
    icon: 'image-outline' as const,
    name: 'Wikimedia Commons & Wikipedia',
    what: 'Hut photographs, each credited to its photographer with its licence.',
    licence: 'Individual licences, mostly CC BY-SA',
    url: 'https://commons.wikimedia.org/',
  },
];

export default function AboutScreen() {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const open = (url: string) => Linking.openURL(url).catch(() => {});

  return (
    <>
      <Stack.Screen options={{ title: 'About' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.lede}>
          A planner for multi-day hut-to-hut walks in the Alps and beyond — pick
          where you want to walk, set how far and how much climbing you want in a
          day, and it links huts into a route along real trails.
        </Text>

        <Text style={styles.sectionLabel}>Where the data comes from</Text>
        <View style={styles.card}>
          {SOURCES.map((s, i) => (
            <TouchableOpacity
              key={s.name}
              style={[styles.source, i > 0 && styles.sourceDivider]}
              onPress={() => open(s.url)}
              activeOpacity={0.7}
            >
              <View style={styles.sourceIcon}>
                <Ionicons name={s.icon} size={18} color={COLORS.green} />
              </View>
              <View style={styles.sourceText}>
                <Text style={styles.sourceName}>{s.name}</Text>
                <Text style={styles.sourceWhat}>{s.what}</Text>
                <Text style={styles.sourceLicence}>{s.licence}</Text>
              </View>
              <Ionicons name="open-outline" size={15} color={COLORS.muted} />
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.note}>
          Hut information is community-maintained and can be out of date. Always
          check opening dates and book ahead — and never rely on this app alone
          in the mountains.
        </Text>

        <Text style={styles.sectionLabel}>Your privacy</Text>
        <View style={styles.card}>
          <View style={styles.block}>
            <Text style={styles.blockText}>
              There is no account and no tracking. Your saved trips, your own hut
              photos and your notes stay on this phone and are never uploaded.
            </Text>
            <Text style={styles.blockText}>
              Your location is used only to show where you are on the map. The
              app sends coordinates to its routing server to draw a walking route
              between two huts; nothing identifies you.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.linkRow, styles.sourceDivider]}
            onPress={() => open(PRIVACY_URL)}
            activeOpacity={0.7}
          >
            <Ionicons name="shield-checkmark-outline" size={17} color={COLORS.green} />
            <Text style={styles.linkText}>Read the full privacy policy</Text>
            <Ionicons name="open-outline" size={15} color={COLORS.muted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Offline use</Text>
        <View style={styles.card}>
          <View style={styles.block}>
            <Text style={styles.blockText}>
              Huts, saved trips and hut pages work with no signal — the data is
              built into the app.
            </Text>
            <Text style={styles.blockText}>
              The map background and planning a new route both need a connection.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Support</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => open(`mailto:${SUPPORT_EMAIL}`)}
            activeOpacity={0.7}
          >
            <Ionicons name="mail-outline" size={17} color={COLORS.green} />
            <Text style={styles.linkText}>{SUPPORT_EMAIL}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>Alpine Huts {version}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 20, paddingBottom: 44 },
  lede: { fontSize: 15.5, lineHeight: 23, color: COLORS.ink, marginBottom: 8 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: COLORS.muted,
    marginTop: 26,
    marginBottom: 10,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    ...coloredShadow(COLORS.green, 0.09),
  },
  source: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 15,
  },
  sourceDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8e4' },
  sourceIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: COLORS.greenTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceText: { flex: 1, gap: 2 },
  sourceName: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  sourceWhat: { fontSize: 13, color: COLORS.muted, lineHeight: 18 },
  sourceLicence: { fontSize: 11.5, color: COLORS.green, fontWeight: '600', marginTop: 2 },
  note: {
    fontSize: 12.5,
    color: COLORS.muted,
    lineHeight: 18,
    marginTop: 10,
    fontStyle: 'italic',
  },
  block: { padding: 15, gap: 10 },
  blockText: { fontSize: 14, color: COLORS.muted, lineHeight: 20 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 15 },
  linkText: { flex: 1, fontSize: 14.5, color: COLORS.green, fontWeight: '600' },
  version: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 30,
  },
});
