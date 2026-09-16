import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, RADIUS } from '../constants/theme';
import {
  SAC_SCALE_COLOR,
  SAC_SCALE_DIFFICULTY,
  SAC_SCALE_GRADE,
  SAC_SCALE_MEANING,
  SAC_SCALE_ORDER,
  type SacScale,
} from '../utils/sacScale';

/**
 * A small ⓘ that opens the full T1–T6 explanation.
 *
 * Wherever a grade is shown it is shown as "T4" or "Difficult", which means
 * nothing on its own — and unlike most jargon in this app, misreading it means
 * misjudging terrain. So every place that prints a grade gets this next to it,
 * from one component, so the wording can never drift between screens.
 *
 * `highlight` marks the grade the surrounding screen is talking about, so the
 * sheet opens with that row picked out rather than making you find it.
 */
export function SacInfoButton({
  highlight,
  size = 16,
  color = COLORS.muted,
  style,
}: {
  highlight?: SacScale;
  size?: number;
  color?: string;
  style?: object;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        // Generous hit area: the icon is deliberately small so it doesn't
        // compete with the badge, which would make it hard to hit accurately.
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="What do the T1 to T6 grades mean?"
        style={style}
      >
        <Ionicons name="information-circle-outline" size={size} color={color} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* ⚠️ The backdrop is a SIBLING behind the sheet, not its parent.
            Wrapping the sheet in a Pressable (to swallow taps so it didn't close
            underneath) meant that Pressable also claimed the touch responder on
            press-in — so a drag inside the sheet never reached the ScrollView and
            the list would not scroll at all. An absolutely-positioned backdrop
            gives the same tap-to-close without ever competing for the gesture. */}
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close"
          />
          <View
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          >
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Trail difficulty</Text>
                {/* ⚠️ NOT "the Swiss scale, used on signs across the Alps",
                    which this said first and is wrong twice over. It is Swiss in
                    ORIGIN but applied everywhere — measured across 129 routed
                    legs, grades came back on 100% of legs in Italy, France,
                    Slovenia and Spain, and 87–92% in Switzerland, Austria and
                    Germany. And the T-numbers are rarely on the signs
                    themselves: countries mark trails with their own colours. */}
                <Text style={styles.sub}>
                  A grading used on mountain paths across Europe. It began with
                  the Swiss Alpine Club, hence the T.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                hitSlop={12}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={COLORS.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.list}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {SAC_SCALE_ORDER.map((s) => {
                const on = s === highlight;
                return (
                  <View key={s} style={[styles.row, on && styles.rowOn]}>
                    <View
                      style={[styles.badge, { backgroundColor: SAC_SCALE_COLOR[s] }]}
                    >
                      <Text style={styles.badgeText}>{SAC_SCALE_GRADE[s]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        {SAC_SCALE_DIFFICULTY[s]}
                        {on && <Text style={styles.thisLeg}>  · this leg</Text>}
                      </Text>
                      <Text style={styles.rowBody}>{SAC_SCALE_MEANING[s]}</Text>
                    </View>
                  </View>
                );
              })}
              {/* ⚠️ Say where the grade comes from. It is read from OSM tags, so
                  an untagged trail shows no badge at all — which must not be
                  read as "easy". */}
              <Text style={styles.footnote}>
                Grades come from OpenStreetMap and cover the hardest stretch of a
                day. A day with no grade shown simply isn’t tagged — it doesn’t
                mean it’s easy.
              </Text>
              {/* Practical: the walker will be reading paint on rocks, not T-
                  numbers. Switzerland's colours are named because they map to
                  these grades directly; other countries are flagged as differing
                  rather than half-listed. */}
              <Text style={styles.footnote}>
                Signs on the ground rarely show the T-number. In Switzerland,
                yellow means T1, red-and-white T2–T3, and blue T4 and above.
                Italy, Austria and France use their own markings.
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,25,20,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    paddingTop: 18,
    maxHeight: '85%',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.ink },
  sub: { fontSize: 13, color: COLORS.muted, marginTop: 3 },
  // ⚠️ `flexShrink: 1` is what makes this scroll. The sheet is sized by its
  // CONTENT up to `maxHeight`, and a ScrollView with no flex constraint lays out
  // at its full content height — so with six grades it overflowed the sheet and
  // was simply clipped: T6 existed but could not be reached. Shrinking it to the
  // space actually available is what gives it something to scroll within.
  // (`flex: 1` would not do: there is no fixed height to take a share of.)
  list: { flexShrink: 1, paddingHorizontal: 20 },
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: RADIUS.md,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  rowOn: { borderColor: COLORS.green, backgroundColor: COLORS.greenTint },
  badge: {
    width: 40,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: 'white', fontWeight: '800', fontSize: 13 },
  rowTitle: { fontSize: 15, fontWeight: '800', color: COLORS.ink },
  thisLeg: { fontSize: 12, fontWeight: '700', color: COLORS.green },
  rowBody: { fontSize: 13, color: COLORS.muted, marginTop: 3, lineHeight: 18 },
  footnote: {
    fontSize: 12.5,
    color: COLORS.muted,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 8,
  },
});
