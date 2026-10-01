/**
 * Merge the Alpenverein hut register into the app's data.
 *
 * The register covers 933 huts of the Austrian, German and South Tyrolean
 * alpine clubs, with a telephone number, the hut's own website, an altitude, a
 * hut-reservation.org id and an altitude.
 *
 * ⚠️ THE REGISTER ALSO CARRIES PUBLIC-TRANSPORT ACCESS (nearest station, bus
 * stop, where to park) AND THIS DELIBERATELY DOES NOT TAKE IT. It reached only
 * 509 of 24,000 places — about 6% of mountain huts and 1.4% overall — and a
 * "Getting there" section that is blank on nineteen huts out of twenty teaches
 * people to stop looking at it. Removed on the app author's instruction
 * 2026-09-30; the register fields are still there if coverage ever changes.
 *
 * ⚠️ POSITION MATCHING, THE SAME AS EVERY OTHER IMPORT. See the long note at
 * the top of `lib/place-matcher.ts`; the rules and their reasons all live there
 * so the two importers cannot drift apart.
 *
 * ⚠️ IT ONLY FILLS GAPS, and writes its OWN overlay file rather than touching
 * the region bundles. `src/data/contactOverlay.ts` layers the overlays with the
 * hand-checked spreadsheet on top, so re-running `generate-huts` never fights
 * either of them.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT DO: it never calls hut-reservation.org. That
 * site has a public API which would give a cleaner phone number, a bed count and
 * a photograph for the 259 huts that carry an id — but those are a third
 * party's records and their photographs are of unknown licence, and this
 * project's rule is that photos come from the hut's OWN site. The id is used to
 * build a booking LINK and nothing more.
 *
 *   npm run import-alpenverein -- "path/to/huts find 2.json"           # report
 *   npm run import-alpenverein -- "path/to/huts find 2.json" --write
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appPlaces,
  isPlaceholderName,
  pickField,
  samePhone,
  sameSite,
} from './lib/app-places';
import { type Provenance, writeProvenance } from './lib/provenance';
import {
  MAX_METRES,
  MAX_METRES_UNCORROBORATED,
  corroborate,
  matchByPosition,
  type SourceRow,
} from './lib/place-matcher';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'data', 'alpenverein-overlay.json');
const SOURCE = process.argv[2];
const WRITE = process.argv.includes('--write');
const ALL = process.argv.includes('--all');

interface Record_ {
  id: string;
  name: string;
  elevation?: string | null;
  link?: string | null;
  phone?: string | null;
  lat: number;
  lon: number;
  hutReservationId?: string | null;
  websites?: string[] | null;
}

interface Row extends SourceRow {
  phone?: string;
  website?: string;
  elevation?: string;
  booking?: string;
}

/**
 * Turn the register's telephone string into one dialable number.
 *
 * ⚠️ THE APP PUTS THIS STRAIGHT INTO A `tel:` LINK, so the shape matters. The
 * register writes numbers the Austrian way and annotates them freely:
 *
 *   "+39/375/9738950 (nur WhatsApp)"
 *   "+43/664/4050951 oder +43/664/3811240"
 *   "+39/0473/669711 Sattelit: +43 720 920 439"
 *   "+43/(0)6564 21200"
 *
 * The slashes are group separators, not second numbers. "(0)" is the German
 * trunk prefix, which must be DROPPED when the number is written with a country
 * code — keeping it dials a wrong number. Where two numbers really are given,
 * the first is the hut's own and the rest are a section office or a satellite
 * phone, so the first is the one to keep.
 */
function parsePhone(raw: string): string | undefined {
  let s = raw.trim();
  // Cut at a second number, however it is introduced.
  s = s.split(/\s+oder\s+|\s*[;,]\s*|\s+[A-Za-zÄÖÜäöü.]+\s*:\s*/)[0];
  // Drop a trailing note: "(nur WhatsApp)", "(Hütte)", "(Sektion)".
  s = s.replace(/\([^)]*[A-Za-zÄÖÜäöü][^)]*\)/g, ' ');
  s = s.replace(/\(0\)/g, '');
  s = s.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
  // What is left must look like a telephone number, or it is not worth keeping.
  if (!/^\+?[\d\s-]{6,}$/.test(s)) return undefined;
  return s;
}

/** "2262 m" -> "2262", and nothing at all if it is not a plausible altitude. */
function parseElevation(raw: string): string | undefined {
  const n = Number(String(raw).replace(/[^\d]/g, ''));
  if (!Number.isFinite(n) || n < 150 || n > 4600) return undefined;
  return String(n);
}

/**
 * A direct booking page, verified against the site rather than guessed: the
 * public endpoint /api/v1/reservation/hutInfo/276 returns "Sesvennahütte",
 * which is what the register gives id 276, and this URL renders that hut's
 * booking wizard. Without an id the app already falls back to the site's
 * front page, which makes the walker search for their hut by hand.
 */
const bookingUrl = (id: string) => `https://www.hut-reservation.org/reservation/book-hut/${id}/wizard`;

function parse(): Row[] {
  const raw = JSON.parse(readFileSync(SOURCE, 'utf8')) as Record_[];
  const out: Row[] = [];
  for (const r of raw) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    out.push({
      name: r.name ?? '',
      lat: r.lat,
      lon: r.lon,
      phone: r.phone ? parsePhone(r.phone) : undefined,
      // 54 records list more than one address; the first is the hut's own and
      // the rest are usually the owning section's.
      website: r.websites?.[0] ?? undefined,
      elevation: r.elevation ? parseElevation(r.elevation) : undefined,
      booking: r.hutReservationId ? bookingUrl(r.hutReservationId) : undefined,
    });
  }
  return out;
}

function main() {
  if (!SOURCE || !existsSync(SOURCE)) {
    console.error('usage: npm run import-alpenverein -- "<path to the .json>" [--write]');
    process.exit(1);
  }

  const rows = parse();
  const huts = appPlaces();
  console.log(`${rows.length.toLocaleString()} huts in the register`);
  console.log(`${huts.length.toLocaleString()} places in the app\n`);

  const m = matchByPosition(rows, huts);
  const overlay: Record<string, Record<string, string>> = {};
  const provenance: Record<string, Provenance> = {};
  const gains = { website: 0, phone: 0, elevation: 0, booking: 0, name: 0 };
  const examples: string[] = [];
  const contested: string[] = [];
  let contestedFields = 0;
  let notALodging = 0;
  let tooFar = 0;
  let disagreed = 0;

  for (const [id, list] of m.claims) {
    const hut = m.byId.get(id)!;
    const nearest = list.reduce((a, b) => (b.m < a.m ? b : a));
    const rows_ = list.map((c) => c.row);

    const field = (get: (r: Row) => string | undefined, same?: (v: string) => string) => {
      const r = pickField(rows_, get, same);
      if (r.conflict) {
        contestedFields++;
        if (contested.length < 10) {
          contested.push(`${hut.name ?? '(unnamed)'}  ${r.conflict.map((v) => `"${v}"`).join('  vs  ')}`);
        }
      }
      return r.value;
    };

    const verdict = corroborate(nearest.row.name, undefined, hut, nearest.m, isPlaceholderName);
    if (!verdict.write) {
      if (verdict.why === 'not-a-lodging') notALodging++;
      else tooFar++;
      continue;
    }
    if (verdict.disagrees) {
      disagreed++;
      examples.push(
        `${String(Math.round(nearest.m)).padStart(4)} m  "${nearest.row.name}"  vs app "${hut.name ?? '(unnamed)'}"`,
      );
    }

    const tags = hut.tags ?? {};
    const add: Record<string, string> = {};

    const website = field((r) => r.website, sameSite);
    if (website && !(tags.website || tags['contact:website'] || tags.url || hut.website)) {
      add.website = website;
      gains.website++;
    }
    const phone = field((r) => r.phone, samePhone);
    if (phone && !(tags.phone || tags['contact:phone'])) { add.phone = phone; gains.phone++; }

    const ele = field((r) => r.elevation);
    if (ele && !tags.ele && hut.elevation == null) { add.ele = ele; gains.elevation++; }

    const booking = field((r) => r.booking, sameSite);
    if (booking && !hut.reservationWebsite && !tags['reservation:website']) {
      add.booking = booking;
      gains.booking++;
    }

    if (nearest.row.name && (!hut.name || isPlaceholderName(hut.name))) {
      add.name = nearest.row.name;
      gains.name++;
    }

    if (Object.keys(add).length) {
      provenance[id] = {
        source: 'alpenverein',
        appName: hut.name ?? '(unnamed)',
        lat: hut.lat,
        lon: hut.lon,
        rowName: nearest.row.name,
        metres: Math.round(nearest.m),
        how: nearest.how,
        insteadOf: nearest.insteadOf,
        nameDisagrees: Boolean(verdict.write && verdict.disagrees),
        fields: add,
        alsoClaimedBy: list.length > 1 ? list.filter((c) => c !== nearest).map((c) => c.row.name) : undefined,
      };
    }
    if (Object.keys(add).length) overlay[id] = add;
  }

  console.log(`matched on position (≤${MAX_METRES} m)   ${m.matched.toLocaleString()}`);
  console.log(`  of those, names disagree        ${disagreed}   <- inspect these`);
  console.log(`  refused, row is not a lodging   ${notALodging}`);
  console.log(`  refused, unconfirmed past ${MAX_METRES_UNCORROBORATED} m  ${tooFar}`);
  console.log(`  fields dropped, rows conflict   ${contestedFields}`);
  console.log(`moved onto the place that carries the name ${m.redirected}`);
  console.log(`matched further out on an exact name  ${m.widened}`);
  console.log(`  ambiguous out there, skipped        ${m.ambiguous}`);
  console.log(`no place found at all                 ${m.unmatched.toLocaleString()}\n`);
  console.log('fields the app is missing and this fills:');
  for (const [k, v] of Object.entries(gains)) console.log(`  ${k.padEnd(11)} ${v.toLocaleString()}`);
  console.log(`\nplaces gaining at least one field: ${Object.keys(overlay).length.toLocaleString()}`);

  if (examples.length) {
    console.log('\nname disagreements, FURTHEST FIRST — the far ones are the suspects:');
    examples.sort((a, b) => parseInt(b) - parseInt(a));
    for (const e of ALL ? examples : examples.slice(0, 12)) console.log('  ' + e);
    if (!ALL && examples.length > 12) console.log(`  … ${examples.length - 12} more, all closer (--all)`);
  }

  if (m.redirectedRows.length) {
    console.log('\nmoved off a NEARER place onto the one that carries the name:');
    for (const r of m.redirectedRows) console.log('  ' + r);
  }

  if (m.widenedRows.length) {
    // Every one of these was matched on the NAME, which this importer otherwise
    // refuses to do — so they are all printed, every run.
    console.log('\nmatched beyond 250 m because the name is unmistakable — check these:');
    m.widenedRows.sort((a, b) => parseInt(b) - parseInt(a));
    for (const w of m.widenedRows) console.log('  ' + w);
  }

  if (contested.length) {
    console.log('\ntwo rows on one place disagreed on a field — that field skipped:');
    for (const c of contested) console.log('  ' + c);
  }

  if (WRITE) {
    writeFileSync(OUT, JSON.stringify(overlay, null, 1));
    writeProvenance(OUT.replace(/.json$/, '-provenance.json'), provenance);
    console.log(`\n-> ${OUT}`);
  } else {
    console.log('\n(report only — pass --write to save the overlay)');
  }
}

main();
