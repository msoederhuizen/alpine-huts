/**
 * Merge a hand-built hut spreadsheet into the app's data — website, phone,
 * warden, altitude — for places that are missing them.
 *
 * ⚠️ MATCHED ON POSITION, NOT ON NAME, AND THAT IS THE WHOLE DESIGN. The
 * spreadsheet spells huts as a person would: "Blüemlisalphütte SAC",
 * "Memminger Hütte", with ß, umlauts, SAC/DAV suffixes and punctuation that
 * OSM may or may not share. Every source in this project matched by NAME has
 * attached the wrong building — a human review rejected 46% of the Brave photo
 * set, and the residue was always a correct name in the wrong place. Every
 * source matched by POSITION has been right.
 *
 * So the name is never the key. Two huts 40 m apart with different spellings
 * are the same hut; two huts with identical names 200 km apart are not. The
 * name is used only to CORROBORATE a positional match, never to make one.
 *
 * ⚠️ IT ONLY FILLS GAPS. An existing value in the app's data is never
 * overwritten: OSM is the licensed source of record and a spreadsheet cannot
 * silently replace it. This writes a separate overlay file, leaving the region
 * bundles untouched so the next `generate-huts` run does not fight it.
 *
 *   npm run import-hut-database -- "path/to/Hut database.xlsx"           # report
 *   npm run import-hut-database -- "path/to/Hut database.xlsx" --write   # save
 *
 * The report is the point: read it before passing --write. It prints every
 * match the NAME rather than the position had to justify, every place two rows
 * fought over, and every row it refused — those lists are how a bad import is
 * caught, and they are short enough to actually read.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import type { Hut } from '../src/types/hut';
import { appPlaces, isPlaceholderName, pickField, samePhone, sameSite } from './lib/app-places';
import { type Provenance, writeProvenance } from './lib/provenance';
import {
  MAX_METRES,
  MAX_METRES_UNCORROBORATED,
  corroborate,
  matchByPosition,
  type SourceRow,
} from './lib/place-matcher';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'data', 'hut-contact-overlay.json');
const SOURCE = process.argv[2];
const WRITE = process.argv.includes('--write');
const ALL = process.argv.includes('--all');

/**
 * The worksheet XML, from either a .xlsx file or a directory someone already
 * unzipped. Both are accepted because both turn up: the file is what gets
 * handed over, the directory is what you have when you were mid-investigation.
 */
function sheetXml(file: string): string {
  if (statSync(SOURCE).isDirectory()) {
    return readFileSync(join(SOURCE, 'xl', 'worksheets', file), 'utf8');
  }
  const xml = unzipEntry(readFileSync(SOURCE), `xl/worksheets/${file}`);
  if (!xml) throw new Error(`${SOURCE} has no xl/worksheets/${file}`);
  return xml;
}

/**
 * The workbook's sheets, by their real tab names.
 *
 * ⚠️ NEVER ASSUME sheet2.xml IS THE SECOND TAB, OR THE ONLY ONE THAT MATTERS.
 * An earlier version read `sheet2.xml` and nothing else, which silently ignored
 * the "HH dataset" and "HH unmatched" tabs entirely — 87 more huts, with
 * booking links the app has nowhere else. The file name and the tab order are
 * not the same thing either: the mapping lives in workbook.xml and its rels,
 * and it is cheap to read.
 */
function sheetFiles(): Map<string, string> {
  const rels = statSync(SOURCE).isDirectory()
    ? readFileSync(join(SOURCE, 'xl', '_rels', 'workbook.xml.rels'), 'utf8')
    : (unzipEntry(readFileSync(SOURCE), 'xl/_rels/workbook.xml.rels') ?? '');
  const wb = statSync(SOURCE).isDirectory()
    ? readFileSync(join(SOURCE, 'xl', 'workbook.xml'), 'utf8')
    : (unzipEntry(readFileSync(SOURCE), 'xl/workbook.xml') ?? '');

  // Attribute order is not guaranteed, so each element is matched whole and its
  // attributes picked out individually.
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const to = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && to) target.set(id, to.replace(/^\/?(xl\/)?worksheets\//, ''));
  }

  const out = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = m[0].match(/name="([^"]*)"/)?.[1];
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
    const file = rid ? target.get(rid) : undefined;
    if (name && file) out.set(name, file);
  }
  return out;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Pull one file out of a .xlsx, which is a ZIP archive.
 *
 * ⚠️ READS THE CENTRAL DIRECTORY, NOT THE LOCAL HEADERS. A local header is
 * allowed to carry zero for both sizes and defer them to a descriptor written
 * AFTER the compressed data (general-purpose bit 3), which several writers do.
 * The central directory at the end of the file always has the real sizes and
 * offsets, so it is the only one worth parsing.
 *
 * This exists so the script takes the spreadsheet as it was handed over. The
 * earlier version wanted a directory someone had already unzipped, which is a
 * step that gets forgotten and then silently reports zero rows.
 */
function unzipEntry(zip: Buffer, want: string): string | undefined {
  // End-of-central-directory record: scan back from the end for its signature.
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');

  let at = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);

  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory');
    const method = zip.readUInt16LE(at + 10);
    const compSize = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8');

    if (name === want) {
      // The LOCAL header's extra field can differ in length from the central
      // one's, so the data offset has to be computed from the local header.
      const lNameLen = zip.readUInt16LE(localAt + 26);
      const lExtraLen = zip.readUInt16LE(localAt + 28);
      const from = localAt + 30 + lNameLen + lExtraLen;
      const raw = zip.subarray(from, from + compSize);
      return (method === 0 ? raw : inflateRawSync(raw)).toString('utf8');
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
}

/** Minimal xlsx reader: inline strings only, which is what this file uses. */
function readSheet(file: string): Record<string, string>[] {
  const xml = sheetXml(file);
  const rows: Record<string, string>[] = [];
  for (const rm of xml.matchAll(/<row[^>]*?r="(\d+)"[^>]*?>([\s\S]*?)<\/row>/g)) {
    const cells: Record<string, string> = {};
    for (const cm of rm[2].matchAll(/<c\s[^>]*?r="([A-Z]+)\d+"[\s\S]*?(?:\/>|<\/c>)/g)) {
      const t = cm[0].match(/<t[^>]*>([\s\S]*?)<\/t>/);
      const v = cm[0].match(/<v>([\s\S]*?)<\/v>/);
      const val = t ? unescapeXml(t[1]) : v ? v[1] : '';
      if (val !== '') cells[cm[1]] = val;
    }
    rows.push(cells);
  }
  return rows;
}

interface Row {
  name: string;
  aliases: string;
  lat: number;
  lon: number;
  altitude?: string;
  phone?: string;
  warden?: string;
  website?: string;
  club?: string;
  /** "yes" / "no" — becomes the OSM `dog` tag, which the app already renders. */
  dog?: string;
  /** A hut2hut/huetten-holiday reservation page. */
  booking?: string;
}

/** Rows with a name but NO coordinate: reported, never placed. */
const placeless: string[] = [];

/**
 * Every data row in the workbook, from all three hut tabs.
 *
 * ⚠️ THE TABS DO NOT SHARE A COLUMN VOCABULARY. "All huts" says "Hut name",
 * "Latitude", "Alpine club"; the two Hut2Hut tabs say "name", "lat", and have
 * `bookingUrl` and `dogfriendly` instead. So every column is looked up by a
 * LIST of possible headings rather than one, and a tab missing a column simply
 * contributes nothing for it.
 */
function parse(): Row[] {
  const files = sheetFiles();
  const out: Row[] = [];

  for (const [tab, file] of files) {
    const raw = readSheet(file);
    if (!raw.length) continue;
    const header = raw[0];
    const col = (...labels: string[]) =>
      Object.entries(header).find(([, v]) =>
        labels.some((l) => v.trim().toLowerCase() === l.toLowerCase()),
      )?.[0];

    const C = {
      name: col('Hut name', 'name'),
      aliases: col('Aliases'),
      lat: col('Latitude', 'lat'),
      lon: col('Longitude', 'lon'),
      // "Altitude (m)" holds a bare number; the HH "altitude" holds "2242m".
      // Prefer the clean one, fall back to the other.
      alt: col('Altitude (m)') ?? col('Altitude', 'altitude'),
      phone: col('Phone', 'phone'),
      warden: col('Warden', 'warden'),
      site: col('Website', 'website'),
      club: col('Alpine club'),
      dog: col('Dog friendly', 'dogfriendly'),
      booking: col('Hut2Hut booking URL', 'bookingUrl'),
    };
    // The Summary tab has none of these and is skipped by this test alone.
    if (!C.name || !C.lat || !C.lon) continue;

    for (const r of raw.slice(1)) {
      const name = r[C.name] ?? '';
      const lat = Number(r[C.lat]);
      const lon = Number(r[C.lon]);
      /**
       * ⚠️ NO COORDINATE MEANS NO MATCH, AND THAT HAS TO BE SAID OUT LOUD. 31
       * rows of "All huts" have both cells empty. Skipping them silently is how
       * a row count quietly disagrees with the spreadsheet — which is exactly
       * how this was noticed. Nothing here can place them: matching a bare name
       * against 35,830 places is the one thing this script refuses to do.
       */
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        if (name) placeless.push(`${tab}: ${name}`);
        continue;
      }
      out.push({
        name,
        aliases: C.aliases ? (r[C.aliases] ?? '') : '',
        lat,
        lon,
        altitude: C.alt ? r[C.alt] : undefined,
        phone: C.phone ? r[C.phone] : undefined,
        warden: C.warden ? r[C.warden] : undefined,
        website: C.site ? r[C.site] : undefined,
        club: C.club ? r[C.club] : undefined,
        dog: C.dog ? r[C.dog] : undefined,
        booking: C.booking ? r[C.booking] : undefined,
      });
    }
  }
  return out;
}

/**
 * Read an altitude out of the spreadsheet, or refuse to.
 *
 * ⚠️ THE COLUMN MIXES THREE FORMATS AND A NAIVE PARSE PRODUCES NONSENSE. Simply
 * stripping non-digits turned "2.089" into 2.089 metres, and the app would have
 * shown the Braunschweiger Hütte as two metres above sea level.
 *
 *   "2840"   plain metres
 *   "2.089"  a DOT AS THOUSANDS SEPARATOR, the German and Italian convention
 *   "1.64"   the same, with Excel having dropped the trailing zero — 1,640 m
 *
 * The third is the trap, because 1.64 is a perfectly ordinary number. The data
 * settles it: the spreadsheet holds the Berghaus Kleinwalsertal twice, once as
 * "1.25" and once as "1250". Padding the fraction back out to three digits
 * reproduces every known elevation — Karlsbader Hütte "2.26" -> 2260 m,
 * Stripsenjochhaus "1.58" -> 1580 m, Kölner Haus "1.965" -> 1965 m.
 *
 * ⚠️ AND IT REFUSES RATHER THAN GUESSES. A handful of cells hold "25", "12",
 * "17" — not elevations at all. Nothing outside a plausible band is written,
 * because a wrong altitude on a mountain hut is worse than none.
 */
function parseAltitude(raw: string): string | undefined {
  const s = raw.trim().replace(/\s|m$/gi, '');
  const dotted = s.match(/^(\d)\.(\d{1,3})$/);
  const metres = dotted ? Number(dotted[1] + dotted[2].padEnd(3, '0')) : Number(s.replace(/[^\d]/g, ''));
  // Zugspitze is 2,962 m and the Mont Blanc huts reach 4,300; the lowest places
  // in the app are German mid-range huts a little under 200 m.
  if (!Number.isFinite(metres) || metres < 150 || metres > 4600) return undefined;
  return String(metres);
}

function main() {
  if (!SOURCE || !existsSync(SOURCE)) {
    console.error('usage: npm run import-hut-database -- "<path to the .xlsx>" [--write]');
    process.exit(1);
  }

  const rows = parse();
  const huts = appPlaces();
  console.log(
    `${(rows.length + placeless.length).toLocaleString()} rows across the workbook's hut tabs`,
  );
  console.log(`  ${placeless.length} of them have no coordinate and cannot be placed`);
  console.log(`${huts.length.toLocaleString()} places in the app\n`);

  const m = matchByPosition(rows, huts);
  const overlay: Record<string, Record<string, string>> = {};
  const provenance: Record<string, Provenance> = {};
  const gains = {
    website: 0, phone: 0, club: 0, warden: 0, altitude: 0, dog: 0, booking: 0, name: 0,
  };
  const examples: string[] = [];
  const contested: string[] = [];
  let contestedFields = 0;
  let notALodging = 0;
  let tooFarUnconfirmed = 0;
  let nameDisagreed = 0;

  for (const [id, list] of m.claims) {
    const hut = m.byId.get(id)!;
    const picked = list.reduce((a, b) => (b.m < a.m ? b : a));

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

    const digits = (v: string) => v.replace(/\D/g, '').replace(/^00/, '');
    const site = (v: string) => v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
    const row: Row = {
      ...picked.row,
      phone: field((r) => r.phone, samePhone),
      website: field((r) => r.website, sameSite),
      booking: field((r) => r.booking, sameSite),
      warden: field((r) => r.warden),
      club: field((r) => r.club),
      dog: field((r) => r.dog, (v) => v.trim().toLowerCase()),
      // Compare the parsed metres: "1.25" and "1250" are the same elevation
      // written two ways, which is how the format was identified in the first
      // place — it would be perverse to then report it as a disagreement.
      altitude: field((r) => r.altitude, (v) => parseAltitude(v) ?? v),
    };
    const verdict = corroborate(row.name, row.aliases, hut, picked.m, isPlaceholderName);
    if (!verdict.write) {
      if (verdict.why === 'not-a-lodging') notALodging++;
      else tooFarUnconfirmed++;
      continue;
    }
    if (verdict.disagrees) {
      nameDisagreed++;
      examples.push(`${String(Math.round(picked.m)).padStart(4)} m  "${row.name}"  vs app "${hut.name ?? '(unnamed)'}"`);
    }

    const add: Record<string, string> = {};
    const tags = hut.tags ?? {};
    /**
     * ⚠️ "MISSING" MEANS MISSING THE WAY THE APP SEES IT, NOT THE WAY OSM
     * STORES IT, and the two are not the same. `hut.website` is built from
     * `website || contact:website || url`, so a place can have a live link with
     * no `website` tag at all; `elevation` survives on places whose `ele` tag
     * the generator has already consumed; and the detail screen falls back from
     * `operator` to `owner`, so filling `operator` on a place that has `owner`
     * changes what is displayed.
     *
     * Testing only the tags wrote 46 fields the app would never have shown, and
     * counted them as gains. The runtime merge re-checks and would have dropped
     * them silently — which is the right safety net and the wrong place to rely
     * on, because the report is how this import is judged before it ships.
     */
    if (row.website && !(tags.website || tags['contact:website'] || tags.url || hut.website)) {
      add.website = row.website;
      gains.website++;
    }
    if (row.phone && !(tags.phone || tags['contact:phone'])) { add.phone = row.phone; gains.phone++; }
    /**
     * ⚠️ THE CLUB AND THE WARDEN ARE NOT THE SAME FIELD, and an earlier version
     * put both into `operator`. OSM's `operator` is the organisation that runs
     * the place — "SAC", "DAV Memmingen" — which is what the detail screen
     * prints beside the hut type. The warden is a PERSON, "Jürg Martig", and
     * printing a name there reads as though the hut is called that. They now go
     * to different tags and show on different lines.
     */
    if (row.club && !(tags.operator || tags.owner)) { add.operator = row.club; gains.club++; }
    if (row.warden && !tags['contact:person']) { add.warden = row.warden; gains.warden++; }
    const ele = row.altitude ? parseAltitude(row.altitude) : undefined;
    if (ele && !tags.ele && hut.elevation == null) { add.ele = ele; gains.altitude++; }

    /**
     * Dog-friendliness needs no new UI: `parseFacilities` already turns an OSM
     * `dog` tag into a paw icon reading "Dogs allowed" or "No dogs". The column
     * says yes/no for 555 places, and a definite NO is as worth showing as a
     * yes — it is the thing people ring ahead to ask.
     */
    const dog = row.dog?.trim().toLowerCase();
    if ((dog === 'yes' || dog === 'no') && !tags.dog) { add.dog = dog; gains.dog++; }

    if (row.booking && !hut.reservationWebsite && !tags['reservation:website']) {
      add.booking = row.booking;
      gains.booking++;
    }
    /**
     * ⚠️ A REAL NAME WHERE OSM HAS A PLACEHOLDER IS THE MOST VALUABLE FIELD HERE,
     * and the only one that is not merely contact detail. Hundreds of places in
     * the app are called "Wilderness hut" or "Alpine hut" because that is all
     * OSM has — and a place with no name is unreachable by every photo source in
     * the project, all of which search by name. "Capanna Tomeo" 10 m away is the
     * handle those sources need.
     *
     * Only ever fills a blank or a placeholder; a real OSM name always wins.
     */
    if (row.name && (!hut.name || isPlaceholderName(hut.name))) {
      add.name = row.name;
      gains.name++;
    }
    if (Object.keys(add).length) {
      provenance[id] = {
        source: 'spreadsheet',
        appName: hut.name ?? '(unnamed)',
        lat: hut.lat,
        lon: hut.lon,
        rowName: picked.row.name,
        metres: Math.round(picked.m),
        how: picked.how,
        insteadOf: picked.insteadOf,
        nameDisagrees: Boolean(verdict.write && verdict.disagrees),
        fields: add,
        alsoClaimedBy: list.length > 1 ? list.filter((c) => c !== picked).map((c) => c.row.name) : undefined,
      };
    }
    if (Object.keys(add).length) overlay[hut.id] = add;
  }

  console.log(`matched on position (≤${MAX_METRES} m)   ${m.matched.toLocaleString()}`);
  console.log(`  of those, names disagree        ${nameDisagreed}   <- inspect these`);
  console.log(`  refused, row is not a lodging   ${notALodging}`);
  console.log(`  refused, unconfirmed past ${MAX_METRES_UNCORROBORATED} m  ${tooFarUnconfirmed}`);
  console.log(`  fields dropped, rows conflict   ${contestedFields}`);
  console.log(`moved onto the place that carries the name ${m.redirected}`);
  console.log(`matched further out on an exact name  ${m.widened}`);
  console.log(`  ambiguous out there, skipped        ${m.ambiguous}`);
  console.log(`no place found at all                 ${m.unmatched.toLocaleString()}\n`);
  console.log('fields the app is missing and this fills:');
  for (const [k, v] of Object.entries(gains)) console.log(`  ${k.padEnd(10)} ${v.toLocaleString()}`);
  console.log(`\nplaces gaining at least one field: ${Object.keys(overlay).length.toLocaleString()}`);

  if (examples.length) {
    // Furthest first, because distance is what separates the two kinds: a
    // disagreement at 5 m is one hut named in two languages, which the Alps are
    // full of, and the far end of this list is where a wrong match shows up.
    // `--all` prints the tail as well, which is how the 60 m cut-off was found.
    console.log('\nname disagreements, FURTHEST FIRST — the far ones are the suspects:');
    examples.sort((a, b) => parseInt(b) - parseInt(a));
    for (const e of ALL ? examples : examples.slice(0, 14)) console.log('  ' + e);
    if (!ALL && examples.length > 14) console.log(`  … ${examples.length - 14} more, all closer (--all)`);
  }

  if (m.redirectedRows.length) {
    console.log('\nmoved off a NEARER place onto the one that carries the name:');
    for (const r of m.redirectedRows) console.log('  ' + r);
  }

  if (m.widenedRows.length) {
    // Every one of these was matched on the NAME, which is the thing this
    // script otherwise refuses to do — so they are all printed, every run, and
    // none of them is hidden behind a flag.
    console.log('\nmatched beyond 250 m because the name is unmistakable — check these:');
    m.widenedRows.sort((a, b) => parseInt(b) - parseInt(a));
    for (const w of m.widenedRows) console.log('  ' + w);
  }

  if (contested.length) {
    console.log('\ntwo rows on one place disagreed on a field — that field skipped:');
    for (const c of contested.slice(0, 10)) console.log('  ' + c);
  }

  if (placeless.length) {
    // Printed in full: it is a short, fixable list, and the fix is a coordinate
    // in the spreadsheet rather than anything this script can do.
    console.log(`\n${placeless.length} rows have a name but no latitude/longitude — add one and re-run:`);
    for (const p of placeless) console.log('  ' + p);
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
