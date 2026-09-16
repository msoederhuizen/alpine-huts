/**
 * Derive this app's BRouter profiles from the stock `hiking-beta.brf`.
 *
 *   hiking-beta.brf   pristine upstream download — NEVER edited
 *     └── hiking-t1.brf … hiking-t6.brf   one per SAC ceiling
 *
 * Generated rather than stored as copies so they can never drift apart, and so
 * every difference from upstream is visible here as a named edit instead of
 * being buried in a 300-line file nobody diffs.
 *
 * ── Why SIX, and not the old hiking-hut / hiking-alpine pair ────────────────
 * The pair encoded a decision the app had no business making: `hiking-hut`
 * capped at T3, so anywhere a real trail crossed T4+ ground BRouter did not
 * report "this is hard" — it silently routed AROUND. The Adlerweg's stage 11
 * came back as 32.3 km against a real 13.9, and looked like an ordinary long
 * day. That is worse than showing the hard line: it invents a walk nobody does
 * and hides the one they asked for.
 *
 * The ceiling is now the WALKER's choice (`maxSac` in preferencesStore), so
 * there is one profile per grade and the app asks for whichever they picked.
 * Every leg still carries its SAC badge, so a hard day is visible, not hidden.
 *
 *   node scripts/make-profiles.mjs [brouterProfilesDir]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir =
  process.argv[2] ??
  join(dirname(fileURLToPath(import.meta.url)), '..', 'brouter', 'profiles2');

const SRC = join(dir, 'hiking-beta.brf');
if (!existsSync(SRC)) {
  console.error(`!! ${SRC} not found — run the BRouter setup script first.`);
  process.exit(1);
}

/** Apply one edit, failing loudly if the line it targets has moved or changed. */
function edit(text, label, pattern, replacement) {
  if (!pattern.test(text)) {
    console.error(`!! profile edit "${label}" did not match — upstream changed?`);
    process.exit(1);
  }
  console.log(`   · ${label}`);
  return text.replace(pattern, replacement);
}

let p = readFileSync(SRC, 'utf8');
console.log('==> shared edits (from pristine hiking-beta.brf)');

// ── 1. No penalty at or below the preferred grade ───────────────────────────
// `SAC_scale_preferred` is a SWEET SPOT: stock penalises grades on both sides,
// so raising it to 2 would have put a 0.10 penalty on easy T1 paths. Zeroing
// SAC_K1 collapses the whole below-preferred series (it compounds as
// 1.1^n − 1), turning the sweet spot into a FLOOR: free up to `preferred`,
// geometric above it. That is what "no penalty on easier routes" requires.
p = edit(p, 'SAC_K1 0.1 → 0.0 (no penalty below preferred)',
  /assign\s+SAC_K1\s+0\.1/, 'assign  SAC_K1      0.0');

// ── 2. T1 AND T2 both free ──────────────────────────────────────────────────
// With the floor above, `preferred = 2` means T1 and T2 cost nothing and the
// penalty starts at T3 (+0.60), then 1.56 / 3.10 / 5.55 for T4 / T5 / T6.
p = edit(p, 'SAC_scale_preferred 1 → 2 (T1 and T2 free)',
  /assign\s+SAC_scale_preferred\s+1/, 'assign   SAC_scale_preferred      2');

// ── 3. Roads that do not exist are not walkable ─────────────────────────────
// Stock penalises these at 1.5 and 2.5, i.e. treats them as slightly awkward
// paths. `proposed` is a road that has not been built and `construction` is a
// building site; routing a walker onto either is simply wrong.
p = edit(p, 'highway=proposed|abandoned → blocked',
  /switch highway=proposed\|abandoned\s+switch ismuddy 3 1\.5/,
  'switch highway=proposed|abandoned   100000');
p = edit(p, 'highway=construction → blocked',
  /switch highway=construction\s+switch ismuddy 10 2\.5/,
  'switch highway=construction         100000');

// ── 4. Cycleways cost more than a rough path ────────────────────────────────
// Stock puts cycleway at 1.2–1.4 while a muddy path is 2.01, so the router
// preferred tarmac beside a road over the trail. This is a walking app.
p = edit(p, 'cycleway 1.4/1.2 → 2.2/2.0 (prefer trails over tarmac)',
  /switch {4}highway=cycleway {9}switch ismuddy 1\.4\s*\n\s*switch iswet {3}1\.0 1\.2/,
  'switch    highway=cycleway         switch ismuddy 2.2\n' +
  '                                     switch iswet   2.0 2.1');

// ── 5. Via ferratas are not walking routes ──────────────────────────────────
// ⚠️ The stock profile never mentions `highway=via_ferrata`, so it falls through
// to `cost_of_unknown = 2` — CHEAPER than a muddy path at 2.01. By default
// BRouter will therefore route an ordinary walker up a secured climbing route.
// Blocked here; the alpine profile re-opens it dearly below.
//
// ⚠️ `highway=ladder` CANNOT be handled at all, and the attempt is what made
// every request 500. BRouter matches tags against an enumerated dictionary
// (profiles2/lookups.dat) and `ladder` is simply not in it, so naming it is a
// parse error rather than a rule that never fires. Bisecting the six edits one
// at a time is what pinned it down. Ways tagged `highway=ladder` are invisible
// to BRouter regardless, so there is nothing to gate.
p = edit(p, 'highway=via_ferrata → blocked (default profile)',
  /switch highway=motorway\|motorway_link {4}100000/,
  'switch highway=via_ferrata              100000\n' +
  '  switch highway=motorway|motorway_link    100000');

// ── 6. Tarmac must cost MORE than a trail ───────────────────────────────────
// ⚠️ Stock has this backwards for a walking app. A `residential` road costs
// 1.0–1.5 and `tertiary` 1.4–2.0, while an ordinary unpaved path costs up to
// 2.01 — so where a lane runs parallel to a trail, the road is literally the
// cheaper way to walk, and it is usually flatter and shorter too. That is why
// legs came back running along a road when a path went over the hill beside it.
//
// These are COSTS, not exclusions, deliberately. Plenty of legitimate hut
// approaches and every village connection use a stretch of road; banning them
// would strand places rather than route around them. Dearer-than-a-path simply
// means a road is taken when it is the only sensible line, not merely because it
// is quicker. (A long stretch of fast road is handled separately — see
// `MAX_FAST_ROAD_M` in src/api/brouter.ts.)
p = edit(p, 'residential/living_street 1.0–1.5 → 2.4–2.6',
  /switch {4}highway=residential\|living_street {4}\s*\n\s*switch ismuddy 1\.5\s*\n\s*switch iswet {3}1\.0 1\.1/,
  'switch    highway=residential|living_street\n' +
  '                                     switch ismuddy 2.6\n' +
  '                                     switch iswet   2.4 2.5');
p = edit(p, 'service 1.1–1.5 → 2.4–2.6',
  /switch {4}highway=service {10}switch ismuddy 1\.5\s*\n\s*switch iswet {3}1\.1 1\.3/,
  'switch    highway=service          switch ismuddy 2.6\n' +
  '                                     switch iswet   2.4 2.5');
p = edit(p, 'tertiary/unclassified 1.4–2.0 → 2.6–3.0',
  /switch highway=tertiary\|tertiary_link\|unclassified {6}switch ismuddy 2\.0 {2}switch iswet {2}switch issidewalk 1\.4 1\.7\s*\n\s*switch issidewalk 1\.7 2\.0/,
  'switch highway=tertiary|tertiary_link|unclassified      switch ismuddy 3.0  switch iswet  switch issidewalk 2.6 2.8\n' +
  '                                                                                          switch issidewalk 2.8 3.0');

// ── One profile per SAC ceiling, T1 … T6 ───────────────────────────────────
// Everything above is shared; the ONLY differences per grade are the ceiling
// itself and whether via ferratas are permitted.
for (let limit = 1; limit <= 6; limit++) {
  console.log(`==> deriving hiking-t${limit}.brf (SAC ceiling T${limit})`);
  let v = edit(p, `SAC_scale_limit 3 → ${limit}`,
    /assign\s+SAC_scale_limit\s+3/, `assign   SAC_scale_limit          ${limit}`);

  // A via ferrata needs a harness and a via ferrata set — it is not a hard
  // WALK, it is a different activity. So it stays blocked at every ceiling
  // except the top one, where the walker has explicitly said they accept T6.
  // Even there it is dear (8×) so it is taken only when there is genuinely no
  // walking line, and any leg using one is flagged in the UI as needing gear —
  // see `hardestViaFerrata`.
  if (limit === 6) {
    v = edit(v, 'highway=via_ferrata → allowed at 8× (T6 only)',
      /switch highway=via_ferrata {14}100000/, 'switch highway=via_ferrata              8.0');
  }

  writeFileSync(join(dir, `hiking-t${limit}.brf`), v);

  // ── The scenic twin: same ceiling, but seeks the high line ───────────────
  //
  // ⚠️ DERIVED, not hand-written. The scenic profile used to be a 25-line
  // literal in src/api/brouter.ts UPLOADED to BRouter at runtime — and the
  // upload never worked (our server answers 200 with an error body), so
  // `fetchLeg` silently fell back and the toggle changed nothing at all for the
  // life of the feature. Deriving it here makes it a real file, and means it
  // inherits every shared edit above INCLUDING the SAC machinery — so the
  // walker's ceiling still applies on a scenic route instead of being bypassed.
  //
  // Two changes make it scenic:
  //   · climbing is charged at less than half rate, so a route over a ridge can
  //     compete with the flat way round;
  //   · roads are dearer again on top of the shared edit, so it leaves tarmac
  //     wherever any trail exists.
  let s = edit(v, `scenic t${limit}: uphillcostvalue 7 → 3 (climbing is cheap)`,
    /assign {3}uphillcostvalue\t {2}7/, 'assign   uphillcostvalue\t  3');
  s = edit(s, `scenic t${limit}: residential/service dearer still (2.6 → 4.2)`,
    /switch ismuddy 2\.6\n {37}switch iswet {3}2\.4 2\.5/g,
    'switch ismuddy 4.2\n                                     switch iswet   4.0 4.1');
  s = edit(s, `scenic t${limit}: tertiary dearer still (3.0 → 4.6)`,
    /switch ismuddy 3\.0 {2}switch iswet {2}switch issidewalk 2\.6 2\.8/,
    'switch ismuddy 4.6  switch iswet  switch issidewalk 4.2 4.4');
  writeFileSync(join(dir, `hiking-scenic-t${limit}.brf`), s);
}

console.log('==> wrote hiking-t1…t6.brf and hiking-scenic-t1…t6.brf');
