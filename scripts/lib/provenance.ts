/**
 * A record of WHY each place was changed, written beside every overlay.
 *
 * ⚠️ THE OVERLAY ALONE IS NOT REVIEWABLE. It says "this hut gained this phone
 * number" and nothing about where that came from, how far the source row was,
 * or whether the two names agreed — which is exactly what someone checking for
 * errors needs. Without it, reviewing means re-running the importer and reading
 * a console, and errors hide in the 800 uninteresting rows.
 *
 * Written to the scratch file `<overlay>-provenance.json`, which is gitignored:
 * it is a review aid, not shipped data, and it would otherwise double the diff
 * of every import.
 */
import { writeFileSync } from 'node:fs';

import type { How } from './place-matcher';

export interface Provenance {
  /** Which import wrote it. */
  source: string;
  /** The app's place, as it is today. */
  appName: string;
  lat: number;
  lon: number;
  region?: string;
  /** The row that claimed it, and how far away the row's coordinate was. */
  rowName: string;
  metres: number;
  how: How;
  /** For a redirect: the nearer place the match was moved off. */
  insteadOf?: { name: string; m: number };
  /** True when the two names do not corroborate each other. */
  nameDisagrees: boolean;
  /** Field -> the value written. */
  fields: Record<string, string>;
  /** Other rows that also landed here, if any. */
  alsoClaimedBy?: string[];
}

/**
 * How much a human should worry about this one, highest first.
 *
 * ⚠️ REVIEW ORDER IS THE WHOLE POINT. 800 correct rows will bury a dozen wrong
 * ones if the list is alphabetical, and the reviewer gives up before reaching
 * them. Risk is ranked by how much the NAME had to do the work that POSITION
 * normally does, plus how visible the change is:
 *
 *   a renamed place  — changes the first thing anyone sees
 *   a redirect       — position said one hut, the name overruled it
 *   a widened match  — nothing was near; the name alone found it
 *   a disagreement   — close enough, but the names do not corroborate
 *   contested        — more than one row landed here
 *   plain            — near, and the names agree
 */
export function risk(p: Provenance): number {
  let n = 0;
  if (p.fields.name) n += 100;
  if (p.how === 'redirected') n += 60;
  if (p.how === 'widened') n += 50;
  if (p.nameDisagrees) n += 40;
  if (p.alsoClaimedBy?.length) n += 20;
  // Within a band, further away is more doubtful.
  n += Math.min(p.metres / 100, 19);
  return n;
}

export function writeProvenance(path: string, rows: Record<string, Provenance>): void {
  writeFileSync(path, JSON.stringify(rows, null, 1));
}
