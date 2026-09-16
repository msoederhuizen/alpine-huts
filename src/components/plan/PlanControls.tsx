/**
 * The Plan screen's small, self-contained controls: one stat in an alternative
 * route's card, a settings-style toggle row, a numeric field, and a min/max
 * range control.
 *
 * Moved out of `app/(tabs)/plan.tsx` verbatim. Each is presentational — props in,
 * markup out, no state of its own — so they were simply padding out a 2100-line
 * screen file. `label` and `input` come from `formStyles` because the screen
 * itself still uses `label` for its own headings.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { COLORS } from '../../constants/theme';
import { RangeSlider } from '../RangeSlider';
import { formStyles } from './formStyles';

export function OptionStat({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.optionStat}>
      <Ionicons name={icon} size={16} color="#2f6f4f" />
      <Text style={styles.optionStatValue}>{value}</Text>
      <Text style={styles.optionStatLabel}>{label}</Text>
    </View>
  );
}

/** A settings-style row: icon + title + hint on the left, a sliding toggle
 *  switch (the "schuif hendel") on the right. */
export function OptionToggle({
  icon,
  title,
  hint,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.optRow}
      activeOpacity={0.7}
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={[styles.optIconWrap, value && styles.optIconWrapOn]}>
        <Ionicons name={icon} size={19} color={value ? '#2f6f4f' : '#9aa0a6'} />
      </View>
      <View style={styles.optText}>
        <Text style={styles.optTitle}>{title}</Text>
        <Text style={styles.optHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#d9d9d9', true: '#2f6f4f' }}
        thumbColor="#ffffff"
        ios_backgroundColor="#d9d9d9"
        // Keep the switch aligned with the title, not floating mid-hint.
        style={styles.optSwitch}
      />
    </TouchableOpacity>
  );
}

export function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <Text style={formStyles.label}>{label}</Text>
      <TextInput
        style={formStyles.input}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        returnKeyType="done"
      />
    </>
  );
}

export function RangeControl({
  label,
  lo,
  hi,
  step,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  lo: number;
  hi: number;
  step: number;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
}) {
  // Feed the slider clamped numbers; fall back to a bound while a field is empty.
  const toNum = (s: string, fallback: number) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  return (
    <>
      <Text style={formStyles.label}>{label}</Text>
      {/* Values sit ABOVE the bar: dragging the thumbs puts your hand over
          everything below them, which hid the numbers you're setting. */}
      <View style={styles.rangeRow}>
        <TextInput
          style={[formStyles.input, styles.rangeInput]}
          value={min}
          onChangeText={onMin}
          keyboardType="numeric"
          returnKeyType="done"
          placeholder="min"
          placeholderTextColor="#bbb"
        />
        <Text style={styles.rangeDash}>to</Text>
        <TextInput
          style={[formStyles.input, styles.rangeInput]}
          value={max}
          onChangeText={onMax}
          keyboardType="numeric"
          returnKeyType="done"
          placeholder="max"
          placeholderTextColor="#bbb"
        />
      </View>
      <View style={styles.sliderBelow}>
        <RangeSlider
          lo={lo}
          hi={hi}
          step={step}
          min={toNum(min, lo)}
          max={toNum(max, hi)}
          color="#2f6f4f"
          onChange={(a, b) => {
            onMin(String(a));
            onMax(String(b));
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  optionStat: { alignItems: 'center', flex: 1, gap: 2 },
  optionStatValue: { fontSize: 14, fontWeight: '800', color: COLORS.ink },
  optionStatLabel: { fontSize: 10, color: COLORS.muted },
  optRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
  },
  optIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#f0f3f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optIconWrapOn: { backgroundColor: COLORS.greenTint },
  optText: { flex: 1, paddingTop: 1 },
  optTitle: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  optHint: { fontSize: 12, color: COLORS.muted, marginTop: 3, lineHeight: 17 },
  // Nudge the switch to sit next to the title rather than centre of the block.
  optSwitch: { marginTop: 2 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rangeInput: { flex: 1 },
  rangeDash: { color: COLORS.muted, fontSize: 13 },
  sliderBelow: { marginTop: 8 },
});
