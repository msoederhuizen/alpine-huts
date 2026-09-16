import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

interface Props {
  /** Slider bounds. */
  lo: number;
  hi: number;
  /** Snap increment. */
  step: number;
  /** Current values (already clamped to [lo, hi]). */
  min: number;
  max: number;
  color?: string;
  onChange: (min: number, max: number) => void;
}

const R = 13; // thumb radius
const H = 2 * R + 8; // row height

type Pan = ReturnType<typeof PanResponder.create>;

/**
 * A two-thumb range slider built on PanResponder (no native deps, works in Expo
 * Go). Controlled: `min`/`max` come in as props and every drag reports back via
 * `onChange`, so it stays in sync with the text inputs beside it.
 */
export function RangeSlider({
  lo,
  hi,
  step,
  min,
  max,
  color = '#2f6f4f',
  onChange,
}: Props) {
  const [w, setW] = useState(0);
  const span = hi - lo || 1;

  // Live values/width for the gesture closures (created once, below).
  const live = useRef({ min, max, w });
  live.current = { min, max, w };
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const startCx = useRef(0);

  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const snap = (v: number) => Math.round(v / step) * step;
  const usable = (width: number) => Math.max(1, width - 2 * R);
  // Value <-> thumb-centre-x mapping (x is inset by the thumb radius so the
  // thumbs sit flush with the track ends at the extremes).
  const centerOf = (v: number, width: number) =>
    R + ((clamp(v, lo, hi) - lo) / span) * usable(width);
  const valueAt = (cx: number, width: number) =>
    lo + ((cx - R) / usable(width)) * span;

  const pans = useRef<{ min: Pan; max: Pan } | null>(null);
  if (!pans.current) {
    const make = (which: 'min' | 'max') =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Once a thumb is grabbed, don't let the parent ScrollView take the
        // gesture back mid-drag.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const s = live.current;
          startCx.current = centerOf(which === 'min' ? s.min : s.max, s.w);
        },
        onPanResponderMove: (_e, g) => {
          const s = live.current;
          let v = snap(valueAt(startCx.current + g.dx, s.w));
          // Keep the thumbs from crossing (leave a step between them).
          if (which === 'min') v = clamp(v, lo, s.max - step);
          else v = clamp(v, s.min + step, hi);
          onChangeRef.current(
            which === 'min' ? v : s.min,
            which === 'min' ? s.max : v,
          );
        },
      });
    pans.current = { min: make('min'), max: make('max') };
  }

  const minCx = centerOf(min, w);
  const maxCx = centerOf(max, w);

  return (
    <View
      style={styles.row}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      <View style={styles.track} />
      {w > 0 && (
        <>
          <View
            style={[
              styles.fill,
              { left: minCx, width: Math.max(0, maxCx - minCx), backgroundColor: color },
            ]}
          />
          <View
            style={[styles.thumb, { left: minCx - R, backgroundColor: color }]}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            {...pans.current.min.panHandlers}
          />
          <View
            style={[styles.thumb, { left: maxCx - R, backgroundColor: color }]}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            {...pans.current.max.panHandlers}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: H, justifyContent: 'center' },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (H - 4) / 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e2e2',
  },
  fill: { position: 'absolute', top: (H - 4) / 2, height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    top: (H - 2 * R) / 2,
    width: 2 * R,
    height: 2 * R,
    borderRadius: R,
    borderWidth: 2,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});
