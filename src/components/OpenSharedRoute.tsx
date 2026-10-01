/**
 * "Somebody sent me a code."
 *
 * ⚠️ RECEIVING A ROUTE ASKS FOR NOTHING. No account, no sign-up, no email — the
 * app makes a session by itself and the code does the rest. Sharing is the half
 * that needs an account, because a shared route can be revoked and corrected;
 * being handed one is just reading, and putting a sign-up form in front of
 * "open my friend's walk" is how a shared walk goes unopened.
 *
 * ⚠️ WHAT ARRIVES IS A COPY, NOT A SUBSCRIPTION. It is saved as an ordinary trip
 * of your own: renameable, deletable, and unaffected if the sharer later stops
 * sharing. See `addTrip` in savedTripsStore.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { communityEnabled } from '../api/community';
import { COLORS, RADIUS } from '../constants/theme';
import { IMPORT_SAYS, importSharedRoute } from '../utils/importShare';

/** The alphabet the server mints codes from — no 0, O, 1 or I to mistype. */
const CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/;

export default function OpenSharedRoute({
  visible,
  initialCode = '',
  onClose,
}: {
  visible: boolean;
  initialCode?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState<{ id: string; name: string; huts: number } | null>(null);

  // A code that arrived in a link is already typed; re-seed if it changes.
  useEffect(() => { setCode(initialCode.toUpperCase()); }, [initialCode]);

  if (!communityEnabled) return null;

  const close = () => {
    setBusy(false);
    setMessage('');
    setDone(null);
    onClose();
  };

  const open = async () => {
    setBusy(true);
    setMessage('');
    const result = await importSharedRoute(code);
    setBusy(false);
    if (result.ok) {
      setDone({ id: result.id, name: result.name, huts: result.huts });
      return;
    }
    setMessage(IMPORT_SAYS[result.why]);
  };

  const ready = CODE_RE.test(code.trim().toUpperCase());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.grab} />

          {done ? (
            <>
              <Text style={s.title}>Saved</Text>
              <Text style={s.body}>
                “{done.name}” — {done.huts} {done.huts === 1 ? 'stop' : 'stops'} — is in your saved
                trips. It is yours now: rename it, change it, or share it on again.
              </Text>
              <View style={s.actions}>
                <Pressable onPress={close} hitSlop={8}>
                  <Text style={s.cancel}>Close</Text>
                </Pressable>
                <Pressable
                  style={s.primary}
                  onPress={() => { close(); router.navigate('/saved'); }}
                >
                  <Text style={s.primaryText}>Open it</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={s.title}>Open a shared route</Text>
              <Text style={s.body}>
                Enter the eight-character code somebody sent you. The route is saved to this phone as
                a trip of your own.
              </Text>
              <TextInput
                style={s.input}
                placeholder="ABCD2345"
                placeholderTextColor="#c3cdc6"
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={8}
                editable={!busy}
              />
              {!!message && <Text style={s.error}>{message}</Text>}
              <View style={s.actions}>
                <Pressable onPress={close} hitSlop={8} disabled={busy}>
                  <Text style={s.cancel}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[s.primary, (!ready || busy) && s.off]}
                  onPress={open}
                  disabled={!ready || busy}
                >
                  <Ionicons name="download-outline" size={17} color="#fff" />
                  <Text style={s.primaryText}>{busy ? 'Opening…' : 'Open'}</Text>
                </Pressable>
              </View>
            </>
          )}
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
    gap: 11,
  },
  grab: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#dde5e0', alignSelf: 'center', marginBottom: 6 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.ink },
  body: { fontSize: 14, color: COLORS.muted, lineHeight: 20 },
  input: {
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 5,
    textAlign: 'center',
    color: COLORS.greenDeep,
  },
  error: { fontSize: 13, color: COLORS.danger, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 20, marginTop: 4 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.green,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: RADIUS.sm,
  },
  off: { backgroundColor: COLORS.muted },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  cancel: { fontSize: 14.5, fontWeight: '600', color: COLORS.muted },
});
