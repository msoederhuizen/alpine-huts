import { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { COLORS } from '../constants/theme';
import { readElevationProfile } from '../utils/elevationProfile';

const HEIGHT = 150;
/** Room for the "2,600 m" labels on the left and the km labels underneath. */
const PAD_LEFT = 42;
const PAD_RIGHT = 10;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;
/**
 * Height change at zero distance below which it is noise, not a lift.
 *
 * 50 m, not 20: every real lift in the data climbs far more than this (the
 * Planpraz gondola gains 928 m), so the threshold's only job is to ignore two
 * samples that happen to land within a metre of each other. Set it low and a
 * sharp step in the terrain gets drawn as a dashed lift you never rode.
 */
const LIFT_MIN_RISE_M = 50;

/** A "nice" step (1/2/5 × 10ⁿ) giving roughly `want` gridlines over `span`. */
function niceStep(span: number, want: number): number {
  const rough = span / Math.max(1, want);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const n = rough / mag;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
}

/**
 * The day's height profile: distance walked against altitude.
 *
 * Width is measured rather than assumed — this sits inside a card whose padding
 * differs between screens, and a hard-coded width left the right-hand end of the
 * line either clipped or floating short of the axis.
 */
export function ElevationChart({
  profile,
  /** Metres along the leg you currently are, from a GPS fix. Omit when unknown
   *  or when the walker is not on this leg — see positionAlongRoute. */
  atDistanceM,
}: {
  profile?: number[];
  atDistanceM?: number | null;
}) {
  const [width, setWidth] = useState(0);
  const pts = useMemo(() => readElevationProfile(profile), [profile]);

  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);

  // ⚠️ Say WHICH reason. There are two, and they need different actions from
  // the reader: a trip saved before this chart existed has no stored profile
  // (re-route it), whereas a track the router returned without elevation never
  // will (nothing to do). A bare "no data" left both indistinguishable — and
  // indistinguishable from the card simply not working.
  if (pts.length < 2) {
    return (
      <View onLayout={onLayout}>
        <Text style={styles.empty}>
          {profile === undefined
            ? 'No height data stored for this day. Trips saved before this chart was added don’t have it — remove and re-add the day to fetch it.'
            : 'The routing data for this day carries no elevation, so there’s no profile to draw.'}
        </Text>
      </View>
    );
  }

  const totalM = pts[pts.length - 1].d;
  const lo = Math.min(...pts.map((p) => p.e));
  const hi = Math.max(...pts.map((p) => p.e));
  // ⚠️ Never a zero-height band: a genuinely flat day would divide by zero and
  // send every point to NaN, which renders as nothing at all.
  const span = Math.max(50, hi - lo);
  // Pad the band by 8% so the summit isn't welded to the top edge.
  const yLo = lo - span * 0.08;
  const yHi = hi + span * 0.08;

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (d: number) => PAD_LEFT + (d / totalM) * plotW;
  const y = (e: number) => PAD_TOP + (1 - (e - yLo) / (yHi - yLo)) * plotH;

  /**
   * Split the profile wherever a lift carries you.
   *
   * A ride costs no walking distance, so its two samples sit at the SAME `d`
   * with different `e`. Drawn as part of the line it would be a vertical wall
   * of solid stroke, reading as an absurdly steep climb you walked. Instead the
   * walking runs are drawn solid and the ride as a dashed vertical — height
   * gained, no ground covered.
   */
  const runs: { d: number; e: number }[][] = [];
  const lifts: { d: number; from: number; to: number }[] = [];
  let run: { d: number; e: number }[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const flat = pts[i].d - pts[i - 1].d < 1;
    const jump = Math.abs(pts[i].e - pts[i - 1].e) >= LIFT_MIN_RISE_M;
    if (flat && jump) {
      lifts.push({ d: pts[i].d, from: pts[i - 1].e, to: pts[i].e });
      runs.push(run);
      run = [pts[i]];
    } else {
      run.push(pts[i]);
    }
  }
  runs.push(run);

  const pathOf = (r: { d: number; e: number }[]) =>
    r.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`).join(' ');
  const areaOf = (r: { d: number; e: number }[]) => {
    if (r.length < 2) return '';
    const base = (PAD_TOP + plotH).toFixed(1);
    return `${pathOf(r)} L${x(r[r.length - 1].d).toFixed(1)},${base} L${x(r[0].d).toFixed(1)},${base} Z`;
  };

  /**
   * Your position, clamped into the leg and given the height of the line there.
   *
   * Read off the PROFILE rather than the GPS altitude: phone barometric/GPS
   * altitude is routinely tens of metres out, and a dot floating above or below
   * its own line would look like a bug. What matters here is where you are ON
   * THE CLIMB, which the profile answers exactly.
   */
  const here =
    atDistanceM != null && atDistanceM >= 0 && atDistanceM <= totalM
      ? (() => {
          const d = atDistanceM;
          let e = pts[0].e;
          for (let i = 1; i < pts.length; i++) {
            if (pts[i].d >= d) {
              const sp = pts[i].d - pts[i - 1].d;
              const t = sp > 0 ? (d - pts[i - 1].d) / sp : 0;
              e = pts[i - 1].e + (pts[i].e - pts[i - 1].e) * t;
              break;
            }
            e = pts[i].e;
          }
          return { d, e };
        })()
      : null;

  const eStep = niceStep(yHi - yLo, 4);
  const eTicks: number[] = [];
  for (let v = Math.ceil(yLo / eStep) * eStep; v <= yHi; v += eStep) eTicks.push(v);

  const dStep = niceStep(totalM / 1000, 4);
  const dTicks: number[] = [];
  for (let v = 0; v <= totalM / 1000 + 1e-9; v += dStep) dTicks.push(v);

  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          {eTicks.map((v) => (
            <Line
              key={`e${v}`}
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={y(v)}
              y2={y(v)}
              stroke="#dde5e0"
              strokeWidth={1}
            />
          ))}
          {eTicks.map((v) => (
            <SvgText
              key={`el${v}`}
              x={PAD_LEFT - 6}
              y={y(v) + 3.5}
              fontSize={9.5}
              fill={COLORS.muted}
              textAnchor="end"
            >
              {Math.round(v).toLocaleString('en-GB')}
            </SvgText>
          ))}
          {runs.map((r, i) =>
            r.length > 1 ? (
              <Path key={`a${i}`} d={areaOf(r)} fill={COLORS.greenTint} />
            ) : null,
          )}
          {runs.map((r, i) =>
            r.length > 1 ? (
              <Path
                key={`l${i}`}
                d={pathOf(r)}
                stroke={COLORS.green}
                strokeWidth={2}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null,
          )}
          {/* The lift: height without ground. Trail-orange and dashed so it
              can't be mistaken for a walked section. */}
          {lifts.map((l, i) => (
            <Line
              key={`v${i}`}
              x1={x(l.d)}
              x2={x(l.d)}
              y1={y(l.from)}
              y2={y(l.to)}
              stroke={COLORS.trail}
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeLinecap="round"
            />
          ))}
          {dTicks.map((v) => (
            <SvgText
              key={`d${v}`}
              x={x(v * 1000)}
              y={HEIGHT - 6}
              fontSize={9.5}
              fill={COLORS.muted}
              textAnchor={v === 0 ? 'start' : 'middle'}
            >
              {v % 1 === 0 ? v : v.toFixed(1)}
            </SvgText>
          ))}
          {/* ⚠️ No total-distance label here. It sat on top of the last grey
              tick often enough to be unreadable, and the figure is already in
              the day's header stats — it was duplication that cost legibility. */}

          {/* You are here. Drawn LAST so it sits above the line and the fill,
              with a white ring so it stays visible against the dark green. */}
          {here != null && (
            <>
              <Line
                x1={x(here.d)}
                x2={x(here.d)}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                stroke={COLORS.greenDeep}
                strokeWidth={1}
                strokeDasharray="2 3"
                opacity={0.5}
              />
              <Circle cx={x(here.d)} cy={y(here.e)} r={6.5} fill="#ffffff" />
              <Circle cx={x(here.d)} cy={y(here.e)} r={4.5} fill="#1e88e5" />
            </>
          )}
        </Svg>
      )}
      <Text style={styles.caption}>
        {Math.round(lo).toLocaleString('en-GB')}–
        {Math.round(hi).toLocaleString('en-GB')} m · highest point{' '}
        {Math.round(hi).toLocaleString('en-GB')} m
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 13, color: COLORS.muted },
  caption: { fontSize: 11.5, color: COLORS.muted, marginTop: 6 },
});
