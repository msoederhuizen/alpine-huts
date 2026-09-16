export interface Coord {
  lat: number;
  lon: number;
}

/** Open-Meteo's keyless DEM elevation API. Up to 100 points per request. */
const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
const BATCH = 100;
const BATCH_TIMEOUT_MS = 12000;
/** Attempts per batch before giving up and returning nulls — see the comment in
 *  the loop for why a silent null is expensive. */
const ELEVATION_RETRIES = 4;

/** Abort after `ms`, or when the parent signal aborts. */
function withTimeout(ms: number, parent?: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const relay = () => {
    clearTimeout(timer);
    ctrl.abort();
  };
  if (parent) {
    if (parent.aborted) relay();
    else parent.addEventListener('abort', relay);
  }
  return ctrl.signal;
}

/**
 * Look up ground elevation (metres) for a list of coordinates. Returns an array
 * aligned with the input; entries are null when a lookup fails, so callers can
 * decide what to do with the unknowns. Batches requests of 100 points.
 */
export async function fetchElevations(
  points: Coord[],
  signal?: AbortSignal,
  /**
   * Called after EVERY successful batch with that batch's offset into `points`
   * and its results — so a caller can bank partial progress before a later
   * batch's quota error aborts the whole call.
   *
   * ⚠️ This is what makes a quota-limited run make PROGRESS instead of looping.
   * Without it, a region needing 1 000 lookups resolved ~700, threw on the batch
   * that hit the limit, and the caller — which only recorded results after the
   * call returned — banked nothing. Ten DEM-heavy regions therefore failed
   * identically on three consecutive days, each run re-fetching exactly what the
   * previous one had already paid for and discarded.
   */
  onBatch?: (offset: number, resolved: (number | null)[]) => void,
): Promise<(number | null)[]> {
  const out: (number | null)[] = [];

  for (let i = 0; i < points.length; i += BATCH) {
    const chunk = points.slice(i, i + BATCH);
    const lats = chunk.map((p) => p.lat).join(',');
    const lons = chunk.map((p) => p.lon).join(',');

    // ⚠️ RETRY, don't just null out. A null elevation isn't neutral: callers
    // that gate on altitude (`isElevationGatedLodging`) drop anything they can't
    // place, so one flaky batch silently deletes real hotels from the dataset.
    // That is exactly what happened on 2026-07-28 — a transient Open-Meteo
    // failure during a bundle regeneration lost 67 genuine hotels in Julian &
    // Carnic (Berghof 1528 m, Hotel Kreuzbergpass 1638 m, …), all of which lack
    // an OSM `ele` tag and so depend entirely on this lookup.
    let resolved: (number | null)[] | null = null;
    for (let attempt = 1; attempt <= ELEVATION_RETRIES && !resolved; attempt++) {
      try {
        const res = await fetch(
          `${ELEVATION_URL}?latitude=${lats}&longitude=${lons}`,
          { signal: withTimeout(BATCH_TIMEOUT_MS, signal) },
        );
        // A daily-quota rejection is NOT transient — retrying only burns what's
        // left and can never succeed. Surface it as a distinct, fatal error so
        // callers stop instead of hammering (the generator checks for QUOTA).
        if (res.status === 429) {
          throw new Error(
            'ELEVATION_QUOTA: elevation API daily request limit exceeded — retry tomorrow',
          );
        }
        if (!res.ok) throw new Error(`elevation HTTP ${res.status}`);
        const json = (await res.json()) as { elevation?: number[] };
        const els = json.elevation ?? [];
        resolved = chunk.map((_, j) =>
          typeof els[j] === 'number' ? els[j] : null,
        );
      } catch (err) {
        if (signal?.aborted) throw err;
        // Fatal: propagate immediately, don't retry and don't null-fill.
        if (err instanceof Error && err.message.startsWith('ELEVATION_QUOTA')) {
          throw err;
        }
        if (attempt === ELEVATION_RETRIES) break;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    // Hand the batch over BEFORE the next iteration can throw, so whatever this
    // one cost is never paid for twice.
    if (resolved) onBatch?.(i, resolved);
    out.push(...(resolved ?? chunk.map(() => null)));
  }

  return out;
}
