/**
 * Re-apply the current acceptance rules to websites already found.
 *
 * Costs no searches: the URLs are on disk, and the rules that let the wrong
 * ones in have since been tightened. Running this is always cheaper than
 * searching again, and it means a rule fixed today cleans up yesterday's
 * results rather than only helping future runs.
 *
 *   tsx scripts/prune-brave-websites.ts [--apply]
 *
 * Reports by default; only writes with --apply.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { distinctiveTokens, normalizePlaceName } from '../src/utils/dedupePlaces';
import { PORTAL, registrableDomain } from './siteDomain';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'assets', 'data', 'brave-websites.json');
const APPLY = process.argv.includes('--apply');

interface Found { url: string; why: string; name: string }

function main() {
  if (!existsSync(FILE)) {
    console.log('nothing to prune');
    return;
  }
  const data: Record<string, Found> = JSON.parse(readFileSync(FILE, 'utf8'));
  const kept: Record<string, Found> = {};
  const dropped: { name: string; url: string; reason: string }[] = [];

  for (const [id, v] of Object.entries(data)) {
    const host = v.url.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    if (PORTAL.test(host)) {
      dropped.push({ name: v.name, url: v.url, reason: 'booking or tourism portal' });
      continue;
    }
    const bare = registrableDomain(host);
    const flat = normalizePlaceName(bare.replace(/[.-]/g, ' '));
    const squashed = bare.replace(/[^a-z0-9]/g, '');
    const tokens = distinctiveTokens(normalizePlaceName(v.name));
    const hits = tokens.filter((t) => flat.includes(t) || squashed.includes(t));
    if (!hits.length) {
      dropped.push({ name: v.name, url: v.url, reason: `name not in ${bare}` });
      continue;
    }
    kept[id] = v;
  }

  console.log(`${Object.keys(data).length} held`);
  console.log(`${Object.keys(kept).length} kept`);
  console.log(`${dropped.length} dropped\n`);
  for (const d of dropped.slice(0, 30)) {
    console.log(`  ${d.name.slice(0, 26).padEnd(28)} ${d.url.slice(0, 52).padEnd(54)} ${d.reason}`);
  }
  if (dropped.length > 30) console.log(`  … and ${dropped.length - 30} more`);

  if (APPLY) {
    writeFileSync(FILE, JSON.stringify(kept, null, 0));
    console.log(`\nwritten: ${Object.keys(kept).length} remain in ${FILE}`);
  } else {
    console.log('\n(report only — pass --apply to write)');
  }
}

main();
