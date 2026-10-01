/**
 * Read points from refuges.info's public API.
 *
 * ⚠️ THE ONE SOURCE IN THIS PROJECT WITH AN EXPLICIT REUSE LICENCE. Its data is
 * CC BY-SA 2.0 and it publishes an API meant to be called, which is why it is
 * already trusted for photographs. Attribution is a condition, not a courtesy:
 * "refuges.info · CC BY-SA" must travel with anything taken from here, and the
 * About screen already carries it.
 *
 * ⚠️ AND IT MATCHES BY POSITION, WHICH IS WHY IT IS SAFE. Their coordinates and
 * OSM's agree to within a few metres wherever both exist, so a refuges.info
 * point can be lined up against the app's places without ever comparing names —
 * the same rule the rest of the imports follow.
 *
 * Shared by `generate-refuges-photos.ts` (photos for huts we already have) and
 * `import-refuges-info.ts` (huts we do NOT have).
 */

/** Where refuges.info has data. Outside this the tiling is wasted requests. */
export const EXTENT = { w: -2.0, s: 42.0, e: 8.0, n: 47.2 };

/** Tile size in degrees. Adaptive: a tile that hits the API's cap is split. */
const TILE = 0.5;

/** The API returns at most this many points; hitting it means data was cut off. */
const API_CAP = 250;

/**
 * The three kinds this project cares about, and the only three it asks for:
 * `cabane` (cabane non gardée — unmanned), `refuge` (refuge gardé — staffed)
 * and `gite` (gîte d'étape). Everything else refuges.info carries — summits,
 * water points, car parks — is not somewhere you sleep.
 */
const TYPES = 'cabane,refuge,gite';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RefugePoint {
  id: string;
  lat: number;
  lon: number;
  name: string;
  link: string;
  /** "cabane non gardée" / "refuge gardé" / "gîte d'étape", as they label it. */
  kind?: string;
  /** Sleeping places, where they record one. */
  places?: number;
  elevation?: number;
}

async function fetchTile(w: number, s: number, e: number, n: number): Promise<RefugePoint[]> {
  const url =
    `https://www.refuges.info/api/bbox?bbox=${w},${s},${e},${n}` +
    `&type_points=${TYPES}&format=geojson&detail=complet`;
  try {
    /**
     * ⚠️ NODE'S fetch HAS NO DEFAULT TIMEOUT, and this walks a grid of tiles —
     * one host that accepts the connection and then goes quiet stops the whole
     * import for ever, with no error to read. The photo index lost two full
     * runs to exactly this before the cause was found: both sat for three hours
     * on a handful of unresponsive hosts and had to be killed.
     *
     * 30 seconds is generous for a bbox query that normally answers in two, and
     * a tile that fails is simply skipped rather than taking the run with it.
     */
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const gj = (await res.json()) as { features?: Record<string, any>[] };
    const feats = gj.features ?? [];

    // ⚠️ A full response means the box was TRUNCATED, not that it held exactly
    // 250 refuges. Split it rather than silently losing everything past the cap.
    if (feats.length >= API_CAP && e - w > 0.08) {
      const mw = (w + e) / 2;
      const ms = (s + n) / 2;
      const parts: RefugePoint[] = [];
      for (const box of [
        [w, s, mw, ms],
        [mw, s, e, ms],
        [w, ms, mw, n],
        [mw, ms, e, n],
      ] as const) {
        await sleep(350);
        parts.push(...(await fetchTile(box[0], box[1], box[2], box[3])));
      }
      return parts;
    }

    return feats
      .map((f) => ({
        id: String(f.properties?.id ?? ''),
        lon: Number(f.geometry?.coordinates?.[0]),
        lat: Number(f.geometry?.coordinates?.[1]),
        name: String(f.properties?.nom?.valeur ?? f.properties?.nom ?? ''),
        link: String(f.properties?.lien ?? ''),
        kind: f.properties?.type?.valeur ?? undefined,
        places: Number(f.properties?.places?.valeur) || undefined,
        elevation: Number(f.geometry?.coordinates?.[2]) || undefined,
      }))
      .filter((p) => p.id && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  } catch {
    return [];
  }
}

/** Every point in the extent, de-duplicated by their id. */
export async function allPoints(onProgress?: (tiles: number, found: number) => void): Promise<RefugePoint[]> {
  const byId = new Map<string, RefugePoint>();
  let tiles = 0;
  for (let lon = EXTENT.w; lon < EXTENT.e; lon += TILE) {
    for (let lat = EXTENT.s; lat < EXTENT.n; lat += TILE) {
      for (const p of await fetchTile(lon, lat, lon + TILE, lat + TILE)) byId.set(p.id, p);
      tiles++;
      onProgress?.(tiles, byId.size);
      await sleep(350);
    }
  }
  return [...byId.values()];
}
