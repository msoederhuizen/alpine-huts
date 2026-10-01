/**
 * "Here is the walk I planned — open it on your phone."
 *
 * ⚠️ A CODE, NOT A LINK, IS THE THING THAT IS SHARED. A link is nicer when the
 * other person already has the app and worse in every other case: it opens a
 * dead URL in a browser and the walk is lost. The code is readable aloud, works
 * in any message, and the share text carries the link as well for the people it
 * does help. The alphabet has no 0, O, 1 or I in it for the same reason.
 *
 * ⚠️ SHARING NEEDS AN ACCOUNT AND LOADING ONE DOES NOT. A shared route can be
 * revoked, corrected and asked about, which an id that dies with the phone
 * cannot support. Whoever receives it needs nothing.
 *
 * ⚠️ AND IT CAN BE TAKEN BACK. "Stop sharing" sets a flag the server checks, so
 * a code handed to the wrong person stops working. What is already on somebody
 * else's phone is theirs and stays — this is a route, not a licence.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { communityEnabled, shareRoute, stopSharing } from '../api/community';
import { useSavedTripsStore, type SavedTrip } from '../store/savedTripsStore';
import { COLORS, RADIUS } from '../constants/theme';
import { toSharePayload } from '../utils/tripShare';

const LINK = (code: string) => `alpinehuts://r/${code}`;

export default function ShareTrip({
  trip,
  onClose,
}: {
  trip: SavedTrip | null;
  onClose: () => void;
}) {
  const remember = useSavedTripsStore((s) => s.setShareCode);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  if (!communityEnabled || !trip) return null;

  const shown = code ?? trip.shareCode ?? null;

  const close = () => {
    setCode(null);
    setMessage('');
    onClose();
  };

  const share = async () => {
    setBusy(true);
    setMessage('');
    let result = await shareRoute(trip.name, toSharePayload(trip));
    // A week-long trip with full geometry can outgrow what the server accepts.
    // Dropping the drawn line is a far better answer than refusing to share:
    // the other phone routes it itself on first open, exactly as it would for a
    // trip saved before geometry was stored.
    if ('blocked' in result && result.blocked === 'too_big') {
      result = await shareRoute(trip.name, toSharePayload(trip, false));
    }
    setBusy(false);

    if ('code' in result) {
      setCode(result.code);
      remember(trip.id, result.code);
      return;
    }
    setMessage(
      result.blocked === 'needs_account'
        ? 'Sharing a route needs an account — add an email on the Account tab and it only takes a moment. A route somebody can revoke and be asked about is worth more than one that disappears with a phone.'
        : result.blocked === 'offline'
          ? 'No connection — sharing needs signal.'
          : result.blocked === 'too_big'
            ? 'This trip is too large to share. Try splitting it into two.'
            : 'That did not work. Please try again.',
    );
  };

  const send = async () => {
    if (!shown) return;
    await Share.share({
      message:
        `${trip.name} — a hut-to-hut walk I planned.\n\n` +
        `Open it in Alpine Huts with the code ${shown}, ` +
        `on the Account tab under “Open a shared route”.\n${LINK(shown)}`,
    }).catch(() => {});
  };

  const revoke = async () => {
    if (!shown) return;
    setBusy(true);
    const ok = await stopSharing(shown);
    setBusy(false);
    if (!ok) { setMessage('That needs a connection. Please try again with signal.'); return; }
    remember(trip.id, null);
    setCode(null);
    setMessage('Stopped. That code no longer opens anything.');
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.grab} />
          <Text style={s.title}>Share this route</Text>
          <Text style={s.body} numberOfLines={2}>
            {trip.name} · {trip.huts.length} {trip.huts.length === 1 ? 'stop' : 'stops'}
          </Text>

          {shown ? (
            <>
              {/* Tapping the code opens the same share sheet as the button —
                  which is also where "Copy" lives on both platforms, so the app
                  needs no clipboard permission or module of its own. */}
              <Pressable style={s.codeBox} onPress={send}>
                <Text style={s.code} selectable>{shown}</Text>
                <Ionicons name="share-outline" size={18} color={COLORS.green} />
              </Pressable>
              <Text style={s.smallprint}>
                Anyone with this code can open the route and keep their own copy of it. It does not
                show them your email address or anything else about you.
              </Text>
              {!!message && <Text style={s.message}>{message}</Text>}
              <Pressable style={s.primary} onPress={send}>
                <Ionicons name="share-outline" size={17} color="#fff" />
                <Text style={s.primaryText}>Send it</Text>
              </Pressable>
              <View style={s.actions}>
                <Pressable onPress={revoke} disabled={busy} hitSlop={8}>
                  <Text style={s.stop}>{busy ? 'Working…' : 'Stop sharing'}</Text>
                </Pressable>
                <Pressable onPress={close} hitSlop={8}>
                  <Text style={s.cancel}>Done</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={s.smallprint}>
                This puts the route — its huts, its order and the trail between them — where someone
                else can open it with a code. You can stop sharing at any time.
              </Text>
              {!!message && <Text style={s.message}>{message}</Text>}
              <View style={s.actions}>
                <Pressable onPress={close} hitSlop={8} disabled={busy}>
                  <Text style={s.cancel}>Cancel</Text>
                </Pressable>
                <Pressable style={[s.primary, busy && s.off]} onPress={share} disabled={busy}>
                  <Text style={s.primaryText}>{busy ? 'Sharing…' : 'Get a code'}</Text>
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
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 17,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.greenTint,
  },
  code: {
    fontSize: 25,
    fontWeight: '800',
    color: COLORS.greenDeep,
    letterSpacing: 3.5,
    // The characters have to be read off a screen and typed on another phone,
    // so they are spaced and monospaced rather than merely large.
    fontVariant: ['tabular-nums'],
  },
  smallprint: { fontSize: 12, color: COLORS.muted, lineHeight: 17 },
  message: { fontSize: 13.5, color: COLORS.green, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginTop: 4 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.green,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: RADIUS.sm,
  },
  off: { backgroundColor: COLORS.muted },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  cancel: { fontSize: 14.5, fontWeight: '600', color: COLORS.muted },
  stop: { fontSize: 14.5, fontWeight: '600', color: COLORS.danger },
});
