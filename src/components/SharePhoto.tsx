/**
 * "Share a photo of this hut" — always public, never a private save.
 *
 * ⚠️ THIS IS A SEPARATE ACTION FROM ADDING A PHOTO TO YOUR OWN COPY, AND THE
 * WORDING HAS TO CARRY THAT. The app already lets people keep photos on their
 * phone; that stays exactly as it was. This one sends the picture to be checked
 * and then shown to strangers, which is irreversible in the way that matters —
 * you can delete it afterwards, but you cannot un-show it.
 *
 * So there is no "keep private or share?" question anywhere in this flow. A
 * dialog asking which you meant is the failure mode, not the safeguard: people
 * dismiss dialogs. Instead the button says what it does before it is pressed,
 * and the sheet says it again before anything is sent.
 *
 * ⚠️ THE LOCATION IS STRIPPED BEFORE UPLOAD, in submitPhoto(). A phone photo
 * carries where it was taken to within metres; someone sharing a picture of a
 * hut is offering the picture, not a record of where they slept.
 */
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, Image } from 'react-native';

import { communityEnabled, submitPhoto } from '../api/community';
import { COLORS, RADIUS } from '../constants/theme';

export default function SharePhoto({
  hutId,
  hutName,
  /**
   * Opened from the hut screen's existing photo menu rather than from a button
   * of its own.
   *
   * ⚠️ TWO BUTTONS THAT BOTH SAY "ADD A PHOTO" IS A WORSE PROBLEM THAN AN EXTRA
   * TAP. The hero image already offers adding a photo — privately, to your own
   * phone. A second green button underneath, offering something that looks the
   * same but publishes to strangers, is exactly the pair a person picks wrongly
   * when tired. One entry point, two clearly different labels.
   *
   * Increment this to start the flow; the value itself means nothing.
   */
  openRequest,
  hideTrigger = false,
  onShared,
}: {
  hutId: string;
  hutName: string;
  /** Bump `seq` to start the flow; `camera` picks the source. */
  openRequest?: { seq: number; camera: boolean };
  hideTrigger?: boolean;
  /**
   * Called once the photo is accepted for checking, so the hut screen can also
   * keep a copy on the phone.
   *
   * ⚠️ THE LOCAL COPY IS NOT A SECOND FEATURE, IT IS WHAT MAKES SHARING BEARABLE.
   * A shared photo is invisible to everyone — its own author included — until a
   * person has approved it. Without this, adding a photo would appear to do
   * nothing at all for however long moderation takes, which reads as a bug and
   * invites the same photo being sent three more times.
   */
  onShared?: (uri: string) => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  if (!communityEnabled) return null;

  const close = () => {
    setUri(null);
    setCaption('');
    setMessage('');
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

  // Start the picker when the parent bumps the sequence. The first render is
  // skipped, or opening a hut page would launch the photo library by itself.
  const seen = useRef(openRequest?.seq ?? 0);
  useEffect(() => {
    if (!openRequest || openRequest.seq === seen.current) return;
    seen.current = openRequest.seq;
    void pick(openRequest.camera);
  }, [openRequest]);

  const send = async () => {
    if (!uri) return;
    setSending(true);
    const outcome = await submitPhoto(hutId, uri, caption);
    setSending(false);
    if (outcome === 'ok') {
      // Keep a copy on the phone so it shows immediately — see onShared.
      onShared?.(uri);
      setMessage('Added. Others will see it once it has been checked.');
      setTimeout(close, 1800);
      return;
    }
    setMessage(
      outcome === 'offline'
        ? 'No connection — sharing needs signal.'
        : outcome === 'too_big'
          ? 'That photo is too large. Try one under 8 MB.'
          : outcome === 'unsupported'
            ? 'That image format cannot be shared. A JPEG from your camera will work.'
            : 'That did not send. Please try again.',
    );
  };

  return (
    <>
      {!hideTrigger && (
        <Pressable style={s.button} onPress={() => pick(false)} onLongPress={() => pick(true)}>
          <Ionicons name="share-outline" size={17} color={COLORS.green} />
          <View style={s.buttonText}>
            <Text style={s.buttonLabel}>Share a photo with other walkers</Text>
            <Text style={s.buttonHint}>Public once checked · hold to use the camera</Text>
          </View>
        </Pressable>
      )}

      <Modal visible={!!uri} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={s.backdrop} onPress={close}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grab} />
            <Text style={s.title}>Share this with other walkers?</Text>
            <Text style={s.lede}>
              It will be checked first, then shown to anyone looking at {hutName}. You can delete it
              later from About.
            </Text>

            {!!uri && <Image source={{ uri }} style={s.preview} resizeMode="cover" />}

            <TextInput
              style={s.input}
              placeholder="Add a caption (optional)"
              placeholderTextColor={COLORS.muted}
              value={caption}
              onChangeText={setCaption}
              maxLength={280}
              editable={!sending}
            />

            <Text style={s.smallprint}>
              The location tag is removed before the photo leaves your phone. Please only share
              photographs you took yourself.
            </Text>

            {!!message && <Text style={s.message}>{message}</Text>}

            <View style={s.actions}>
              <Pressable onPress={close} hitSlop={8} disabled={sending}>
                <Text style={s.cancel}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.send, sending && s.off]} onPress={send} disabled={sending}>
                <Text style={s.sendText}>{sending ? 'Sending…' : 'Share it'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: '#d9e6de',
    backgroundColor: COLORS.greenTint,
    marginTop: 12,
  },
  buttonText: { flex: 1 },
  buttonLabel: { fontSize: 14.5, fontWeight: '700', color: COLORS.greenDeep },
  buttonHint: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 20,
    paddingBottom: 34,
    gap: 11,
  },
  grab: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#dde5e0', alignSelf: 'center', marginBottom: 6 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.ink },
  lede: { fontSize: 13.5, color: COLORS.muted, lineHeight: 19 },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: RADIUS.sm, backgroundColor: '#e8eeea' },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8e4',
    borderRadius: RADIUS.sm,
    padding: 11,
    fontSize: 14.5,
    color: COLORS.ink,
  },
  smallprint: { fontSize: 11.5, color: COLORS.muted, lineHeight: 16 },
  message: { fontSize: 13.5, color: COLORS.green },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 20, marginTop: 4 },
  cancel: { fontSize: 14.5, fontWeight: '600', color: COLORS.muted },
  send: { backgroundColor: COLORS.green, paddingHorizontal: 22, paddingVertical: 11, borderRadius: RADIUS.sm },
  off: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
});
