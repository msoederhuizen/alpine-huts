/**
 * Great-circle (haversine) distance — the one copy.
 *
 * WHY THIS FILE EXISTS: this calculation had been pasted into eight files
 * (`brouter.ts`, `lifts.ts`, `useHuts.ts`, `hikeTime.ts`, `elevationProfile.ts`,
 * `lodging.ts` and twice in `planRoute.ts`), each spelling it slightly
 * differently — `haversineMeters`, `haversineM`, `haversineKm`, `kmLL`,
 * `segMeters` — because each file holds coordinates in a different shape. The
 * maths was identical in all eight; only the wrappers differed. Copies like that
 * drift silently, so the arithmetic now lives here once and callers keep a
 * one-line adapter for their own shape.
 *
 * ⚠️ METRES AND KILOMETRES ARE COMPUTED SEPARATELY, not by dividing one by
 * 1000. Every original used `R = 6371000` or `R = 6371` directly, and
 * `2 * 6371000 * x / 1000` is not guaranteed to equal `2 * 6371 * x` in the last
 * bit of a float. Keeping both constants means every call site gets exactly the
 * number it got before this file existed — which is the whole point of a
 * refactor.
 *
 * Coordinates are plain numbers rather than a shared `LatLng` type on purpose:
 * it keeps this module free of imports, so anything can depend on it without
 * risking a cycle.
 */

/** Earth's mean radius. Two units, one sphere — see the warning above. */
const R_METRES = 6371000;
const R_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** The haversine of the central angle — the shared half of both functions. */
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  return (
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  );
}

/** Great-circle distance in METRES between two lat/lon pairs (degrees). */
export function metresBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  return 2 * R_METRES * Math.asin(Math.sqrt(haversine(aLat, aLon, bLat, bLon)));
}

/** Great-circle distance in KILOMETRES between two lat/lon pairs (degrees). */
export function kmBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  return 2 * R_KM * Math.asin(Math.sqrt(haversine(aLat, aLon, bLat, bLon)));
}
