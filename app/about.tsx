import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { remoteSupportEmail } from '../src/api/remoteConfig';
import Account from '../src/components/Account';
import DeleteMyData from '../src/components/DeleteMyData';
import { PRIVACY_URL } from '../src/constants/links';
import { COLORS, RADIUS, coloredShadow } from '../src/constants/theme';
import { clearPhotoCache } from '../src/utils/photoCache';
import { clearDownloadedPhotos, downloadedPhotoBytes } from '../src/utils/photoFiles';

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

/**
 * Apple requires a reachable privacy policy and a support contact, and checks
 * both during review. The addresses now live in src/constants/links.ts, because
 * the Account tab links to the policy too and a second copy of the URL is a
 * second chance for one of them to rot unnoticed.
 *
 * The email below is the FALLBACK. `config.json` on the same site overrides it
 * at runtime, so it can be changed without an app release — see
 * src/api/remoteConfig.ts. Keep this value correct anyway: it is what a phone
 * that has never been online will show.
 */
const FALLBACK_SUPPORT_EMAIL = 'margot.soederhuizen@live.nl';

/**
 * ⚠️ WHAT THE APP DOES, BEFORE WHERE ITS DATA CAME FROM. This screen was built
 * as a credits and licence page, and that is still its legal job — but it is
 * also the only "About" there is, and somebody who taps About wants to know
 * what the thing in their hand can do. The attribution block below is not
 * optional; this list is what makes the screen worth opening.
 */
const FEATURES = [
  {
    icon: 'sparkles-outline' as const,
    title: 'Plan a hut-to-hut walk',
    what: 'Say where you want to walk and how far and how much climbing you want in a day. It links huts into a route and offers up to three alternatives to swipe between.',
  },
  {
    icon: 'trail-sign-outline' as const,
    title: 'Real trails, not straight lines',
    what: 'Every leg is routed along actual paths, with distance, ascent, walking time, a height profile and the T1–T6 Alpine difficulty grade for the day.',
  },
  {
    icon: 'map-outline' as const,
    title: 'Every hut on one map',
    what: 'Staffed huts, unstaffed refuges, bivouacs, mountain guesthouses and the villages between them — with photos, contact details and how to book.',
  },
  {
    icon: 'train-outline' as const,
    title: 'Lifts and mountain trains',
    what: 'Let a cable car, gondola, funicular or mountain railway take a climb off the day, and huts that were out of reach come into range.',
  },
  {
    icon: 'cloud-offline-outline' as const,
    title: 'Works without signal',
    what: 'Huts, saved trips, their routes and their photos are on the phone. Only planning a new route and the map background need a connection.',
  },
  {
    icon: 'share-social-outline' as const,
    title: 'Save and share routes',
    what: 'Keep a plan, reorder its days by dragging, and hand it to a walking partner with an eight-character code they can open on their own phone.',
  },
  {
    icon: 'camera-outline' as const,
    title: 'Your own notes and photos',
    what: 'Add photos and notes to any hut, just for you — or send a photo or review in for everyone, and report a hut the map is missing.',
  },
];

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
  {
    icon: 'camera-outline' as const,
    name: 'refuges.info',
    what: 'Photographs of refuges in France, the Pyrenees and the nearby Alps, taken by its contributors.',
    licence: '© refuges.info contributors · CC BY-SA',
    url: 'https://www.refuges.info/',
  },
  {
    icon: 'train-outline' as const,
    name: 'Alpenverein hut register',
    what: 'Telephone numbers, hut websites and how to reach a hut by train or bus, for the Austrian, German and South Tyrolean club huts.',
    licence: '© Österreichischer Alpenverein',
    url: 'https://www.alpenverein.at/huetten/',
  },
];

export default function AboutScreen() {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const [photosCleared, setPhotosCleared] = useState(false);
  const [stored, setStored] = useState(0);
  useEffect(() => {
    let alive = true;
    downloadedPhotoBytes().then((n) => alive && setStored(n));
    return () => {
      alive = false;
    };
  }, []);
  const open = (url: string) => Linking.openURL(url).catch(() => {});

  // The published address when the phone has seen the web, the compiled-in one
  // otherwise. Read at render rather than captured, so a change takes effect on
  // the next launch without any wiring here.
  const supportEmail = remoteSupportEmail() ?? FALLBACK_SUPPORT_EMAIL;

  return (
    <>
      <Stack.Screen options={{ title: 'About' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.lede}>
          A planner for multi-day hut-to-hut walks in the Alps and beyond — pick
          where you want to walk, set how far and how much climbing you want in a
          day, and it links huts into a route along real trails.
        </Text>

        <Text style={styles.sectionLabel}>What it does</Text>
        <View style={styles.card}>
          {FEATURES.map((f, i) => (
            <View key={f.title} style={[styles.source, i > 0 && styles.sourceDivider]}>
              <View style={styles.sourceIcon}>
                <Ionicons name={f.icon} size={18} color={COLORS.green} />
              </View>
              <View style={styles.sourceText}>
                <Text style={styles.sourceName}>{f.title}</Text>
                <Text style={styles.sourceWhat}>{f.what}</Text>
              </View>
            </View>
          ))}
        </View>

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
            {/* ⚠️ Keep this in step with docs/privacy.html. It used to say
                "never uploaded", which stopped being true the moment sharing
                shipped, and then "there is no sign-up", which stopped being
                true when accounts did — a false claim about data handling in
                the app itself is worse than a vague one. */}
            <Text style={styles.blockText}>
              There is no tracking and no advertising. Browsing the map and the huts
              needs no account at all.
            </Text>
            <Text style={styles.blockText}>
              An account — an email address and a password, nothing else — is needed to
              save a trip, to share one, and to send in a photo or a review. It exists so
              that what you keep survives a new phone and what you share can be taken back.
            </Text>
            <Text style={styles.blockText}>
              Anything you send in is checked before anyone else sees it, and you can
              delete all of it below. Your notes and your own hut photos stay on this phone.
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
          {/* ⚠️ Apple requires account deletion to be reachable IN THE APP once
              the app offers account creation — an email address to write to is
              explicitly not sufficient, and an anonymous account still counts.
              It renders nothing when the community features are switched off. */}
          {/* Optional: an email and password so contributions survive a new
              phone. Renders nothing until the community backend is configured,
              and never blocks contributing — see src/components/Account.tsx. */}
          <View style={styles.sourceDivider} />
          <Account />
          <View style={styles.sourceDivider} />
          <DeleteMyData />
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

        <Text style={styles.sectionLabel}>Photos</Text>
        <View style={styles.card}>
          <View style={styles.block}>
            <Text style={styles.blockText}>
              Hut photos are remembered on this phone so they appear instantly
              next time. Photos for the huts on your route are downloaded in
              full, so they still work with no signal.
            </Text>
            <Text style={styles.blockText}>
              {stored > 0
                ? `${(stored / 1024 / 1024).toFixed(1)} MB downloaded. Clearing frees that space; photos are fetched again when you need them.`
                : 'If a photo looks wrong or out of date, clear them and they’ll be fetched again.'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.linkRow, styles.sourceDivider]}
            onPress={async () => {
              // Both halves, or the files would be orphaned on disk with no
              // cache entry pointing at them.
              await Promise.all([clearPhotoCache(), clearDownloadedPhotos()]);
              setStored(0);
              setPhotosCleared(true);
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh-outline" size={17} color={COLORS.green} />
            <Text style={styles.linkText}>
              {photosCleared ? 'Cleared — reopen a hut to reload' : 'Clear saved photos'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Support</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => open(`mailto:${supportEmail}`)}
            activeOpacity={0.7}
          >
            <Ionicons name="mail-outline" size={17} color={COLORS.green} />
            <Text style={styles.linkText}>{supportEmail}</Text>
          </TouchableOpacity>
        </View>

        {/* ⚠️ A LONG PRESS HIDES THIS SCREEN, IT DOES NOT PROTECT IT. The
            moderation queue ships in every copy of the app; what keeps people
            out is is_moderator() and the policies on the server, which return
            nothing and refuse every write to anyone else. This gesture exists
            so ordinary users never stumble into a screen that would only
            confuse them — treating it as a lock would be a mistake. */}
        <TouchableOpacity
          onLongPress={() => router.push('/moderate')}
          delayLongPress={800}
          activeOpacity={1}
          accessibilityRole="text"
        >
          <Text style={styles.version}>Alpine Huts {version}</Text>
        </TouchableOpacity>
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
