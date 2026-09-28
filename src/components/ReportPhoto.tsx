/**
 * "This photo is wrong" — a sheet offering the four reasons that matter.
 *
 * ⚠️ THE PHOTOS MOST LIKELY TO BE WRONG SHIP INSIDE THE APP. Roughly 1,575 were
 * found by matching a name against a web image index, and a human review
 * rejected 46% of the batch they came from. The ones that survived are the ones
 * that LOOK right in a thumbnail — which is exactly what a wrong building does.
 * So this reports by URL rather than by any database id: the bundled photos
 * have no row anywhere, and they are the ones that need reporting most.
 *
 * ⚠️ IT REPORTS, IT DOES NOT HIDE. A tap does not remove the photo for anyone,
 * including the reporter — one person's opinion is not a verdict, and a
 * self-hiding photo would be trivially abusable. It sends a message to the
 * moderator and says so plainly, so nobody taps twice wondering why nothing
 * happened.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { communityEnabled, reportPhoto, type ReportReason } from '../api/community';
import { COLORS, RADIUS } from '../constants/theme';

const REASONS: { key: ReportReason; label: string; hint: string }[] = [
  { key: 'wrong_place', label: 'Wrong building', hint: 'This is somewhere else, not this hut' },
  { key: 'not_a_building', label: 'Not a photo of a place', hint: 'A map, a logo, a menu, a landscape' },
  { key: 'offensive', label: 'Offensive or inappropriate', hint: 'Should not be in the app at all' },
  { key: 'other', label: 'Something else', hint: '' },
];

export default function ReportPhoto({
  hutId,
  photoUrl,
  onDone,
}: {
  hutId: string;
  photoUrl: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
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
    const outcome = await reportPhoto(hutId, photoUrl, reason, detail);
    setSending(false);
    if (outcome === 'ok' || outcome === 'already') {
      setMessage(
        outcome === 'already'
          ? 'You have already reported this one — thank you.'
          : 'Thank you. It will be looked at.',
      );
      setTimeout(() => { close(); onDone?.(); }, 1500);
    } else {
      setMessage(
        outcome === 'offline'
          ? 'No connection — this needs signal.'
          : 'That did not send. Please try again.',
      );
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        style={s.trigger}
        accessibilityRole="button"
        accessibilityLabel="Report this photo as wrong"
      >
        <Ionicons name="flag-outline" size={15} color="#fff" />
        <Text style={s.triggerText}>Wrong photo?</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={s.backdrop} onPress={close}>
          {/* Stop a tap inside the sheet from closing it. */}
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grab} />
            <Text style={s.title}>What is wrong with it?</Text>
            <Text style={s.lede}>
              This sends a note to be checked. The photo stays visible until then — one report is not
              a verdict.
            </Text>

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

            {reason === 'other' && (
              <TextInput
                style={s.input}
                placeholder="What is wrong? (optional)"
                placeholderTextColor={COLORS.muted}
                value={detail}
                onChangeText={setDetail}
                multiline
                maxLength={280}
                editable={!sending}
              />
            )}

            {!!message && <Text style={s.message}>{message}</Text>}

            <View style={s.actions}>
              <Pressable onPress={close} hitSlop={8}>
                <Text style={s.cancel}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.send, (!reason || sending) && s.sendOff]}
                onPress={send}
                disabled={!reason || sending}
              >
                <Text style={s.sendText}>{sending ? 'Sending…' : 'Send report'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trigger: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  triggerText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 20,
    paddingBottom: 34,
    gap: 10,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#dde5e0',
    alignSelf: 'center',
    marginBottom: 6,
  },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.ink },
  lede: { fontSize: 13, color: COLORS.muted, lineHeight: 18, marginBottom: 4 },
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
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#e2e8e4',
    borderRadius: RADIUS.sm,
    padding: 11,
    fontSize: 14.5,
    color: COLORS.ink,
    textAlignVertical: 'top',
  },
  message: { fontSize: 13.5, color: COLORS.green, paddingTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 20, marginTop: 6 },
  cancel: { fontSize: 14.5, fontWeight: '600', color: COLORS.muted },
  send: { backgroundColor: COLORS.green, paddingHorizontal: 20, paddingVertical: 10, borderRadius: RADIUS.sm },
  sendOff: { backgroundColor: COLORS.muted },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
});
