/**
 * Sanity-check the curated classic routes: route their resolved stages for real
 * and compare the app's own total against the published length.
 *
 * WHY: stage ids are hand-resolved from names, and near-miss matches are common
 * and dangerous — "Chiavenna" resolves to a refuge at 2049 m rather than the town
 * the route ends in, "Boz" to Rifugio Angelino Bozzi in the wrong massif, "Elm"
 * to Gelmerhütte. Those look fine in a list. They do NOT look fine here: a wrong
 * stage shows up immediately as a leg of absurd length, or one BRouter can't
 * route at all.
 *
 * So run this whenever `stageIds` are added to a route, BEFORE trusting it.
 * A total within roughly 10–25% of the published figure (allowing for omitted
 * trailheads) means the stages are plausibly right; a wild total means they
 * aren't.
 *
 * ⚠️ Measures what the APP ACTUALLY DRAWS, which means SCENIC — `plan.tsx` loads
 * a classic route with `setTrip(huts, true, [])`. Keep the two in step: this
 * header once claimed it used "the scenic profile, matching how these routes are
 * walked" while the app loaded them fast AND the scenic profile didn't work at
 * all, so the claim was invisible for as long as it was false.
 *
 * Pass CHECK_SCENIC=0 to measure the fast geometry for comparison.
 *
 * Run: npm run check-routes
 */

// ⚠️ Run this via `npm run check-routes`, NOT `npx tsx` directly. The wrapper in
// scripts/check-routes.mjs raises the per-leg timeout before this module's
// imports are evaluated, which is the only point at which that can still take
// effect — see the long note there. Run bare, legs that merely take a while come
// back as "UNROUTABLE", which is indistinguishable from a real data problem.
import { fetchLeg } from '../src/api/brouter';
import {
  CLASSIC_ROUTES,
  isRouteReady,
  resolveClassicRoute,
} from '../src/constants/classicRoutes';
import { bundledHutById } from '../src/data/hutBundle';
import type { Hut } from '../src/types/hut';

/** A single leg longer than this is almost always a mis-resolved stage. */
const SUSPICIOUS_LEG_KM = 60;

/** Matches `plan.tsx`'s `setTrip(huts, true, [])`. `CHECK_SCENIC=0` compares. */
const SCENIC = process.env.CHECK_SCENIC !== '0';

/**
 * Reads the published length back out of the string it's stored as.
 *
 * `length` is deliberately free text ("~120 km", "80–120 km", "390 km (Swiss
 * section)") so it renders as the author wrote it. For comparison we need a
 * number, so pull out the figures and keep a RANGE: "80–120 km" must not be
 * flattened to 100 and then reported as a 20% error when the route measures 118.
 */
function publishedRangeKm(s: string): [number, number] | null {
  // ⚠️ Only the figures BEFORE the first "km". Reading the whole string swept up
  // numbers from the parenthetical — "~166 km (stages 1–12)" became the range
  // 1–166, so any total at all landed "inside it" and reported ✅. A check that
  // passes for the wrong reason is worse than no check.
  const head = s.split(/km/i)[0];
  const nums = head.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

/** Route a leg exactly as the app does, retrying once past a cold-tile timeout. */
async function routeWithRetry(a: Hut, b: Hut) {
  // Must mirror `legQueryOptions` in src/hooks/useRouteLegs.ts. This check used
  // to drop `via`, so it routed a DIFFERENT line from the one the app draws:
  // the vias exist precisely because the router prefers the valley. A check
  // that doesn't route what ships checks nothing.
  //
  // The SAC ceiling is left at its default (T6) rather than read from the
  // walker's setting — a script has no walker, and measuring routes against
  // whatever a device happens to be set to would make results irreproducible.
  const go = () =>
    fetchLeg(
      { latitude: a.lat, longitude: a.lon },
      { latitude: b.lat, longitude: b.lon },
      undefined,
      SCENIC,
      b.via,
    );
  try {
    return await go();
  } catch {
    await new Promise((r) => setTimeout(r, 2500));
    return await go();
  }
}

/** How far outside the published range we are, as a signed %. 0 = inside it. */
function deltaPct(km: number, range: [number, number] | null): number | null {
  if (!range) return null;
  if (km < range[0]) return ((km - range[0]) / range[0]) * 100;
  if (km > range[1]) return ((km - range[1]) / range[1]) * 100;
  return 0;
}

/**
 * Validate every `stageVias` key before routing anything.
 *
 * ⚠️ A via keyed to an id that isn't in `stageIds` SILENTLY DOES NOTHING —
 * `resolveClassicRoute` looks the key up per stage and simply never finds it, so
 * the leg routes unpinned and the check reports it as merely "off" rather than
 * "misconfigured". Same for one keyed to the FIRST stop of a non-loop route: no
 * leg arrives there, so it can never apply. Both are silent, and there are 25 of
 * these keys now — several of them moved between stops when a route was reversed
 * (see the Jotunheimen Besseggen note in classicRoutes.ts).
 */
function checkStageVias(): number {
  let bad = 0;
  for (const route of CLASSIC_ROUTES) {
    const ids = route.stageIds ?? [];
    const idSet = new Set(ids);
    for (const key of Object.keys(route.stageVias ?? {})) {
      const problems: string[] = [];
      if (!idSet.has(key)) problems.push('not in stageIds — this via never applies');
      else if (ids.indexOf(key) === 0 && ids.lastIndexOf(key) === 0)
        problems.push('keyed to the first stop — no leg arrives there');
      if (problems.length) {
        bad++;
        console.log(`  ✗ ${route.name}: stageVias["${key}"] — ${problems.join('; ')}`);
      }
    }
  }
  console.log(
    bad ? `\n⚠ ${bad} stageVias key(s) are misconfigured.\n` : 'stageVias: all keys valid.\n',
  );
  return bad;
}

(async () => {
  checkStageVias();
  const summary: {
    name: string;
    km: number;
    asc: number;
    published: string;
    d: number | null;
    flags: string[];
  }[] = [];
  console.log(`Geometry: ${SCENIC ? 'SCENIC' : 'fast (matches the app)'}
`);
  const ready = CLASSIC_ROUTES.filter(isRouteReady);
  console.log(
    `${ready.length} of ${CLASSIC_ROUTES.length} routes have stage ids; checking those.\n`,
  );

  for (const route of ready) {
    const { huts, missing } = resolveClassicRoute(route, bundledHutById);
    console.log(`=== ${route.name} — published ${route.length} ===`);
    console.log(
      `    ${huts.length}/${route.stages.length} stages resolved` +
        (missing.length ? `, ${missing.length} id(s) unresolved` : ''),
    );

    let totalM = 0;
    let totalAsc = 0;
    const flags: string[] = [];
    for (let i = 0; i < huts.length - 1; i++) {
      const a = huts[i];
      const b = huts[i + 1];
      try {
        // ⚠️ RETRY ONCE. BRouter loads each 5°×5° `.rd5` segment from disk on the
        // first request that touches it, and that cold read can exceed the
        // client timeout — so a freshly-started server reports a contiguous BLOCK
        // of "unroutable" legs that all succeed on the next attempt. This exact
        // artefact has twice been reported here as a data problem (six Haute
        // Route legs, four Triglav legs) when nothing was wrong. One retry after
        // a pause is the difference between a real finding and a false alarm.
        const leg = await routeWithRetry(a, b);
        totalM += leg.distance;
        totalAsc += leg.ascent;
        const km = leg.distance / 1000;
        if (km > SUSPICIOUS_LEG_KM)
          flags.push(`${km.toFixed(0)} km: ${a.name} → ${b.name}`);
        console.log(
          `      ${km.toFixed(1).padStart(5)} km  +${String(Math.round(leg.ascent)).padStart(4)} m   ` +
            `${a.name.slice(0, 26)} → ${b.name.slice(0, 26)}`,
        );
      } catch (err) {
        flags.push(`UNROUTABLE: ${a.name} → ${b.name}`);
        console.log(`      FAILED   ${a.name.slice(0, 26)} → ${b.name.slice(0, 26)}`);
        console.log(`               ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
      }
      await new Promise((r) => setTimeout(r, 400)); // be kind to BRouter
    }

    const km = totalM / 1000;
    const d = deltaPct(km, publishedRangeKm(route.length));
    const verdict =
      d === null
        ? ''
        : d === 0
          ? '  ✅ within published range'
          : `  ${Math.abs(d) > 25 ? '❌' : '⚠️'} ${d > 0 ? '+' : ''}${d.toFixed(0)}% vs published`;
    console.log(
      `    → app total ${km.toFixed(0)} km, +${Math.round(totalAsc)} m ` +
        `vs published ${route.length}${verdict}`,
    );
    summary.push({ name: route.name, km, asc: totalAsc, published: route.length, d, flags });
    if (flags.length) {
      console.log('    ⚠ CHECK THESE — long or unroutable legs usually mean a');
      console.log('      mis-resolved stage (or simply an omitted intermediate one):');
      flags.forEach((f) => console.log(`        - ${f}`));
    }
    console.log('');
  }

  console.log('══ SUMMARY ══════════════════════════════════════════════════');
  summary
    .slice()
    .sort((x, y) => Math.abs(y.d ?? 0) - Math.abs(x.d ?? 0))
    .forEach((r) => {
      const mark = r.flags.length ? '❌' : r.d === 0 ? '✅' : Math.abs(r.d ?? 0) > 25 ? '❌' : '⚠️';
      console.log(
        `${mark} ${r.name.padEnd(26)} ${r.km.toFixed(0).padStart(4)} km ` +
          `+${String(Math.round(r.asc)).padStart(5)} m  (published ${r.published})` +
          (r.flags.length ? `  ${r.flags.length} flag(s)` : ''),
      );
    });
})().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
