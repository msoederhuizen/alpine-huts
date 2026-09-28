/**
 * Photos a person has looked at and said are wrong.
 *
 * ⚠️ DELETING A ROW FROM photo-index.json DOES NOT STICK. Every photo file in
 * this project is GENERATED — by generate-photo-index, generate-refuges-photos,
 * brave-find-images — so a correction made by hand survives exactly until the
 * next regeneration, which then fetches the same wrong picture again from the
 * same place. The same trap as a hut that closed: the fix has to live where the
 * rebuild will see it.
 *
 * So this list is the durable record, and the generators consult it. A
 * correction made here is made once.
 *
 * `url: "*"` blocks every photo for that place — right when the source itself
 * is matching the wrong building. A specific URL blocks only that image, which
 * leaves the door open for a better one from elsewhere.
 *
 * ⚠️ IT IS NOT A LIST OF BAD PLACES, ONLY BAD PICTURES. Nothing here removes a
 * hut from the app; a place that no longer exists is a different problem with
 * its own path (see supabase/migrations/0004_place_reports.sql), fixed in
 * OpenStreetMap rather than here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'assets', 'data', 'photo-blocklist.json');

export interface BlockedPhoto {
  hutId: string;
  name?: string;
  /** A full image URL, or `*` for every photo of this place. */
  url: string;
  why: string;
  date?: string;
}

let cached: BlockedPhoto[] | null = null;

export function blocklist(): BlockedPhoto[] {
  if (cached) return cached;
  try {
    cached = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as BlockedPhoto[]) : [];
  } catch {
    // A malformed blocklist must not take a build down, but it must be loud:
    // silently ignoring it would quietly reinstate every photo it holds.
    console.error('⚠️  photo-blocklist.json could not be read — NO photos are being blocked.');
    cached = [];
  }
  return cached;
}

/**
 * The identity of an image, for comparison.
 *
 * ⚠️ WITHOUT THE QUERY STRING, BECAUSE THE SAME PICTURE ARRIVES WITH DIFFERENT
 * ONES. Commons appends `?utm_source=…&utm_campaign=imageinfo` to what it hands
 * back, hotel CDNs append sizing like `?h=426&w=565`, and those change between
 * runs. An exact string match therefore failed to block a photo that WAS in the
 * list, and — worse — reported nothing, because a rule that matches nothing
 * looks identical to a rule with nothing to do.
 *
 * The path is what identifies the image; the query is decoration.
 */
function identity(url: string): string {
  const i = url.indexOf('?');
  return (i === -1 ? url : url.slice(0, i)).toLowerCase();
}

/** Everything blocked for a place, as a set of URLs plus a whole-place flag. */
export function blockedFor(hutId: string): { all: boolean; urls: Set<string> } {
  const rows = blocklist().filter((b) => b.hutId === hutId);
  return {
    all: rows.some((b) => b.url === '*'),
    urls: new Set(rows.filter((b) => b.url !== '*').map((b) => identity(b.url))),
  };
}

/**
 * True when this photo should not be shown for this hut.
 *
 * ⚠️ SCOPED TO ONE PLACE, ALWAYS. `url: "*"` blocks every photo OF THIS HUT —
 * it never means "every photo from that host". Another hut with a Commons photo
 * is unaffected, which is the whole point of keying on the hut id.
 */
export function isBlocked(hutId: string, url: string): boolean {
  const b = blockedFor(hutId);
  return b.all || b.urls.has(identity(url));
}
