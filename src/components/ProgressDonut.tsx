import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  /** Fill fraction, 0–1. */
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  /** Rendered centred inside the ring (e.g. the day count). */
  children?: React.ReactNode;
}

/** A circular progress ring that eases smoothly toward `progress`. */
export function ProgressDonut({
  progress,
  size = 128,
  stroke = 12,
  color = '#2f6f4f',
  track = '#e4ece7',
  children,
}: Props) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const p = useSharedValue(0);
  const prev = useRef(0);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(1, progress));
    // A DROP in progress means a new phase started (e.g. moving from the ideal
    // route to generating an alternative, which restarts at day 1). Animating
    // the fill downward looks like the ring spinning counter-clockwise, so
    // instead snap it empty and let it fill clockwise again from zero.
    if (clamped < prev.current) p.value = 0;
    p.value = withTiming(clamped, { duration: 450 });
    prev.current = clamped;
  }, [progress, p]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - p.value),
  }));

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute' }}
        // Start the sweep at 12 o'clock and go clockwise.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={track}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
        />
      </Svg>
      {children}
    </View>
  );
}
