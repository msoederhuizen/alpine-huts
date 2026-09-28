/**
 * The moderation queue: photos and reviews waiting to be checked, and photos
 * people have flagged as wrong.
 *
 * ⚠️ THIS SCREEN IS NOT THE SECURITY BOUNDARY AND MUST NOT BE MISTAKEN FOR ONE.
 * It ships inside the app, in every copy, to every user. Hiding it behind a
 * long-press keeps it out of the way; it does not keep anyone out. What keeps
 * people out is `is_moderator()` and the policies in 0003_moderation.sql — an
 * ordinary user who reaches this screen sees three empty lists and every button
 * they press changes nothing, because the server refuses.
 *
 * That is the property that makes shipping it safe, and the reason the code
 * below does not bother to check permissions before rendering: a check here
 * would be decoration.
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  amModerator,
  backendMessage,
  checkBackend,
  judgePhoto,
  judgeReview,
  myUserId,
  openReports,
  pendingPhotos,
  pendingReviews,
  resolveReport,
  type OpenReport,
  type PendingPhoto,
  type PendingReview,
} from '../src/api/community';
import { COLORS, RADIUS, coloredShadow } from '../src/constants/theme';

const REASON_LABEL: Record<string, string> = {
  wrong_place: 'Wrong building',
  not_a_building: 'Not a photo of a place',
  offensive: 'Offensive',
  other: 'Something else',
};

export default function Moderate() {
  const [ready, setReady] = useState(false);
  const [isMod, setIsMod] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [reports, setReports] = useState<OpenReport[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const [mod, id] = await Promise.all([amModerator(), myUserId()]);
    setIsMod(mod);
    setUid(id);
    if (mod) {
      const [p, r, f] = await Promise.all([pendingPhotos(), pendingReviews(), openReports()]);
      setPhotos(p);
      setReviews(r);
      setReports(f);
    }
    setReady(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const act = async (key: string, fn: () => Promise<boolean>, after: () => void) => {
    setBusy(key);
    const ok = await fn();
    setBusy(null);
    if (ok) after();
    else setStatus('That did not go through — check the connection and try again.');
  };

  if (!ready) {
    return (
      <>
        <Stack.Screen options={{ title: 'Moderation' }} />
        <View style={s.centre}><ActivityIndicator color={COLORS.green} /></View>
      </>
    );
  }

  // Not a moderator: say exactly why and give them the id they need, rather
  // than an empty screen that looks broken. This is the first-run path — the
  // account does not exist until the app has signed in once.
  if (!isMod) {
    return (
      <>
        <Stack.Screen options={{ title: 'Moderation' }} />
        <ScrollView contentContainerStyle={s.page}>
          <View style={s.card}>
            <Text style={s.title}>Not set up on this device</Text>
            <Text style={s.body}>
              Moderating is granted per device. To grant it to this one, add the id below to the
              `moderators` table in the Supabase SQL editor, then pull down to refresh.
            </Text>
            <Text selectable style={s.uid}>{uid ?? 'no id yet — no connection'}</Text>
            <Text style={s.code} selectable>
              insert into public.moderators (user_id, note){'\n'}
              values ('{uid ?? '…'}', 'my phone');
            </Text>
            <Pressable
              style={s.button}
              onPress={async () => setStatus(backendMessage(await checkBackend()))}
            >
              <Text style={s.buttonText}>Test the connection</Text>
            </Pressable>
            {!!status && <Text style={s.status}>{status}</Text>}
          </View>
        </ScrollView>
      </>
    );
  }

  const nothing = !photos.length && !reviews.length && !reports.length;

  return (
    <>
      <Stack.Screen options={{ title: 'Moderation' }} />
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.green} />}
      >
        {nothing && (
          <View style={s.card}>
            <Text style={s.title}>Nothing waiting</Text>
            <Text style={s.body}>Pull down to check again.</Text>
          </View>
        )}

        {!!reports.length && (
          <>
            <Text style={s.section}>Photos flagged as wrong ({reports.length})</Text>
            {reports.map((r) => (
              <View key={r.id} style={s.card}>
                <Image source={{ uri: r.photoUrl }} style={s.shot} resizeMode="cover" />
                <View style={s.pad}>
                  <Text style={s.reason}>{REASON_LABEL[r.reason] ?? r.reason}</Text>
                  {!!r.detail && <Text style={s.body}>{r.detail}</Text>}
                  <Text style={s.meta}>{r.hutId}</Text>
                  <Pressable
                    style={[s.button, busy === r.id && s.buttonOff]}
                    disabled={busy === r.id}
                    onPress={() => act(r.id, () => resolveReport(r.id), () =>
                      setReports((x) => x.filter((y) => y.id !== r.id)))}
                  >
                    <Text style={s.buttonText}>Mark as dealt with</Text>
                  </Pressable>
                  <Text style={s.hint}>
                    Removing the photo itself is a change to the app&apos;s own data — note the hut
                    id and take it out at the next release.
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {!!photos.length && (
          <>
            <Text style={s.section}>Photos waiting ({photos.length})</Text>
            {photos.map((p) => (
              <View key={p.id} style={s.card}>
                <Image source={{ uri: p.url }} style={s.shot} resizeMode="cover" />
                <View style={s.pad}>
                  {!!p.caption && <Text style={s.body}>{p.caption}</Text>}
                  <Text style={s.meta}>{p.hutId}</Text>
                  <View style={s.row}>
                    <Pressable
                      style={[s.button, s.no, busy === p.id && s.buttonOff]}
                      disabled={busy === p.id}
                      onPress={() => act(p.id, () => judgePhoto(p.id, false), () =>
                        setPhotos((x) => x.filter((y) => y.id !== p.id)))}
                    >
                      <Ionicons name="close" size={16} color="#fff" />
                      <Text style={s.buttonText}>Reject</Text>
                    </Pressable>
                    <Pressable
                      style={[s.button, busy === p.id && s.buttonOff]}
                      disabled={busy === p.id}
                      onPress={() => act(p.id, () => judgePhoto(p.id, true), () =>
                        setPhotos((x) => x.filter((y) => y.id !== p.id)))}
                    >
                      <Ionicons name="checkmark" size={16} color="#fff" />
                      <Text style={s.buttonText}>Approve</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}

        {!!reviews.length && (
          <>
            <Text style={s.section}>Reviews waiting ({reviews.length})</Text>
            {reviews.map((r) => (
              <View key={r.id} style={[s.card, s.pad]}>
                <View style={s.stars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Ionicons
                      key={n}
                      name={n <= r.rating ? 'star' : 'star-outline'}
                      size={15}
                      color={n <= r.rating ? COLORS.trail : COLORS.muted}
                    />
                  ))}
                </View>
                {!!r.comment && <Text style={s.body}>{r.comment}</Text>}
                <Text style={s.meta}>{r.hutId}</Text>
                <View style={s.row}>
                  <Pressable
                    style={[s.button, s.no, busy === r.id && s.buttonOff]}
                    disabled={busy === r.id}
                    onPress={() => act(r.id, () => judgeReview(r.id, false), () =>
                      setReviews((x) => x.filter((y) => y.id !== r.id)))}
                  >
                    <Ionicons name="close" size={16} color="#fff" />
                    <Text style={s.buttonText}>Reject</Text>
                  </Pressable>
                  <Pressable
                    style={[s.button, busy === r.id && s.buttonOff]}
                    disabled={busy === r.id}
                    onPress={() => act(r.id, () => judgeReview(r.id, true), () =>
                      setReviews((x) => x.filter((y) => y.id !== r.id)))}
                  >
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={s.buttonText}>Approve</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}

        {!!status && <Text style={s.status}>{status}</Text>}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  page: { padding: 15, paddingBottom: 40, gap: 12, backgroundColor: COLORS.bg, minHeight: '100%' },
  section: { fontSize: 13, fontWeight: '700', color: COLORS.green, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, overflow: 'hidden', ...coloredShadow(COLORS.green, 0.09) },
  pad: { padding: 15, gap: 8 },
  shot: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#e8eeea' },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.ink, padding: 15, paddingBottom: 0 },
  body: { fontSize: 14.5, color: COLORS.ink, lineHeight: 20, paddingHorizontal: 15 },
  reason: { fontSize: 14.5, fontWeight: '700', color: COLORS.danger },
  meta: { fontSize: 12, color: COLORS.muted, fontFamily: undefined },
  hint: { fontSize: 12, color: COLORS.muted, lineHeight: 17, fontStyle: 'italic' },
  uid: { fontSize: 13, color: COLORS.ink, paddingHorizontal: 15, fontWeight: '600' },
  code: { fontSize: 12, color: COLORS.muted, backgroundColor: '#f1f5f2', margin: 15, padding: 11, borderRadius: RADIUS.sm, lineHeight: 18 },
  stars: { flexDirection: 'row', gap: 2 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.green, paddingVertical: 11, borderRadius: RADIUS.sm, marginHorizontal: 15, marginBottom: 15 },
  no: { backgroundColor: COLORS.danger },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  status: { fontSize: 13, color: COLORS.green, textAlign: 'center', paddingVertical: 10 },
});
