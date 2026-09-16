/* Perf diagnostic for the map's startup cost.

   Two things it measures, using the REAL bundle data and the REAL clustering
   config the app ships:
     1. the load scope   — which region files get parsed, how many huts survive
                           the HALO_KM border crop
     2. the marker count — how many native map annotations actually get created
                           at the opening camera, which is the thing that made
                           the map take ~a minute to draw

   Run: npx tsx scripts/measure-load.ts */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Supercluster from 'supercluster';

import {
  bboxToMapRegion,
  effectiveScope,
  HALO_KM,
  inScope,
  REGIONS,
} from '../src/constants/region';
import { CLUSTER_TUNING, zoomForLongitudeDelta } from '../src/hooks/useHutClusters';

const DIR = join(__dirname, '..', 'assets', 'data', 'regions');
type H = { id: string; lat: number; lon: number };

const text = new Map<string, string>();
for (const r of REGIONS) {
  text.set(r.id, readFileSync(join(DIR, `${r.id}.json`), 'utf8'));
}

/** Mirrors `cameraBoundsPadded` in app/(tabs)/index.tsx (30% each side). */
function paddedBounds(cam: ReturnType<typeof bboxToMapRegion>) {
  const latPad = cam.latitudeDelta * 0.3;
  const lonPad = cam.longitudeDelta * 0.3;
  return {
    south: cam.latitude - cam.latitudeDelta / 2 - latPad,
    north: cam.latitude + cam.latitudeDelta / 2 + latPad,
    west: cam.longitude - cam.longitudeDelta / 2 - lonPad,
    east: cam.longitude + cam.longitudeDelta / 2 + lonPad,
  };
}

const rows: any[] = [];
for (const r of REGIONS) {
  const scope = effectiveScope([r.id]);

  // --- load scope ------------------------------------------------------------
  const huts: H[] = [];
  let bytes = 0;
  const t0 = performance.now();
  for (const reg of scope.regions) {
    bytes += Buffer.byteLength(text.get(reg.id)!);
    const d = JSON.parse(text.get(reg.id)!) as { core: H[]; accommodations: H[] };
    for (const h of [...d.core, ...d.accommodations])
      if (inScope(scope, h.lat, h.lon)) huts.push(h);
  }
  const parseMs = performance.now() - t0;
  const uniq = [...new Map(huts.map((h) => [h.id, h])).values()];

  // --- markers actually drawn at the opening camera ---------------------------
  const cam = bboxToMapRegion(r.bbox);
  const b = paddedBounds(cam);
  const zoom = Math.round(zoomForLongitudeDelta(cam.longitudeDelta));

  const sc = new Supercluster({ ...CLUSTER_TUNING });
  sc.load(
    uniq.map((h) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: [h.lon, h.lat] as [number, number] },
    })),
  );

  const before = uniq.filter(
    (h) => h.lat >= b.south && h.lat <= b.north && h.lon >= b.west && h.lon <= b.east,
  ).length;
  const at = (z: number) => sc.getClusters([b.west, b.south, b.east, b.north], z).length;

  rows.push({
    pick: r.name,
    files: scope.regions.length,
    huts_loaded: uniq.length,
    parse_ms: +parseMs.toFixed(0),
    open_zoom: zoom,
    markers_before: before,
    markers_now: at(zoom),
    at_z11: at(11),
    at_z13: at(13),
    cut: `${Math.round((1 - at(zoom) / before) * 100)}%`,
  });
}
rows.sort((a, b) => b.markers_before - a.markers_before);

console.log(`HALO_KM=${HALO_KM}  cluster=${JSON.stringify(CLUSTER_TUNING)}\n`);
console.table(rows);
const mean = (k: string) => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length);
console.log(
  `\nmean markers at opening camera: ${mean('markers_before')} -> ${mean('markers_now')}` +
    `   (mean ${mean('huts_loaded')} huts loaded, ${mean('parse_ms')} ms parse)`,
);
console.log(`worst case now: ${Math.max(...rows.map((r) => r.markers_now))} markers`);
