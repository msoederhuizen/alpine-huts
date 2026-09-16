/**
 * The two form primitives the Plan screen and its extracted field controls BOTH
 * use.
 *
 * `label` is the reason this file exists: it is used four times by the screen
 * itself and once each by `NumberField` and `RangeControl`. When those controls
 * moved out of `plan.tsx` the style had to live somewhere both could reach, and
 * a shared definition beats two copies that silently drift apart.
 *
 * ⚠️ `label` carries its own marginTop/marginBottom. Inside an `alignItems:
 * 'center'` row that makes its box 22px taller than its text, which pushes a
 * neighbouring icon visibly above the words — so the screen's `labelRow` owns
 * the spacing there and `labelInRow` zeroes these margins out. Don't "tidy" the
 * margins onto the row: the standalone labels need them.
 */
import { StyleSheet } from 'react-native';

import { COLORS, RADIUS } from '../../constants/theme';

export const formStyles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.muted,
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#e2e8e4',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.ink,
  },
});
