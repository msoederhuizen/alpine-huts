/**
 * Star rating and written reviews for one hut.
 *
 * ⚠️ THIS RENDERS TEXT WRITTEN BY STRANGERS. Every comment goes through
 * <Text>, which draws it as characters and never interprets it — there is no
 * markup path here and there must not be one. The rows it reads have already
 * been through moderation, but "already approved" is not a reason to relax
 * how they are drawn.
 *
 * ⚠️ AND IT MUST DISAPPEAR QUIETLY WHEN THERE IS NO SIGNAL. Someone reading a
 * hut page three hours up a valley is the normal case, not the edge case. With
 * no backend the component renders the invitation to review and nothing else —
 * no spinner that never resolves, no error card, no retry button.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  communityEnabled,
  deleteMyReview,
  ratingFor,
  reviewsFor,
  submitReview,
  type Rating,
  type Review,
} from '../api/community';
import { NEEDS_ACCOUNT } from '../constants/copy';
import { COLORS, RADIUS, coloredShadow } from '../constants/theme';

const STARS = [1, 2, 3, 4, 5] as const;

function Stars({
  value,
  size = 18,
  onPick,
}: {
  value: number;
  size?: number;
  onPick?: (n: number) => void;
}) {
  return (
    <View style={s.stars}>
      {STARS.map((n) => {
        const filled = n <= Math.round(value);
        const star = (
          <Ionicons
            key={n}
            name={filled ? 'star' : 'star-outline'}
            size={size}
            color={filled ? COLORS.trail : COLORS.muted}
          />
        );
        if (!onPick) return star;
        return (
          <Pressable
            key={n}
            onPress={() => onPick(n)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
          >
            {star}
          </Pressable>
        );
      })}
    </View>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

export default function HutReviews({ hutId }: { hutId: string }) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState<Review | null>(null);
  const [draftStars, setDraftStars] = useState(0);
  const [draftText, setDraftText] = useState('');
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [r, list] = await Promise.all([ratingFor(hutId), reviewsFor(hutId)]);
    setRating(r);
    setReviews(list.filter((x) => !x.mine));
    const own = list.find((x) => x.mine) ?? null;
    setMine(own);
    if (own) {
      setDraftStars(own.rating);
      setDraftText(own.comment ?? '');
    }
    setLoading(false);
  }, [hutId]);

  useEffect(() => {
    if (!communityEnabled) { setLoading(false); return; }
    load();
  }, [load]);

  const send = async () => {
    if (draftStars < 1) { setMessage('Pick a rating first.'); return; }
    setSending(true);
    setMessage('');
    const outcome = await submitReview(hutId, draftStars, draftText);
    setSending(false);
    if (outcome === 'ok') {
      setEditing(false);
      setMessage('Thank you — it will appear once it has been checked.');
      load();
    } else {
      setMessage(
        outcome === 'needs_account'
          ? NEEDS_ACCOUNT
          : outcome === 'offline'
            ? 'No connection. Reviews need signal — try again back in the valley.'
            : 'That did not send. Please try again.',
      );
    }
  };

  const remove = async () => {
    setSending(true);
    const ok = await deleteMyReview(hutId);
    setSending(false);
    if (ok) {
      setMine(null);
      setDraftStars(0);
      setDraftText('');
      setMessage('Removed.');
      load();
    }
  };

  if (!communityEnabled) return null;

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>Reviews</Text>
        {rating && rating.count > 0 ? (
          <View style={s.summary}>
            <Stars value={rating.average} />
            <Text style={s.average}>
              {rating.average.toFixed(1)}
              <Text style={s.count}>  ({rating.count})</Text>
            </Text>
          </View>
        ) : (
          !loading && <Text style={s.none}>No reviews yet</Text>
        )}
      </View>

      {loading && <ActivityIndicator style={s.spinner} color={COLORS.green} />}

      {/* Your own review, whatever its status — so a pending one is visible to
          its author rather than seeming to have vanished. */}
      {mine && !editing && (
        <View style={[s.review, s.own]}>
          <View style={s.reviewHead}>
            <Stars value={mine.rating} size={15} />
            <Text style={s.yours}>Yours</Text>
            {mine.status === 'pending' && <Text style={s.pending}>waiting to be checked</Text>}
            {mine.status === 'rejected' && <Text style={s.rejected}>not published</Text>}
          </View>
          {!!mine.comment && <Text style={s.body}>{mine.comment}</Text>}
          <View style={s.ownActions}>
            <Pressable onPress={() => setEditing(true)} hitSlop={8}>
              <Text style={s.action}>Edit</Text>
            </Pressable>
            <Pressable onPress={remove} hitSlop={8} disabled={sending}>
              <Text style={[s.action, s.danger]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      )}

      {(!mine || editing) && (
        <View style={s.composer}>
          <Text style={s.prompt}>{mine ? 'Change your review' : 'Been here? Leave a review'}</Text>
          <Stars value={draftStars} size={28} onPick={setDraftStars} />
          <TextInput
            style={s.input}
            placeholder="What was it like? (optional)"
            placeholderTextColor={COLORS.muted}
            value={draftText}
            onChangeText={setDraftText}
            multiline
            maxLength={2000}
            editable={!sending}
          />
          <View style={s.composerActions}>
            {editing && (
              <Pressable onPress={() => setEditing(false)} hitSlop={8}>
                <Text style={s.action}>Cancel</Text>
              </Pressable>
            )}
            <Pressable
              style={[s.send, (sending || draftStars < 1) && s.sendOff]}
              onPress={send}
              disabled={sending || draftStars < 1}
            >
              <Text style={s.sendText}>{sending ? 'Sending…' : 'Send'}</Text>
            </Pressable>
          </View>
          <Text style={s.smallprint}>
            Reviews are checked before they appear. Nothing else about you is stored.
          </Text>
        </View>
      )}

      {!!message && <Text style={s.message}>{message}</Text>}

      {reviews.map((r) => (
        <View key={r.id} style={s.review}>
          <View style={s.reviewHead}>
            <Stars value={r.rating} size={15} />
            <Text style={s.date}>{when(r.createdAt)}</Text>
          </View>
          {!!r.comment && <Text style={s.body}>{r.comment}</Text>}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    marginTop: 14,
    overflow: 'hidden',
    ...coloredShadow(COLORS.green, 0.09),
  },
  head: { padding: 15, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.ink },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stars: { flexDirection: 'row', gap: 2 },
  average: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  count: { fontSize: 13, fontWeight: '500', color: COLORS.muted },
  none: { fontSize: 13.5, color: COLORS.muted },
  spinner: { marginBottom: 14 },
  composer: {
    padding: 15,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8e4',
  },
  prompt: { fontSize: 14.5, fontWeight: '600', color: COLORS.ink },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: '#e2e8e4',
    borderRadius: RADIUS.sm,
    padding: 11,
    fontSize: 14.5,
    color: COLORS.ink,
    textAlignVertical: 'top',
  },
  composerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 18 },
  send: {
    backgroundColor: COLORS.green,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: RADIUS.sm,
  },
  sendOff: { backgroundColor: COLORS.muted },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  smallprint: { fontSize: 11.5, color: COLORS.muted, lineHeight: 16 },
  message: { paddingHorizontal: 15, paddingBottom: 12, fontSize: 13, color: COLORS.green },
  review: {
    padding: 15,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8e4',
  },
  own: { backgroundColor: COLORS.greenTint },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  yours: { fontSize: 12, fontWeight: '700', color: COLORS.green },
  pending: { fontSize: 11.5, color: COLORS.trail, fontStyle: 'italic' },
  rejected: { fontSize: 11.5, color: COLORS.danger, fontStyle: 'italic' },
  date: { fontSize: 12, color: COLORS.muted, marginLeft: 'auto' },
  body: { fontSize: 14.5, color: COLORS.ink, lineHeight: 20 },
  ownActions: { flexDirection: 'row', gap: 18, marginTop: 4 },
  action: { fontSize: 13.5, fontWeight: '600', color: COLORS.green },
  danger: { color: COLORS.danger },
});
