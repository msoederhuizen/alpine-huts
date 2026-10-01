/**
 * Rescue the refusals that only exist in a reviewer's own copy of a CSV.
 *
 * ⚠️ WRITTEN BECAUSE THE DECISIONS WERE ABOUT TO BE LOST, NOT AS A ROUTINE
 * STEP. Until `recordRejections` existed, applying a reviewed file obeyed the
 * "No" rows and then forgot them: the approvals became region data, the
 * refusals became nothing at all. The only record of 16 judgements about
 * holiday apartments, a valley pension and two farm B&Bs was a file in the
 * reviewer's Downloads folder.
 *
 * Point it at any reviewed CSV that has a `keep?` column:
 *   tsx scripts/backfill-rejections.ts <source> "<path to reviewed csv>"
 */
import { isRefused, readCsv, recordRejections } from './lib/reviewed-csv';

const [source, path] = process.argv.slice(2);
if (!source || !path) {
  console.error('usage: tsx scripts/backfill-rejections.ts <source> <reviewed.csv>');
  process.exit(1);
}

const { head, rows } = readCsv(path);
const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
const C = { keep: col('keep'), name: col('name'), lat: col('latitude', 'lat'), lon: col('longitude', 'lon') };
if (C.keep < 0 || C.name < 0 || C.lat < 0 || C.lon < 0) {
  console.error('could not find keep?/name/latitude/longitude columns in', path);
  process.exit(1);
}

const refused = rows
  .filter((r) => isRefused(r[C.keep]))
  .map((r) => ({ name: (r[C.name] ?? '').trim(), lat: Number(r[C.lat]), lon: Number(r[C.lon]) }))
  .filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon));

console.log(`${rows.length} reviewed rows, ${refused.length} marked No`);
for (const r of refused) console.log(`  ${r.name}`);

const { added, total } = recordRejections(source, refused);
console.log(`\nremembered ${added} new (${total} in all)`);
