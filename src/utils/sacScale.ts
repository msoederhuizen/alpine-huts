/**
 * The SAC (Swiss Alpine Club) hiking difficulty scale — OSM's `sac_scale` tag
 * values, in ascending difficulty order. This is the T1–T6 grading used on
 * Swiss trail signage and hut-to-hut route descriptions.
 */
export type SacScale =
  | 'hiking'
  | 'mountain_hiking'
  | 'demanding_mountain_hiking'
  | 'alpine_hiking'
  | 'demanding_alpine_hiking'
  | 'difficult_alpine_hiking';

const ORDER: SacScale[] = [
  'hiking',
  'mountain_hiking',
  'demanding_mountain_hiking',
  'alpine_hiking',
  'demanding_alpine_hiking',
  'difficult_alpine_hiking',
];

/** Ascending difficulty order, for comparisons. */
export const SAC_SCALE_ORDER: readonly SacScale[] = ORDER;

/**
 * Whether `scale` is within a `max` difficulty — i.e. no harder than it.
 *
 * ⚠️ An UNKNOWN scale counts as within. Most trail segments carry no `sac_scale`
 * tag at all, so treating unknown as "too hard" would reject nearly every route
 * and make the filter useless. The consequence is that this can only guarantee no
 * leg is KNOWN to exceed the limit — it can't promise a route has no hard ground
 * on untagged sections. Anything user-facing must say so.
 */
export function isWithinSacLimit(
  scale: SacScale | undefined,
  max: SacScale | undefined,
): boolean {
  if (!max || !scale) return true;
  return ORDER.indexOf(scale) <= ORDER.indexOf(max);
}

/** "T1".."T6" — the grade number this scale is commonly known by. */
export const SAC_SCALE_GRADE: Record<SacScale, string> = {
  hiking: 'T1',
  mountain_hiking: 'T2',
  demanding_mountain_hiking: 'T3',
  alpine_hiking: 'T4',
  demanding_alpine_hiking: 'T5',
  difficult_alpine_hiking: 'T6',
};

/** A one-word plain-English difficulty, so "T2" reads as a difficulty rating
 *  even to someone who's never heard of the SAC scale — not everyone knows
 *  what the T stands for. */
export const SAC_SCALE_DIFFICULTY: Record<SacScale, string> = {
  hiking: 'Easy',
  mountain_hiking: 'Moderate',
  demanding_mountain_hiking: 'Challenging',
  alpine_hiking: 'Difficult',
  demanding_alpine_hiking: 'Very difficult',
  difficult_alpine_hiking: 'Extreme',
};

/**
 * What each grade means on the ground, in plain language.
 *
 * "T4" tells you nothing unless you already know the scale, and a walker who
 * misreads it is choosing terrain rather than a label — so each grade says what
 * the path is like, what it demands of you, and what it needs. Wording follows
 * the Swiss Alpine Club's own definitions rather than paraphrasing loosely.
 */
export const SAC_SCALE_MEANING: Record<SacScale, string> = {
  hiking:
    'Well-made paths, flat or gently sloping. No head for heights needed, and trainers are fine.',
  mountain_hiking:
    'A continuous path, sometimes steep. Partly exposed, but any tricky spots are secured. Sure-footedness and proper walking boots.',
  demanding_mountain_hiking:
    'The path can be exposed, occasionally with chains or cables. Needs sure-footedness, a head for heights and good boots.',
  alpine_hiking:
    'The path may vanish for stretches, and you will use your hands in places. Exposed ground with some scrambling — needs alpine experience and the ability to read terrain.',
  demanding_alpine_hiking:
    'Often trackless, with easy climbing sections. Demands mountaineering experience, confident route-finding and a good head for exposure.',
  difficult_alpine_hiking:
    'Mostly trackless with exposed climbing. A rope is frequently needed. For experienced mountaineers only.',
};

/** Badge colour per grade — green (easy) through red (hard), matching the
 *  same "traffic light" convention Swiss trail signs use. */
export const SAC_SCALE_COLOR: Record<SacScale, string> = {
  hiking: '#2f6f4f',
  mountain_hiking: '#5b8c3a',
  demanding_mountain_hiking: '#c9971c',
  alpine_hiking: '#d9730d',
  demanding_alpine_hiking: '#c0392b',
  difficult_alpine_hiking: '#7a1f4b',
};

/**
 * The hardest grade found among BRouter's per-segment `messages` (the same
 * WayTags table `ferryMeters` in `brouter.ts` reads) — a leg is only as easy
 * as its hardest stretch, so this takes the max, not an average.
 *
 * `undefined` when no segment along the leg carries a `sac_scale` tag at all —
 * OSM's difficulty tagging is patchy (verified live: a real alpine leg was 78%
 * untagged distance), so it's safer to say "not rated" than to guess a grade
 * from partial data.
 */
export function hardestSacScale(
  messages: string[][] | undefined,
): SacScale | undefined {
  if (!messages || messages.length < 2) return undefined;
  const [header, ...rows] = messages;
  const wayIdx = header.indexOf('WayTags');
  if (wayIdx < 0) return undefined;
  let hardest: SacScale | undefined;
  let hardestRank = -1;
  for (const row of rows) {
    const m = (row[wayIdx] ?? '').match(/(?:^|\s)sac_scale=(\S+)/);
    if (!m) continue;
    const rank = ORDER.indexOf(m[1] as SacScale);
    if (rank > hardestRank) {
      hardestRank = rank;
      hardest = m[1] as SacScale;
    }
  }
  return hardest;
}

/** Grades that count as "hard" for the walking-time correction. */
const HARD_GRADES = new Set<string>([
  'alpine_hiking',
  'demanding_alpine_hiking',
  'difficult_alpine_hiking',
]);

/**
 * Fraction of this leg's distance on SAC T4 or harder, 0–1.
 *
 * Measured across the eight calibration legs this ranges from 5% to 96%, which
 * is exactly why the time correction can't key off the hardest grade alone: a
 * 20 km day with 600 m of T5 was being scaled as though all 20 km were T5.
 *
 * Untagged distance counts as NOT hard. That is the safe reading here — it
 * shrinks the correction rather than inflating it — but note it also means
 * patchy tagging quietly understates a rough day.
 */
export function hardSacShare(messages: string[][] | undefined): number {
  if (!messages || messages.length < 2) return 0;
  const [header, ...rows] = messages;
  const wayIdx = header.indexOf('WayTags');
  const distIdx = header.indexOf('Distance');
  if (wayIdx < 0 || distIdx < 0) return 0;
  let total = 0;
  let hard = 0;
  for (const row of rows) {
    const d = Number(row[distIdx]) || 0;
    total += d;
    const m = (row[wayIdx] ?? '').match(/(?:^|\s)sac_scale=(\S+)/);
    if (m && HARD_GRADES.has(m[1])) hard += d;
  }
  return total > 0 ? hard / total : 0;
}

/**
 * Does any stretch of this leg carry `via_ferrata_scale`?
 *
 * ⚠️ This is a KIT question, not a difficulty one, which is why it can't be left
 * to the SAC grade. A via ferrata needs a harness, a lanyard with energy
 * absorber and a helmet — turning up without them is dangerous regardless of how
 * fit you are. And the two are not interchangeable: BRouter routed a
 * `via_ferrata_scale` way inside a leg it graded T3, so a walker reading only
 * "Challenging" would have had no warning at all.
 *
 * Reads the same `WayTags` table as `hardestSacScale`. Returns the hardest
 * grade found (A–F, sometimes written K1–K6), or undefined.
 */
export function hardestViaFerrata(
  messages: string[][] | undefined,
): string | undefined {
  if (!messages || messages.length < 2) return undefined;
  const [header, ...rows] = messages;
  const wayIdx = header.indexOf('WayTags');
  if (wayIdx < 0) return undefined;
  let hardest: string | undefined;
  for (const row of rows) {
    const m = (row[wayIdx] ?? '').match(/(?:^|\s)via_ferrata_scale=(\S+)/);
    if (!m) continue;
    // Plain string compare is enough: both common schemes (A…F and K1…K6) sort
    // correctly, and we only ever show this as "present, hardest seen".
    if (!hardest || m[1] > hardest) hardest = m[1];
  }
  return hardest;
}

/** Combine two legs' grades (e.g. either side of a ride) into the harder of
 *  the two — a leg with no rating on one side doesn't erase the other's. */
export function combineSacScale(
  a: SacScale | undefined,
  b: SacScale | undefined,
): SacScale | undefined {
  if (!a) return b;
  if (!b) return a;
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}
