/**
 * Hiking-time estimate, **calibrated against real walked legs** in the Bernese
 * Oberland (2026-08, timed excluding breaks, elevations confirmed by the walker).
 *
 * Speed depends on GRADIENT, not just on totals — a Tobler-style curve:
 *
 *      slope  +30%   1.8 km/h        steep climb, slow
 *             +15%   2.8
 *               0%   4.4             flat
 *              -5%   5.2  ← fastest  gentle descent beats flat
 *             -15%   3.3
 *             -25%   2.1             steep descent, slower than flat
 *
 * The peak sits at −5%: strolling gently downhill really is quicker than level
 * ground, while both a steep climb and a steep drop cost time. Ascent and
 * descent fall away at DIFFERENT rates (`K_UP` vs `K_DOWN`) — a 15% climb and a
 * 15% drop are not equally hard, so a symmetric curve can't express both.
 *
 * A rest allowance is then added: BREAK_MIN per BREAK_EVERY_MIN walked.
 *
 * ── Why the profile is simplified first ────────────────────────────────────
 *
 * ⚠️ Gradient CANNOT be read off the raw routed profile. Consecutive points sit
 * a few metres apart with metre-scale elevation noise, which produces wild
 * fictional slopes and, summed up, 31% more climbing than was actually walked
 * (3958 m reported against 3016 m walked, over the calibration legs).
 *
 * So the profile is first reduced to real turning points by a hysteresis filter:
 * a rise or fall is only recognised once it exceeds ELEVATION_DEADBAND_M from
 * the last extreme. Verified against the walker's own figures — at a 10 m
 * deadband total ascent lands within 1% and descent within 3%, and a leg comes
 * out as 5–16 meaningful up/down sections instead of thousands of noisy ones.
 */
import { metresBetween } from './geo';

export type ProfilePoint = [number, number, number?];

/** A real up/down turning point: cumulative distance (m) and elevation (m). */
export interface ProfileVertex {
  d: number;
  e: number;
}

/**
 * Undulations smaller than this don't count as climbing.
 *
 * Measured against confirmed figures (walker: +3265/−3293 m over four segments):
 *   0 m → +3958   5 m → +3431   10 m → +3312   20 m → +3203
 * 10 m is both the standard smoothing threshold and the closest match.
 */
const ELEVATION_DEADBAND_M = 10;

/** Speed at the sweet spot, in km/h — reached at PEAK_SLOPE. */
const PEAK_SPEED_KMH = 5.15;
/** Gradient at which walking is fastest: a gentle 5% downhill. */
const PEAK_SLOPE = -0.05;
/** How sharply speed decays climbing away from the peak. */
const K_UP = 3.0;
/** …and descending. Steeper than K_UP: losing height fast costs more than the
 *  same gradient gained, which is why a long steep descent is so tiring. */
const K_DOWN = 4.5;
/** Never let the curve imply a crawl slower than this (very steep sections). */
const MIN_SPEED_KMH = 0.6;

/** Rest allowance folded into every estimate: 5 minutes per 30 walked. */
const BREAK_MIN = 5;
const BREAK_EVERY_MIN = 30;
const BREAK_FACTOR = 1 + BREAK_MIN / BREAK_EVERY_MIN;

/** A ProfilePoint is `[lon, lat, ele?]`, so the coordinates go in reversed. */
function haversineMeters(a: ProfilePoint, b: ProfilePoint): number {
  return metresBetween(a[1], a[0], b[1], b[0]);
}

/** Walking speed (km/h) on a given gradient (rise ÷ run). */
export function speedAtSlope(slope: number): number {
  const k = slope >= PEAK_SLOPE ? K_UP : K_DOWN;
  const speed = PEAK_SPEED_KMH * Math.exp(-k * Math.abs(slope - PEAK_SLOPE));
  return Math.max(speed, MIN_SPEED_KMH);
}

/**
 * Reduce a noisy profile to its genuine turning points.
 *
 * Tracks the running high and low since the last emitted vertex and commits one
 * only when the profile reverses by more than the deadband — so a real summit is
 * kept while metre-scale jitter is not. Exported for the calibration scripts.
 */
export function simplifyProfile(coords: ProfilePoint[]): ProfileVertex[] {
  if (coords.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(coords[i - 1], coords[i]));
  }
  const at = (i: number): ProfileVertex => ({ d: cum[i], e: coords[i][2] ?? 0 });

  const out: ProfileVertex[] = [at(0)];
  let lo = at(0);
  let hi = at(0);
  let dir = 0; // 1 rising, -1 falling, 0 not yet established
  for (let i = 1; i < coords.length; i++) {
    const p = at(i);
    if (p.e > hi.e) hi = p;
    if (p.e < lo.e) lo = p;
    if (dir !== -1 && hi.e - p.e > ELEVATION_DEADBAND_M) {
      out.push(hi); // a genuine high point
      dir = -1;
      lo = p;
      hi = p;
    } else if (dir !== 1 && p.e - lo.e > ELEVATION_DEADBAND_M) {
      out.push(lo); // a genuine low point
      dir = 1;
      lo = p;
      hi = p;
    }
  }
  out.push(at(coords.length - 1));
  // Distance must strictly increase for each section's slope to be defined.
  return out.filter((p, i) => i === 0 || p.d > out[i - 1].d);
}

/** Total climb and drop over the simplified profile. */
export function smoothedClimb(coords: ProfilePoint[]): {
  ascent: number;
  descent: number;
} {
  const pts = simplifyProfile(coords);
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < pts.length; i++) {
    const dh = pts[i].e - pts[i - 1].e;
    if (dh > 0) ascent += dh;
    else descent -= dh;
  }
  return { ascent, descent };
}

/**
 * Extra time for scrambling ground, by SAC grade.
 *
 * The base model is gradient-driven and was calibrated against ten REAL walked
 * legs. That calibration is better evidence than any guidebook, so it is left
 * alone — this only adds a factor for terrain those ten legs never covered.
 *
 * ── What the guides show (published time ÷ base model) ───────────────────────
 * T3 and below, n=7: mean 1.16×, and 2 of 7 BELOW 1 (we're slower than the
 * guide). No correction warranted.
 *
 * T4 and above, n=8, from le-gr20.fr, visittirol.nl, alpenvereinaktiv and SAC:
 *
 *   1.70  Ascu-Stagnu→Tighiettu (T5)     1.30  Schönbielhütte→Teodulo (T5)
 *   1.65  Carozzu→Ascu-Stagnu (T4)       1.12  Berliner→Greizer (T5)
 *   1.47  Berghaus Oberaar→Oberaarjoch   1.09  Sustlihütte→Voralphütte (T5)
 *   1.43  Greizer→Kasseler (T5)          1.03  Amberger→Hochstubaihütte (T6)
 *
 * mean 1.35, median 1.37, sd 0.26, 95% CI [1.17–1.53].
 *
 * 1.4 sits inside that interval, on the cautious side on purpose: on a hiking
 * app, under-estimating time on exposed ground is dangerous while
 * over-estimating is merely inconvenient. Applying it centres the residual at
 * 0.97× — very close to unbiased.
 *
 * ⚠️ ONE factor for all of T4–T6, NOT a per-grade curve, even though the eight
 * samples look like they trend DOWNWARD with grade (T4 1.56 n=2, T5 1.33 n=5,
 * T6 1.03 n=1). Two reasons not to fit that: n=2 and n=1 cannot carry a curve,
 * and the trend says "allow LESS extra time on the hardest ground", which is
 * precisely the direction you must not take on thin evidence.
 *
 * ⚠️ A sample is only valid if our routed distance is CLOSE to the published
 * distance. Amberger→Hildesheimer looked like a 24% model error until the pace
 * was normalised: 0.588 vs 0.608 h/km, near-identical — we simply route 27%
 * further there. Comparing totals across different lines measures route choice,
 * not walking speed, so such legs are excluded rather than fitted.
 *
 * (One T3 sample — Bettelwurf→Hallerangerhaus, 5.9 km in a published 6 h — was
 * excluded as an outlier at 3.00×: about 1 km/h, which almost certainly
 * includes the Großer Bettelwurf summit variant rather than the stage itself.)
 */
/** Multiplier for a leg that is ENTIRELY T4 or harder. */
const HARD_SAC_FULL_FACTOR = 1.6;

/**
 * Walking-time multiplier, from the FRACTION of the leg on SAC T4+.
 *
 * ⚠️ Keyed on the share, not on the hardest grade. Keying on the hardest grade
 * meant a 20 km day with 600 m of T5 was scaled as though all 20 km were T5.
 * Measured shares across the eight calibration legs run from 5% to 96%, so that
 * was badly wrong at the low end.
 *
 * ⚠️ But NOT linear in the share either, which is the counter-intuitive part.
 * Fitted against the eight legs with published times (RMSE, lower is better):
 *
 *     no factor at all              1.825
 *     flat 1.4 (the previous rule)  1.093
 *     proportional to the share     1.278   ← WORSE than flat
 *     sqrt of the share, k = 1.63   1.058
 *
 * Proportional weighting fits worse because the extra time is NOT confined to
 * the hard metres. If it were, the implied per-segment multiplier would range
 * from 1.14 to 6.37 across these legs: Greizer→Kasseler is 8% T4+ yet 43%
 * slower than the model, so those 800 m would have to take 6.4× longer. A day
 * containing T5 ground is simply rough and slow throughout — route-finding,
 * caution and fatigue don't stop at the tag boundary.
 *
 * sqrt gives partial credit for that spillover while still scaling with how much
 * hard ground there is: all T4+ → 1.6×, 25% → 1.30×, 5% → 1.13× (where the flat
 * rule gave 1.4× regardless).
 *
 * ⚠️ n=8 and the exponent is a choice, not a derivation. Treat 1.6 as "about
 * right, deliberately on the cautious side" rather than precise — on a hiking
 * app, under-estimating time on exposed ground is dangerous while
 * over-estimating is merely inconvenient.
 */
export function sacTimeFactor(hardShare: number): number {
  if (!(hardShare > 0)) return 1;
  return 1 + (HARD_SAC_FULL_FACTOR - 1) * Math.sqrt(Math.min(1, hardShare));
}

/** Estimated time in SECONDS, including the break allowance. */
export function estimateHikeTime(coords: ProfilePoint[]): number {
  const pts = simplifyProfile(coords);
  let hours = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].d - pts[i - 1].d;
    if (dx <= 0.5) continue;
    const slope = (pts[i].e - pts[i - 1].e) / dx;
    hours += dx / 1000 / speedAtSlope(slope);
  }
  return Math.round(hours * BREAK_FACTOR * 3600);
}
