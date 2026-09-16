/**
 * Wrapper that runs the classic-route check with a verification-grade timeout.
 *
 * WHY THIS FILE EXISTS — it looks like it could be one line in package.json, and
 * it can't be, twice over:
 *
 *  1. `EXPO_PUBLIC_BROUTER_LEG_TIMEOUT_MS=30000 tsx …` is POSIX syntax. npm runs
 *     scripts through cmd.exe on Windows, which treats that as a command name
 *     and fails. This project is developed on Windows.
 *  2. Setting `process.env` at the top of check-classic-routes.ts does NOT work
 *     either: `src/api/brouter.ts` reads the variable once at module load, and
 *     ESM evaluates imported modules BEFORE the importing module's body. So the
 *     assignment would land after the value it's trying to influence was already
 *     baked in. The `await import()` below is what makes the ordering real.
 *
 * WHY a different timeout at all: 3 s is tuned for the Route tab, where one slow
 * leg must not hang the UI, and giving up is the right call there. A
 * verification run has the opposite priority — it needs the TRUE answer. An
 * alpine-profile leg across T5/T6 ground searches a far bigger graph than 3 s
 * allows, and BRouter's first request into a 5°×5° `.rd5` segment also pays a
 * cold disk read. Both surface as "This operation was aborted", which reads
 * exactly like unroutable terrain. That false signal has twice had the GR20
 * written off here as missing trail data when the trail was mapped all along.
 *
 * Run: npm run check-routes
 */
process.env.EXPO_PUBLIC_BROUTER_LEG_TIMEOUT_MS ||= '30000';

// ── Point at the LOCAL router, and refuse to run against the public one ──────
//
// ⚠️ THIS IS THE WHOLE REASON TO BE CAREFUL HERE. `tsx` does not read `.env`
// (Expo does, which is why the app is fine), so `EXPO_PUBLIC_BROUTER_URL` is
// undefined in a script and `src/api/brouter.ts` falls back to brouter.de. That
// fallback is SILENT and it is not a small difference: the public server does
// not have our profiles, so `walkingProfile()` deliberately downgrades to stock
// `hiking-beta`, which means a "verification" run measures a different router
// AND a different profile from the one that ships — no SAC floor, no blocked
// construction ways, no T3 ceiling, and `alpine` ignored entirely. The numbers
// look perfectly plausible and are answers to the wrong question. An entire
// 19-route check was reported from brouter.de this way before anyone noticed.
//
// Default to localhost; honour an explicit override (a tunnel, a LAN address).
process.env.EXPO_PUBLIC_BROUTER_URL ||= 'http://127.0.0.1:17777/brouter';

if (/brouter\.de/.test(process.env.EXPO_PUBLIC_BROUTER_URL)) {
  console.error(
    'check-routes: refusing to measure against the public brouter.de.\n' +
      "  It doesn't serve our hiking-t1…hiking-t6 profiles, so every leg would\n" +
      '  be' +
      '  routed with stock hiking-beta and the totals would be meaningless.\n' +
      '  Start the local server (start-brouter.cmd) and re-run.',
  );
  process.exit(1);
}

// Fail fast if the local server isn't actually up, rather than discovering it
// one 403 at a time.
const probe = new URL(process.env.EXPO_PUBLIC_BROUTER_URL);
// Probe with the TOP ceiling: it is the default the checks measure at, and a
// missing hiking-t6.brf is exactly the failure this is meant to catch early.
probe.search = 'lonlats=7.96,46.59|7.98,46.62&profile=hiking-t6&format=geojson';
try {
  const res = await fetch(probe, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  console.error(
    `check-routes: ${process.env.EXPO_PUBLIC_BROUTER_URL} did not answer ` +
      `(${err?.message ?? err}).\n  Start it with start-brouter.cmd, then re-run.`,
  );
  process.exit(1);
}
console.log(`Routing against ${process.env.EXPO_PUBLIC_BROUTER_URL}\n`);

await import('./check-classic-routes.ts');
