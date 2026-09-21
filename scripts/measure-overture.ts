/**
 * How many of our photoless, websiteless places can Overture actually give a
 * website for — and how many of those would be the RIGHT website?
 *
 * ⚠️ PROXIMITY ALONE IS NOT A MATCH HERE, and this is the whole question.
 * refuges.info could be matched on coordinates and nothing else, because every
 * point in it IS a refuge: the nearest one within 150 m could not be a
 * different kind of thing. Overture is a general business directory. Within
 * 500 m of a village guesthouse there are, on average, 24 places with websites,
 * and most of them are a bakery.
 *
 * So the measurement has to be of coordinate AND name together, using the same
 * name logic the Commons matching uses. Run:
 *   tsx scripts/measure-overture.ts <candidates.csv>
 */
import { readFileSync } from 'node:fs';

import {
  distinctiveTokens,
  normalizePlaceName,
  textNamesPlace,
} from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';

const CSV = process.argv[2];
if (!CSV) {
  console.error('usage: tsx scripts/measure-overture.ts <candidates.csv>');
  process.exit(1);
}

interface Row {
  id: string;
  name: string;
  type: string;
  ov_name: string;
  website: string;
  confidence: number;
  operating_status: string;
  metres: number;
}

function parseCsv(text: string): Row[] {
  const out: Row[] = [];
  const lines = text.split('\n');
  const cols = lines[0].split(',');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const v: string[] = [];
    let cur = '';
    let q = false;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (q) {
        if (c === '"' && line[k + 1] === '"') { cur += '"'; k++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { v.push(cur); cur = ''; }
      else cur += c;
    }
    v.push(cur);
    const r: Record<string, string> = {};
    cols.forEach((c, j) => (r[c.trim()] = v[j] ?? ''));
    out.push({
      id: r.id, name: r.name, type: r.type, ov_name: r.ov_name, website: r.website,
      confidence: Number(r.confidence), operating_status: r.operating_status,
      metres: Number(r.metres),
    });
  }
  return out;
}

const rows = parseCsv(readFileSync(CSV, 'utf8'));

// Group the candidates by our place.
const byTarget = new Map<string, Row[]>();
for (const r of rows) {
  if (!byTarget.has(r.id)) byTarget.set(r.id, []);
  byTarget.get(r.id)!.push(r);
}

/**
 * Does the Overture name name OUR place?
 *
 * ⚠️ A WEAKER TEST THAN THE COMMONS ONE, on purpose. `distinctiveTokens` drops
 * generic words so that searching a global corpus for "Berghaus" does not match
 * four hundred things — and it is right to. But it leaves NOTHING for "Hotel
 * Coma" or "Gîte de Nève", so those scored as disagreeing with themselves,
 * verbatim, at 5 m.
 *
 * The coordinates have already done the discriminating here. The name only has
 * to corroborate, so when there are no distinctive tokens, an identical or
 * contained normalised name is accepted — evidence that is weak in general and
 * strong once you are standing on the building.
 */
function namesAgree(ours: string, theirs: string): boolean {
  if (!theirs || isFallbackHutName(ours)) return false;
  const a = normalizePlaceName(ours);
  const b = normalizePlaceName(theirs);
  if (!a || !b) return false;
  const tokens = distinctiveTokens(a);
  if (tokens.length) return textNamesPlace(b, tokens);
  return a === b || b.includes(a) || a.includes(b);
}

let nameMatch100 = 0, nameMatch500 = 0, soleWithin25 = 0, noneUseful = 0;
const examples: string[] = [];
const wrongLooking: string[] = [];

/** ⚠️ THE NUMBER THAT MATTERS IS PER TYPE, not the total. The worked examples
 *  are Andorran valley hotels, which is exactly where a business directory is
 *  strong and exactly where this app is least interesting. If the 3,719 are all
 *  hotels and no huts, the headline overstates the value. */
const hit: Record<string, number> = {};
const seen: Record<string, number> = {};
const bumpHit = (t: string) => (hit[t] = (hit[t] ?? 0) + 1);

for (const [, cands] of byTarget) {
  seen[cands[0].type] = (seen[cands[0].type] ?? 0) + 1;
  const ours = cands[0].name;
  const live = cands.filter(
    (c) => c.operating_status !== 'permanently_closed' && c.website,
  );
  const agreed = live
    .filter((c) => namesAgree(ours, c.ov_name))
    .sort((a, b) => a.metres - b.metres);

  if (agreed.length && agreed[0].metres <= 100) {
    nameMatch100++;
    bumpHit(cands[0].type);
    if (examples.length < 8) {
      examples.push(
        `${ours}  ~  ${agreed[0].ov_name}  (${agreed[0].metres.toFixed(0)} m)  ${agreed[0].website}`,
      );
    }
    continue;
  }
  if (agreed.length) { nameMatch500++; bumpHit(cands[0].type); continue; }

  // No name agreement. Is there exactly ONE thing essentially on top of us?
  // An isolated mountain building has no neighbours to be confused with.
  const close = live.filter((c) => c.metres <= 25);
  if (close.length === 1) {
    soleWithin25++;
    if (wrongLooking.length < 8) {
      wrongLooking.push(
        `${ours}  ~?  ${close[0].ov_name}  (${close[0].metres.toFixed(0)} m)  ${close[0].website}`,
      );
    }
    continue;
  }
  noneUseful++;
}

const TOTAL = 11594;
const reached = byTarget.size;
console.log(`${TOTAL.toLocaleString()} places have no photo and no website`);
console.log(`${reached.toLocaleString()} of them have ANY Overture place with a website within 500 m\n`);
console.log(`  name agrees, within 100 m   ${String(nameMatch100).padStart(5)}   <- trustworthy`);
console.log(`  name agrees, 100-500 m      ${String(nameMatch500).padStart(5)}   <- probably right`);
console.log(`  no name match, sole <25 m   ${String(soleWithin25).padStart(5)}   <- a guess, see below`);
console.log(`  nothing usable              ${String(noneUseful).padStart(5)}`);
console.log(`  no candidate at all         ${String(TOTAL - reached).padStart(5)}`);
const good = nameMatch100 + nameMatch500;
console.log(`\n  DEFENSIBLE TOTAL (name agrees): ${good.toLocaleString()}  ${((good / TOTAL) * 100).toFixed(1)}% of the gap`);

console.log('\n  by type (of those Overture had any candidate for):');
for (const t of Object.keys(seen).sort((a, b) => (seen[b] ?? 0) - (seen[a] ?? 0))) {
  const h = hit[t] ?? 0;
  console.log(
    `    ${t.padEnd(16)} ${String(h).padStart(5)} matched of ${String(seen[t]).padStart(5)} reached  ` +
    `(${Math.round((h / seen[t]) * 100)}%)`,
  );
}

console.log('\n  name agreed:');
for (const e of examples) console.log(`    ${e}`);
console.log('\n  sole neighbour within 25 m, name does NOT agree — would these be right?');
for (const e of wrongLooking) console.log(`    ${e}`);
