/**
 * "Something is wrong with this place" — closed, moved, no longer lodging.
 *
 * ⚠️ THE MOST USEFUL THING IN THIS APP THAT ONLY A PERSON CAN PROVIDE. Every
 * automated check asks whether a record's photograph is right. None can ask
 * whether the building is still there. Gästehaus Ehrenberg is permanently
 * closed and OpenStreetMap — untouched since 2019 — still lists it as a guest
 * house, so the app shows it as somewhere you could stay the night.
 *
 * A wrong photograph is embarrassing. Walking to a closed hut at dusk is not,
 * so this is worth more prominence than the photo report, and gets it: a row on
 * the hut page rather than an icon in a gallery.
 *
 * ⚠️ IT PROMISES NOTHING IMMEDIATE, AND SAYS SO. One report cannot remove a hut
 * — that would let anyone delete places — and the fix has to be made in
 * OpenStreetMap before it sticks. Telling someone "thanks, we'll take it down"
 * would be a lie about both the speed and the mechanism.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { communityEnabled, reportPlace, type PlaceReason } from '../api/community';
import { NEEDS_ACCOUNT } from '../constants/copy';
import { COLORS, RADIUS } from '../constants/theme';

const REASONS: { key: PlaceReason; label: string; hint: string }[] = [
  { key: 'closed', label: 'Permanently closed', hint: 'It is gone, or shut for good' },
  { key: 'no_longer_lodging', label: 'No longer somewhere to stay', hint: 'Still there, but a restaurant, a house, private' },
  { key: 'moved', label: 'In the wrong place on the map', hint: 'The pin is not where the building is' },
  { key: 'photos_wrong', label: 'The photos are wrong', hint: 'They show a different building or place' },
  { key: 'wrong_details', label: 'Details are wrong', hint: 'Name, phone number, or what it offers' },
  { key: 'other', label: 'Something else', hint: '' },
];

export default function ReportPlace({ hutId, hutName }: { hutId: string; hutName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PlaceReason | null>(null);
  const [detail, setDetail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  if (!communityEnabled) return null;

  const close = () => {
    setOpen(false);
    setReason(null);
    setDetail('');
    setMessage('');
  };

  const send = async () => {
    if (!reason) return;
    setSending(true);
    const outcome = await reportPlace(hutId, reason, detail);
    setSending(false);
    if (outcome === 'ok' || outcome === 'already') {
      setMessage(
        outcome === 'already'
          ? 'You have already told us about this one — thank you.'
          : 'Thank you. This gets checked and, where it is right, corrected in OpenStreetMap so every map fixes itself.',
      );
      setTimeout(close, 2600);
      return;
    }
    setMessage(
      outcome === 'needs_account'
        ? NEEDS_ACCOUNT
        : outcome === 'offline'
          ? 'No connection — this needs signal.'
          : 'That did not send. Please try again.',
    );
  };

  return (
    <>
      <Pressable style={s.row} onPress={() => setOpen(true)}>
        <Ionicons name="alert-circle-outline" size={17} color={COLORS.trail} />
        <View style={s.rowText}>
          <Text style={s.rowLabel}>Closed, or something wrong here?</Text>
          <Text style={s.rowHint}>Tell us — hut information goes out of date</Text>
        </View>
        <Ionicons name="chevron-forward" size={15} color={COLORS.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={s.backdrop} onPress={close}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grab} />
            <Text style={s.title}>What is wrong with {hutName}?</Text>

            {REASONS.map((r) => (
              <Pressable
                key={r.key}
                style={[s.reason, reason === r.key && s.reasonOn]}
                onPress={() => setReason(r.key)}
              >
                <Ionicons
                  name={reason === r.key ? 'radio-button-on' : 'radio-button-off'}
                  size={19}
                  color={reason === r.key ? COLORS.green : COLORS.muted}
                />
                <View style={s.reasonText}>
                  <Text style={s.reasonLabel}>{r.label}</Text>
                  {!!r.hint && <Text style={s.reasonHint}>{r.hint}</Text>}
                </View>
              </Pressable>
            ))}

            <TextInput
              style={s.input}
              placeholder="Anything that would help — when you were there, what you found"
              placeholderTextColor={COLORS.muted}
              value={detail}
              onChangeText={setDetail}
              multiline
              maxLength={500}
              editable={!sending}
            />

            <Text style={s.smallprint}>
              This will not remove the hut straight away. It is read by a person, and where it checks out
              the correction is made in OpenStreetMap — which fixes it here and in every other map that
              uses it.
            </Text>

            {!!message && <Text style={s.message}>{message}</Text>}

            <View style={s.actions}>
              <Pressable onPress={close} hitSlop={8} disabled={sending}>
                <Text style={s.cancel}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.send, (!reason || sending) && s.off]} onPress={send} disabled={!reason || sending}>
                <Text style={s.sendText}>{sending ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: '#f2ddc9',
    backgroundColor: COLORS.trailTint,
    marginTop: 12,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14.5, fontWeight: '700', color: COLORS.ink },
  rowHint: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
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
  title: { fontSize: 18, fontWeight: '700', color: COLORS.ink, marginBottom: 2 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 11,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: '#e2e8e4',
  },
  reasonOn: { borderColor: COLORS.green, backgroundColor: COLORS.greenTint },
  reasonText: { flex: 1 },
  reasonLabel: { fontSize: 14.5, fontWeight: '600', color: COLORS.ink },
  reasonHint: { fontSize: 12.5, color: COLORS.muted, marginTop: 1 },
  input: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: '#e2e8e4',
    borderRadius: RADIUS.sm,
    padding: 11,
    fontSize: 14.5,
    color: COLORS.ink,
    textAlignVertical: 'top',
  },
  smallprint: { fontSize: 11.5, color: COLORS.muted, lineHeight: 16 },
  message: { fontSize: 13.5, color: COLORS.green, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 20, marginTop: 4 },
  cancel: { fontSize: 14.5, fontWeight: '600', color: COLORS.muted },
  send: { backgroundColor: COLORS.green, paddingHorizontal: 22, paddingVertical: 11, borderRadius: RADIUS.sm },
  off: { backgroundColor: COLORS.muted },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
});
