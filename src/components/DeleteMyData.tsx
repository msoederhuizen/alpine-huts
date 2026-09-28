/**
 * "Delete everything I have sent" — the control that makes the privacy policy
 * true rather than aspirational.
 *
 * ⚠️ THIS IS NOT OPTIONAL POLISH. Two separate obligations land on it. GDPR
 * Article 17 gives a right to erasure, and consent that cannot be withdrawn was
 * never consent. Apple requires any app offering account creation to offer
 * account deletion IN THE APP — an email address to write to is explicitly not
 * enough, and an anonymous account is still an account.
 *
 * ⚠️ AND A FUNCTION NOBODY CAN REACH DOES NOT COUNT. `deleteMyContent()` existed
 * in the API layer for a while with nothing calling it, which looked finished
 * from the outside and satisfied neither requirement. That is the failure this
 * component exists to close.
 *
 * ⚠️ IT ALSO MUST NOT BE A ONE-TAP MISTAKE. Deletion is irreversible and the
 * moderation queue holds work the person cannot get back, so it asks twice —
 * once to open the choice, once to confirm which of the two things they mean.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { communityEnabled, deleteMyContent } from '../api/community';
import { COLORS, RADIUS } from '../constants/theme';

export default function DeleteMyData() {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  if (!communityEnabled) return null;

  const close = () => {
    setOpen(false);
    setConfirming(false);
    setDone('');
  };

  const run = async () => {
    setBusy(true);
    const ok = await deleteMyContent();
    setBusy(false);
    setDone(
      ok
        ? 'Deleted. Your photographs, reviews and reports have been removed.'
        : 'That did not work — this needs a connection. Please try again with signal.',
    );
    setConfirming(false);
  };

  return (
    <>
      <Pressable style={s.row} onPress={() => setOpen(true)}>
        <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
        <Text style={s.rowText}>Delete everything I have sent</Text>
        <Ionicons name="chevron-forward" size={15} color={COLORS.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={s.backdrop} onPress={close}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grab} />

            {done ? (
              <>
                <Text style={s.title}>{done.startsWith('Deleted') ? 'Done' : 'Not deleted'}</Text>
                <Text style={s.body}>{done}</Text>
                <Pressable style={s.ok} onPress={close}>
                  <Text style={s.okText}>Close</Text>
                </Pressable>
              </>
            ) : confirming ? (
              <>
                <Text style={s.title}>Delete everything?</Text>
                <Text style={s.body}>
                  This removes every photograph, review and report you have sent, including any still
                  waiting to be checked. It cannot be undone.
                </Text>
                <Text style={s.body}>
                  Photos and notes saved only on this phone are not affected — those are yours and stay
                  where they are.
                </Text>
                <View style={s.actions}>
                  <Pressable onPress={() => setConfirming(false)} hitSlop={8} disabled={busy}>
                    <Text style={s.cancel}>Keep them</Text>
                  </Pressable>
                  <Pressable style={[s.danger, busy && s.off]} onPress={run} disabled={busy}>
                    <Text style={s.dangerText}>{busy ? 'Deleting…' : 'Delete everything'}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={s.title}>Your contributions</Text>
                <Text style={s.body}>
                  If you have sent in photographs or reviews, you can remove them. Anything saved only on
                  this phone is untouched.
                </Text>
                <Pressable style={s.choice} onPress={() => setConfirming(true)}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                  <View style={s.choiceText}>
                    <Text style={s.choiceLabel}>Delete everything I have sent</Text>
                    <Text style={s.choiceHint}>
                      Photographs, reviews and reports — permanently
                    </Text>
                  </View>
                </Pressable>
                <Text style={s.smallprint}>
                  Deleting also withdraws your consent for us to hold it. You can start contributing again
                  at any time.
                </Text>
                <Pressable onPress={close} style={s.ok}>
                  <Text style={s.okText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 15 },
  rowText: { flex: 1, fontSize: 14.5, color: COLORS.danger, fontWeight: '600' },
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
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: '#f0d8d4',
    backgroundColor: '#fdf4f3',
  },
  choiceText: { flex: 1 },
  choiceLabel: { fontSize: 14.5, fontWeight: '600', color: COLORS.ink },
  choiceHint: { fontSize: 12.5, color: COLORS.muted, marginTop: 1 },
  smallprint: { fontSize: 12, color: COLORS.muted, lineHeight: 17 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 20, marginTop: 6 },
  cancel: { fontSize: 14.5, fontWeight: '600', color: COLORS.green },
  danger: { backgroundColor: COLORS.danger, paddingHorizontal: 20, paddingVertical: 11, borderRadius: RADIUS.sm },
  dangerText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  off: { opacity: 0.5 },
  ok: { alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 10 },
  okText: { fontSize: 14.5, fontWeight: '600', color: COLORS.green },
});
