/**
 * "There is a hut here and you do not have it."
 *
 * ⚠️ OPENED BY LONG-PRESSING THE MAP, AND THAT IS THE WHOLE DESIGN. Name, type
 * and photo are all easy to supply; the POSITION is the part a person cannot
 * type. Asking for coordinates, or for an address a mountain hut does not have,
 * would lose most reports before they started — so the gesture that starts the
 * report is the one that also answers the hard question.
 *
 * ⚠️ IT EXISTS BECAUSE THE DATA PROVABLY HAS HOLES. Cross-checking outside lists
 * found 87 huts OpenStreetMap had and this app did not, plus 45 that OSM itself
 * lacks — and that only works where somebody has published a list. A walker
 * standing in front of an unlisted hut covers the places no list reaches.
 *
 * ⚠️ AND IT PROMISES NOTHING IMMEDIATE, because it cannot. A report does not put
 * a pin on the map: that would let anyone add places. It is read by a person
 * and, where it checks out, added to OpenStreetMap so it arrives on the next
 * data build and fixes every other map too.
 */
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { communityEnabled, reportMissingPlace, type MissingKind } from '../api/community';
import { regionForPoint } from '../constants/region';
import { NEEDS_ACCOUNT } from '../constants/copy';
import { COLORS, RADIUS } from '../constants/theme';

/**
 * ⚠️ "Not sure" IS FIRST AND IS THE DEFAULT. Somebody who walked past a hut
 * should not have to know the difference between a wilderness hut and a
 * shelter to tell us it exists — a moderator can classify it from the photo,
 * and a forced guess is worse than an honest blank.
 */
const KINDS: { key: MissingKind; label: string }[] = [
  { key: 'unknown', label: 'Not sure' },
  { key: 'alpine_hut', label: 'Alpine hut' },
  { key: 'wilderness_hut', label: 'Wilderness hut' },
  { key: 'shelter', label: 'Bivouac / shelter' },
  { key: 'guesthouse', label: 'Guesthouse' },
];

export interface MissingHutSpot {
  lat: number;
  lon: number;
}

export default function ReportMissingHut({
  spot,
  onClose,
  /**
   * Where the point came from, because the sentence under it has to be true.
   * A pressed point can be moved by pressing again; a position fix cannot, and
   * telling somebody standing at a hut to "press again" would be nonsense.
   */
  origin = 'map',
}: {
  spot: MissingHutSpot | null;
  onClose: () => void;
  origin?: 'map' | 'here';
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MissingKind>('unknown');
  const [detail, setDetail] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  if (!communityEnabled || !spot) return null;

  const region = regionForPoint(spot.lat, spot.lon);

  const close = () => {
    setName('');
    setKind('unknown');
    setDetail('');
    setUri(null);
    setMessage('');
    onClose();
  };

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    const picked = result.assets?.[0]?.uri;
    if (picked) { setUri(picked); setMessage(''); }
  };

  const send = async () => {
    if (name.trim().length < 2) return;
    setSending(true);
    const outcome = await reportMissingPlace({
      name,
      lat: spot.lat,
      lon: spot.lon,
      regionId: region?.id ?? null,
      kind,
      detail,
      photoUri: uri ?? undefined,
    });
    setSending(false);
    if (outcome === 'ok') {
      setMessage('Thank you. A person reads this, and where it checks out the hut is added to OpenStreetMap — which puts it here and on every other map.');
      setTimeout(close, 3200);
      return;
    }
    setMessage(
      outcome === 'needs_account' ? NEEDS_ACCOUNT
      : outcome === 'offline' ? 'No connection — this needs signal.'
      : outcome === 'too_big' ? 'That photo is too large. Try another.'
      : outcome === 'unsupported' ? 'Only JPEG photos can be sent, because that is the format whose location data we can strip.'
      : 'That did not send. Please try again.',
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.grab} />
          <Text style={s.title}>Report a hut that is missing</Text>

          <View style={s.spot}>
            <Ionicons name="location-outline" size={16} color={COLORS.green} />
            <Text style={s.spotText}>
              {spot.lat.toFixed(5)}, {spot.lon.toFixed(5)}
              {region ? ` · ${region.name}` : ' · outside the regions this app covers'}
            </Text>
          </View>
          <Text style={s.hint}>
            {origin === 'here'
              ? 'That is where you are now. If the hut is some way off, close this and press and hold its spot on the map instead.'
              : 'That is where you pressed. Close this and press again to move it.'}
          </Text>

          <TextInput
            style={s.input}
            placeholder="What is it called?"
            placeholderTextColor={COLORS.muted}
            value={name}
            onChangeText={setName}
            maxLength={120}
            editable={!sending}
          />

          <View style={s.kinds}>
            {KINDS.map((k) => (
              <Pressable
                key={k.key}
                style={[s.kind, kind === k.key && s.kindOn]}
                onPress={() => setKind(k.key)}
                disabled={sending}
              >
                <Text style={[s.kindText, kind === k.key && s.kindTextOn]}>{k.label}</Text>
              </Pressable>
            ))}
          </View>

          {uri ? (
            <View style={s.preview}>
              <Image source={{ uri }} style={s.thumb} />
              <Pressable onPress={() => setUri(null)} hitSlop={8} disabled={sending}>
                <Text style={s.remove}>Remove photo</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.photoRow}>
              <Pressable style={s.photoBtn} onPress={() => pick(true)} disabled={sending}>
                <Ionicons name="camera-outline" size={17} color={COLORS.green} />
                <Text style={s.photoText}>Take a photo</Text>
              </Pressable>
              <Pressable style={s.photoBtn} onPress={() => pick(false)} disabled={sending}>
                <Ionicons name="image-outline" size={17} color={COLORS.green} />
                <Text style={s.photoText}>Choose one</Text>
              </Pressable>
            </View>
          )}

          <TextInput
            style={[s.input, s.multiline]}
            placeholder="Anything that helps — is it staffed, can you sleep there, how do you reach it"
            placeholderTextColor={COLORS.muted}
            value={detail}
            onChangeText={setDetail}
            multiline
            maxLength={500}
            editable={!sending}
          />

          <Text style={s.smallprint}>
            A photo is optional and helps a lot. If you send one, the location stored inside it is
            removed on this phone before it is sent — only the single point above is shared.
          </Text>

          {!!message && <Text style={s.message}>{message}</Text>}

          <View style={s.actions}>
            <Pressable onPress={close} hitSlop={8} disabled={sending}>
              <Text style={s.cancel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.send, (name.trim().length < 2 || sending) && s.off]}
              onPress={send}
              disabled={name.trim().length < 2 || sending}
            >
              <Text style={s.sendText}>{sending ? 'Sending…' : 'Send'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 20,
    paddingBottom: 34,
    gap: 10,
  },
  grab: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#dde5e0', alignSelf: 'center', marginBottom: 6 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.ink },
  spot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 11,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.greenTint,
  },
  spotText: { flex: 1, fontSize: 13.5, color: COLORS.ink, fontWeight: '600' },
  hint: { fontSize: 11.5, color: COLORS.muted, marginTop: -4 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8e4',
    borderRadius: RADIUS.sm,
    padding: 11,
    fontSize: 14.5,
    color: COLORS.ink,
  },
  multiline: { minHeight: 58, textAlignVertical: 'top' },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  kind: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8e4',
  },
  kindOn: { borderColor: COLORS.green, backgroundColor: COLORS.greenTint },
  kindText: { fontSize: 13, color: COLORS.muted, fontWeight: '600' },
  kindTextOn: { color: COLORS.green },
  photoRow: { flexDirection: 'row', gap: 9 },
  photoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: '#e2e8e4',
  },
  photoText: { fontSize: 13.5, fontWeight: '600', color: COLORS.green },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 72, height: 72, borderRadius: RADIUS.sm, backgroundColor: '#eee' },
  remove: { fontSize: 13.5, fontWeight: '600', color: COLORS.muted },
  smallprint: { fontSize: 11.5, color: COLORS.muted, lineHeight: 16 },
  message: { fontSize: 13.5, color: COLORS.green, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 20, marginTop: 4 },
  cancel: { fontSize: 14.5, fontWeight: '600', color: COLORS.muted },
  send: { backgroundColor: COLORS.green, paddingHorizontal: 22, paddingVertical: 11, borderRadius: RADIUS.sm },
  off: { backgroundColor: COLORS.muted },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
});
