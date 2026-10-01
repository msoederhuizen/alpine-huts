/**
 * An optional email and password, so contributions survive a new phone.
 *
 * ⚠️ OPTIONAL IS THE WHOLE DESIGN. The app still creates an anonymous account by
 * itself the first time somebody sends anything, and that path is untouched:
 * adding one photograph must never put a sign-up form in the way, because that
 * is the surest way to get no photographs. This exists for the person who has
 * contributed enough to mind losing it.
 *
 * ⚠️ IT UPGRADES THE ACCOUNT, IT DOES NOT CREATE A SECOND ONE. Everything a
 * person has sent is keyed to the identifier their device already has, so
 * signing up fresh would strand all of it — the rows would still be there,
 * owned by an id nobody can reach. `addEmailToAccount` converts in place and
 * keeps the id.
 *
 * ⚠️ AND SIGNING OUT IS HIDDEN UNTIL THERE IS AN ADDRESS TO SIGN BACK IN WITH.
 * Signing out of an anonymous account is an unmarked delete — no password, no
 * recovery, and every photo it sent becomes unreachable. The API refuses it
 * too; this just never offers it.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  accountState,
  addEmailToAccount,
  communityEnabled,
  sendPasswordReset,
  signIn,
  signOut,
  type AccountOutcome,
  type AccountState,
} from '../api/community';
import { COLORS, RADIUS } from '../constants/theme';

type Mode = 'idle' | 'add' | 'signin';

const SAYS: Record<AccountOutcome, string> = {
  ok: 'Signed in. Everything that account has sent is yours again.',
  check_email: 'Almost there — open the link we just sent to that address to finish. Until then nothing has changed.',
  offline: 'No connection — this needs signal.',
  bad_email: 'That does not look like an email address.',
  weak_password: 'Use at least 8 characters.',
  wrong_details: 'That email and password do not match an account.',
  taken: 'There is already an account with that address. Sign in instead.',
  failed: 'That did not work. Please try again.',
};

export default function Account() {
  const [state, setState] = useState<AccountState | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => setState(await accountState()), []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!communityEnabled || !state) return null;

  const reset = () => { setMode('idle'); setEmail(''); setPassword(''); setMessage(''); };

  const submit = async () => {
    setBusy(true);
    const outcome = mode === 'add'
      ? await addEmailToAccount(email, password)
      : await signIn(email, password);
    setBusy(false);
    setMessage(SAYS[outcome]);
    if (outcome === 'ok') { await refresh(); setMode('idle'); setEmail(''); setPassword(''); }
    if (outcome === 'check_email') { setPassword(''); await refresh(); }
  };

  const forgot = async () => {
    if (!email.trim()) { setMessage('Enter your email address first.'); return; }
    setBusy(true);
    const r = await sendPasswordReset(email);
    setBusy(false);
    // Deliberately the same answer whether or not the address exists — saying
    // "no such account" would let anyone test which addresses are registered.
    setMessage(r === 'ok'
      ? 'If that address has an account, a reset link is on its way.'
      : SAYS[r === 'offline' ? 'offline' : 'failed']);
  };

  const out = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    await refresh();
    setMessage('Signed out. Sign back in any time with the same address.');
  };

  // ── Signed in with a real address ─────────────────────────────────────────
  if (state.signedIn && !state.anonymous) {
    return (
      <View style={s.wrap}>
        <View style={s.row}>
          <Ionicons name="person-circle-outline" size={19} color={COLORS.green} />
          <View style={s.rowText}>
            <Text style={s.label}>{state.email}</Text>
            <Text style={s.hint}>Your contributions follow this address to any phone.</Text>
          </View>
        </View>
        {!!message && <Text style={s.message}>{message}</Text>}
        <Pressable onPress={out} disabled={busy} hitSlop={8}>
          <Text style={s.linkish}>{busy ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Ionicons name="phone-portrait-outline" size={19} color={COLORS.muted} />
        <View style={s.rowText}>
          <Text style={s.label}>This device only</Text>
          <Text style={s.hint}>
            {state.pendingEmail
              ? `Waiting for you to confirm ${state.pendingEmail} — check your inbox.`
              : 'Anything you send is tied to this phone. Add an email and it comes with you to the next one.'}
          </Text>
        </View>
      </View>

      {mode === 'idle' ? (
        <View style={s.choices}>
          <Pressable style={s.primary} onPress={() => { setMode('add'); setMessage(''); }}>
            <Text style={s.primaryText}>Add an email</Text>
          </Pressable>
          <Pressable onPress={() => { setMode('signin'); setMessage(''); }} hitSlop={8}>
            <Text style={s.linkish}>I already have one</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={s.explain}>
            {mode === 'add'
              ? 'This keeps the contributions you have already made — they move to the address, they are not started again.'
              : 'Signing in replaces what this device has sent with what that account has sent.'}
          </Text>
          <TextInput
            style={s.input}
            placeholder="Email address"
            placeholderTextColor={COLORS.muted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!busy}
          />
          <TextInput
            style={s.input}
            placeholder={mode === 'add' ? 'Choose a password (8+ characters)' : 'Password'}
            placeholderTextColor={COLORS.muted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType={mode === 'add' ? 'newPassword' : 'password'}
            editable={!busy}
          />
          {mode === 'signin' && (
            <Pressable onPress={forgot} disabled={busy} hitSlop={8}>
              <Text style={s.linkish}>I have forgotten my password</Text>
            </Pressable>
          )}
          {!!message && <Text style={s.message}>{message}</Text>}
          <View style={s.actions}>
            <Pressable onPress={reset} disabled={busy} hitSlop={8}>
              <Text style={s.cancel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.primary, (busy || !email.trim() || password.length < 8) && s.off]}
              onPress={submit}
              disabled={busy || !email.trim() || password.length < 8}
            >
              <Text style={s.primaryText}>
                {busy ? 'Working…' : mode === 'add' ? 'Add it' : 'Sign in'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  rowText: { flex: 1 },
  label: { fontSize: 14.5, fontWeight: '700', color: COLORS.ink },
  hint: { fontSize: 12.5, color: COLORS.muted, marginTop: 2, lineHeight: 17 },
  explain: { fontSize: 12.5, color: COLORS.muted, lineHeight: 17 },
  choices: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8e4',
    borderRadius: RADIUS.sm,
    padding: 11,
    fontSize: 14.5,
    color: COLORS.ink,
  },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 18, marginTop: 2 },
  primary: { backgroundColor: COLORS.green, paddingHorizontal: 18, paddingVertical: 10, borderRadius: RADIUS.sm },
  off: { backgroundColor: COLORS.muted },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cancel: { fontSize: 14, fontWeight: '600', color: COLORS.muted },
  linkish: { fontSize: 13.5, fontWeight: '600', color: COLORS.green },
  message: { fontSize: 13, color: COLORS.green, lineHeight: 18 },
});
