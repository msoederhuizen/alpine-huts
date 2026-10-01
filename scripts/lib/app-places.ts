/**
 * The places the app ships, read straight off the region bundles.
 *
 * Deliberately NOT through `src/data/hutBundle.ts`: that applies the contact
 * overlay, and an importer that saw its own previous output would decide every
 * gap was already filled and write nothing the second time it ran.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../../src/types/hut';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function appPlaces(): Hut[] {
  const dir = join(ROOT, 'assets', 'data', 'regions');
  const byId = new Map<string, Hut>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, Hut[]>;
    /**
     * ⚠️ VILLAGES ARE CANDIDATES TOO, AND LEAVING THEM OUT WAS WORSE THAN
     * INCLUDING THEM. Without them the row "Hinterzarten" could not find the
     * app's village of that name and settled on the hotel "Stuub Hinterzarten"
     * 699 m away, writing a tourist office's details onto one business. With
     * them present the row sees both, cannot choose, and is skipped — which is
     * the correct outcome. `typeCompatible` then keeps hut rows off villages.
     */
    for (const b of ['core', 'accommodations', 'villages']) {
      for (const h of d[b] ?? []) if (!byId.has(h.id)) byId.set(h.id, h);
    }
  }
  return [...byId.values()];
}

/**
 * Names OSM uses when it has none — the app renders these verbatim, so a place
 * carrying one is effectively nameless and unreachable by every photo source in
 * the project, all of which search by name.
 */
export function isPlaceholderName(name: string): boolean {
  return /^(Unnamed (shelter|hut)|Bivouac|Weather shelter|Lean-to shelter|Rock shelter|Transport shelter|Picnic shelter|Shelter|Wilderness hut|Alpine hut)$/.test(
    name.trim(),
  );
}

/** Compare telephone numbers by their digits: "+41 81 822 12 52" == "+41818221252". */
export const samePhone = (v: string) => v.replace(/\D/g, '').replace(/^00/, '');

/** Compare URLs ignoring scheme, www and a trailing slash. */
export const sameSite = (v: string) =>
  v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();

/**
 * Pick one value for a field from every row that claimed this place.
 *
 * ⚠️ WHEN TWO ROWS FALL ON ONE PLACE, THE CONFLICT IS PER FIELD, NOT PER ROW.
 * Nearly every such pair is the SAME hut typed twice with a different spelling —
 * "Ostpreussenhütte" and "Ostpreußenhütte", "Sidelen-Hütte" and "Sidelenhütte" —
 * and those rows carry the same telephone number, so there is nothing to resolve
 * and dropping both would throw away good data over a punctuation mark.
 *
 * A few are genuinely two buildings sharing one OSM node ("Meilerhütte" and
 * "Alte Meilerhütte"). Those disagree where it matters: two different phone
 * numbers for one place. So compare the VALUES, on a normalised form but
 * returning the original. One distinct value means the rows are duplicates and
 * it is safe; two means we cannot tell whose it is, and only that field is
 * dropped — the fields they agree on still land.
 */
export function pickField<R>(
  rows: R[],
  get: (r: R) => string | undefined,
  same: (v: string) => string = (v) => v,
): { value?: string; conflict?: string[] } {
  const vals = new Map<string, string>();
  for (const r of rows) {
    const v = get(r)?.trim();
    if (v && !vals.has(same(v))) vals.set(same(v), v);
  }
  if (vals.size === 1) return { value: [...vals.values()][0] };
  if (vals.size > 1) return { conflict: [...vals.values()] };
  return {};
}
