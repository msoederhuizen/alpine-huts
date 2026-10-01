/**
 * Apply the reviewed Alpenverein-register candidates — huts that OSM does not
 * carry as lodging and a person has confirmed are real.
 *
 * ⚠️ THESE ARE THE HARD CASES, WHICH IS WHY THEY NEEDED A HUMAN. Everything OSM
 * knows was recovered by regenerating; everything out of scope was filtered by
 * region. What is left is the residue: places OSM genuinely lacks, mixed in with
 * apartments and farm B&Bs the register also lists. Only somebody who can read
 * "Ferienwohnung Jennewein und Almhütte Unterstalleralm" and judge it can sort
 * those, which is exactly what the CSV asked for.
 *
 * ⚠️ IT ALSO TAKES CORRECTIONS. The reviewed file carries a `Name` column for a
 * better name than the register's, and a `website` column — "Oberseehütte
 * (Staller-See-Ht.)" is really the Alpengasthaus Obersee, and the register did
 * not know its website. Those corrections are the point of the review, not a
 * side effect of it.
 *
 *   npm run apply-register-csv -- "path/to/reviewed.csv"
 *   npm run apply-register-csv -- "path/to/reviewed.csv" --write
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut, HutType } from '../src/types/hut';
import {
  appOsmPlaces,
  isRealSite,
  isRefused,
  metres,
  readCsv,
  writeRegionPlaces,
} from './lib/reviewed-csv';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'data', 'register-places.json');
const SOURCE = process.argv[2];
const WRITE = process.argv.includes('--write');

/** The prefix every place from this import carries, so it can be replaced. */
const PREFIX = 'register/';

const TYPES = new Set<HutType>(['alpine_hut', 'wilderness_hut', 'shelter', 'guesthouse']);

function main() {
  if (!SOURCE) {
    console.error('usage: npm run apply-register-csv -- "<reviewed .csv>" [--write]');
    process.exit(1);
  }

  const { head, rows } = readCsv(SOURCE);
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
  const C = {
    keep: col('keep'), type: col('type'), name: col('name'),
    lat: col('latitude'), lon: col('longitude'), ele: col('elevation'),
    site: col('website'), phone: col('phone'), region: col('region'),
  };
  // The reviewer's better name sits in a SECOND column also called "name",
  // added to the right of the original — so find the last one, not the first.
  const renameCol = head.reduce((last, h, i) => (h === 'name' && i !== C.name ? i : last), -1);

  const existing = appOsmPlaces([PREFIX, 'refuges/']);
  const places: Array<Hut & { regionId: string }> = [];
  let refused = 0;
  let nowInOsm = 0;
  const renamed: string[] = [];
  const oddities: string[] = [];

  for (const r of rows) {
    if (isRefused(r[C.keep])) { refused++; continue; }

    const original = (r[C.name] ?? '').trim();
    const lat = Number(r[C.lat]);
    const lon = Number(r[C.lon]);
    const regionId = (r[C.region] ?? '').trim();
    if (!original || !Number.isFinite(lat) || !Number.isFinite(lon) || !regionId) continue;

    // The register's own type column, lower-cased: one row came back as
    // "Wilderness_hut", and a capital letter is not a reason to drop a hut.
    const type = (r[C.type] ?? '').trim().toLowerCase() as HutType;
    if (!TYPES.has(type)) { oddities.push(`${original}: unknown type "${r[C.type]}"`); continue; }

    let covered: Hut | undefined;
    for (const o of existing) {
      if (metres(lat, lon, o.lat, o.lon) <= 250) { covered = o; break; }
    }
    if (covered) { nowInOsm++; continue; }

    /**
     * ⚠️ A RENAME CELL HOLDING A URL IS A PASTE SLIP, NOT A NAME. One row's
     * better-name column contains "https://www.leonhardhuette.at/" — plainly
     * the hut's website that landed one column left. Taking it literally would
     * put a URL on the map as a hut's name; treating it as the website recovers
     * what was meant, and the original name stands.
     */
    const suggested = (renameCol >= 0 ? r[renameCol] ?? '' : '').trim();
    let name = original;
    let siteFromRename: string | undefined;
    if (suggested && suggested !== original) {
      if (/^https?:\/\//i.test(suggested)) {
        siteFromRename = suggested;
        oddities.push(`${original}: name column held a URL, used as the website instead`);
      } else {
        name = suggested;
        renamed.push(`${original}  ->  ${suggested}`);
      }
    }

    const supplied = (r[C.site] ?? '').trim();
    const website =
      siteFromRename && isRealSite(siteFromRename) ? siteFromRename
      : supplied && isRealSite(supplied) ? supplied
      : undefined;

    const phone = (r[C.phone] ?? '').trim() || undefined;
    const ele = Number(String(r[C.ele] ?? '').replace(/[^\d]/g, ''));

    const tags: Record<string, string> = { name, source: 'alpenverein-register' };
    if (website) tags.website = website;
    if (phone) tags.phone = phone;
    if (Number.isFinite(ele) && ele >= 150 && ele <= 4600) tags.ele = String(ele);

    places.push({
      id: `${PREFIX}${lat.toFixed(5)},${lon.toFixed(5)}`,
      regionId,
      name,
      lat,
      lon,
      type,
      website,
      elevation: tags.ele ? Number(tags.ele) : undefined,
      bookingUrl: 'https://www.hut-reservation.org/',
      tags,
    });
  }

  console.log(`${rows.length} reviewed rows`);
  console.log(`  refused                     ${refused}`);
  console.log(`  already covered by OSM      ${nowInOsm}`);
  console.log(`  to add                      ${places.length}`);

  const byType: Record<string, number> = {};
  for (const p of places) byType[p.type] = (byType[p.type] ?? 0) + 1;
  console.log('\nby type:   ' + Object.entries(byType).map(([k, v]) => `${k} ${v}`).join('   '));
  console.log(`with a website ${places.filter((p) => p.website).length}` +
    `, a phone ${places.filter((p) => p.tags.phone).length}` +
    `, an altitude ${places.filter((p) => p.tags.ele).length}`);

  if (renamed.length) {
    console.log('\nrenamed to the reviewer\'s name:');
    for (const x of renamed) console.log('  ' + x);
  }
  if (oddities.length) {
    console.log('\nneeded a judgement call:');
    for (const x of oddities) console.log('  ' + x);
  }

  if (!WRITE) {
    console.log('\n(report only — pass --write to save)');
    return;
  }

  writeFileSync(OUT, JSON.stringify(places, null, 1));
  const { added, removed } = writeRegionPlaces(PREFIX, places);
  console.log(`\n-> ${OUT}`);
  console.log(`-> region files: removed ${removed} previous entries, wrote ${added}`);
}

main();
