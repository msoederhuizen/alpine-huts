/* TEMP — systematic coverage-gap audit of the REGIONS tiling.

   Rasterises the region boxes and looks for uncovered cells that are SANDWICHED
   between covered ones (covered to both N and S, or both E and W, within a short
   distance). Open country outside the Alps fails that test, so what's left are
   genuine seams between tiles — like the Hasliberg one that hid Hotel Wetterhorn.
   Delete after running. */
import { REGIONS } from '../src/constants/region';

const STEP = 0.02; // ~2.2 km
const REACH = 12; // how far to look for a covering cell (~26 km)

const south = Math.min(...REGIONS.map((r) => r.bbox.south));
const north = Math.max(...REGIONS.map((r) => r.bbox.north));
const west = Math.min(...REGIONS.map((r) => r.bbox.west));
const east = Math.max(...REGIONS.map((r) => r.bbox.east));

const rows = Math.ceil((north - south) / STEP);
const cols = Math.ceil((east - west) / STEP);
const latOf = (y: number) => south + y * STEP;
const lonOf = (x: number) => west + x * STEP;

const covered: boolean[][] = [];
for (let y = 0; y < rows; y++) {
  covered[y] = [];
  for (let x = 0; x < cols; x++) {
    const lat = latOf(y) + STEP / 2;
    const lon = lonOf(x) + STEP / 2;
    covered[y][x] = REGIONS.some(
      (r) =>
        lat >= r.bbox.south &&
        lat <= r.bbox.north &&
        lon >= r.bbox.west &&
        lon <= r.bbox.east,
    );
  }
}

function hit(y: number, x: number, dy: number, dx: number): boolean {
  for (let i = 1; i <= REACH; i++) {
    const ny = y + dy * i;
    const nx = x + dx * i;
    if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) return false;
    if (covered[ny][nx]) return true;
  }
  return false;
}

// sandwiched = enclosed on an axis => a seam, not open country
const suspect: boolean[][] = [];
for (let y = 0; y < rows; y++) {
  suspect[y] = [];
  for (let x = 0; x < cols; x++) {
    if (covered[y][x]) {
      suspect[y][x] = false;
      continue;
    }
    const ns = hit(y, x, 1, 0) && hit(y, x, -1, 0);
    const ew = hit(y, x, 0, 1) && hit(y, x, 0, -1);
    suspect[y][x] = ns || ew;
  }
}

// flood-fill suspect cells into contiguous gaps
const seen: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
const gaps: { cells: number; s: number; n: number; w: number; e: number }[] = [];
for (let y = 0; y < rows; y++) {
  for (let x = 0; x < cols; x++) {
    if (!suspect[y][x] || seen[y][x]) continue;
    const stack = [[y, x]];
    seen[y][x] = true;
    let cells = 0;
    let s = 90;
    let n = -90;
    let w = 180;
    let e = -180;
    while (stack.length) {
      const [cy, cx] = stack.pop()!;
      cells++;
      s = Math.min(s, latOf(cy));
      n = Math.max(n, latOf(cy) + STEP);
      w = Math.min(w, lonOf(cx));
      e = Math.max(e, lonOf(cx) + STEP);
      for (const [dy, dx] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ny = cy + dy;
        const nx = cx + dx;
        if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
        if (suspect[ny][nx] && !seen[ny][nx]) {
          seen[ny][nx] = true;
          stack.push([ny, nx]);
        }
      }
    }
    gaps.push({ cells, s, n, w, e });
  }
}

gaps.sort((a, b) => b.cells - a.cells);
const km2 = (g: (typeof gaps)[0]) =>
  Math.round(
    (g.n - g.s) * 111 * (g.e - g.w) * 111 * Math.cos(((g.s + g.n) / 2 / 180) * Math.PI),
  );

console.log(`grid ${rows}x${cols} @ ${STEP}deg — ${gaps.length} enclosed gap(s)\n`);
console.table(
  gaps.slice(0, 12).map((g) => ({
    'approx km2': km2(g),
    south: g.s.toFixed(2),
    north: g.n.toFixed(2),
    west: g.w.toFixed(2),
    east: g.e.toFixed(2),
    neighbours: REGIONS.filter(
      (r) =>
        r.bbox.south <= g.n + 0.3 &&
        r.bbox.north >= g.s - 0.3 &&
        r.bbox.west <= g.e + 0.3 &&
        r.bbox.east >= g.w - 0.3,
    )
      .map((r) => r.id)
      .join(', ')
      .slice(0, 60),
  })),
);
