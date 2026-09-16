/**
 * How generated routes are RANKED and described — the pure half of the Plan
 * screen's alternatives logic.
 *
 * Split out of `app/(tabs)/plan.tsx` because none of it touches React: given a
 * `PlanOutcome` it returns a sort key, a verdict, or a line of text. Keeping it
 * here means the ranking rules can be read (and reasoned about) without
 * scrolling past 1300 lines of screen.
 */
import { rideDisplayName, rideEmoji, type RideUse } from '../types/ride';
import type { PlanOutcome } from './planRoute';

/** Order routes best-first (lower = better on each term, left to right):
 *  rule 2 completeness → rule 4 ends at a village → fewest re-walked days →
 *  how badly those days retrace (severity, so a 90%-overlap day always loses to
 *  a 6%-overlap one even at equal day-count — worse than any distance/elevation
 *  miss) → fewest region-revisits → rule-6 whole-trail fit (ascent≻distance≻
 *  descent, over≻under). */
export function ratingKey(o: PlanOutcome, roundtrip: boolean): number[] {
  return [
    o.requestedDays - o.plannedDays,
    !roundtrip && !o.endsAtVillage ? 1 : 0,
    o.retraceDays,
    o.retraceSeverity,
    o.revisitDays,
    o.fitScore,
  ];
}

export function compareRating(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** True when a route hits every target (nothing to warn about). */
export function ratingIsClean(o: PlanOutcome, roundtrip: boolean): boolean {
  return (
    o.offTargetDays === 0 &&
    o.retraceDays === 0 &&
    o.plannedDays >= o.requestedDays &&
    (roundtrip || o.endsAtVillage)
  );
}

/** One-line, plain-language summary of exactly what the rating weighed. */
export function ratingSummary(o: PlanOutcome, roundtrip: boolean): string {
  const parts: string[] = [];
  if (o.plannedDays < o.requestedDays) {
    parts.push(`${o.plannedDays}/${o.requestedDays} days routed`);
  }
  // "2 of 5 days off target" rather than "2 days off target": the bare count
  // doesn't say whether that's most of the trip or a small part of it, which is
  // the thing you actually need when comparing alternatives.
  if (o.offTargetDays > 0) {
    parts.push(`off target on ${o.offTargetDays} of ${o.plannedDays} days`);
  }
  if (o.retraceDays > 0) {
    parts.push(
      `${o.retraceDays} of ${o.plannedDays} days re-walk trail`,
    );
  }
  if (!roundtrip && !o.endsAtVillage) parts.push('no village finish');
  return parts.length ? parts.join(' · ') : 'Meets all your targets';
}

/** How many sequential searches the alternatives hunt runs: the balanced route,
 *  then the shorter/longer pair together. The donut divides its sweep between
 *  them so it fills once rather than once per search. */
export const ALT_PHASES = 2;

/** Ring fill, 0–1. For a single route that's just day/total; for the
 *  alternatives hunt it's the completed phases plus progress through the current
 *  one, so the ring only ever advances. */
export function donutProgress(p: {
  day: number;
  total: number;
  phase?: number;
}): number {
  if (p.total <= 0) return 0;
  const within = Math.min(1, p.day / p.total);
  if (p.phase == null) return within;
  return Math.min(1, (p.phase + within) / ALT_PHASES);
}

/** Distinct lifts/trains a route rides, labelled — or null if it's all walking. */
export function rideNote(o: PlanOutcome): string | null {
  const used = o.legRides.filter((r): r is RideUse => !!r);
  if (used.length === 0) return null;
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const r of used) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    labels.push(`${rideEmoji(r.mode)} ${rideDisplayName(r)}`);
  }
  return labels.join('   ');
}
