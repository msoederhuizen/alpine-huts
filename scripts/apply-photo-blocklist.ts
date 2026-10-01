/**
 * Strip every blocked photo out of the generated files.
 *
 * Run after adding to assets/data/photo-blocklist.json, and again after any
 * regeneration — the generators consult the list, but this makes an existing
 * file correct without waiting hours for a rebuild.
 *
 *   npm run apply-photo-blocklist
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { blocklist, isBlocked } from './photoBlocklist';
import { BLOCKED_PHOTO_HOSTS, isBlockedPhotoHost } from './lib/photo-sources';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f: string) => join(ROOT, 'assets', 'data', f);

interface Photo { url: string }

function prune(file: string): { removed: number; emptied: number } {
  const path = D(file);
  if (!existsSync(path)) return { removed: 0, emptied: 0 };
  const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Photo[] | Photo>;
  let removed = 0;
  let emptied = 0;

  for (const [hutId, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const kept = value.filter((p) => !isBlocked(hutId, p.url) && !isBlockedPhotoHost(p.url));
      if (kept.length === value.length) continue;
      removed += value.length - kept.length;
      if (kept.length) data[hutId] = kept;
      else { delete data[hutId]; emptied++; }
    } else if (value && typeof value === 'object' && 'url' in value) {
      // brave-images.json holds ONE photo per place, not an array.
      const u = (value as Photo).url;
      if (!isBlocked(hutId, u) && !isBlockedPhotoHost(u)) continue;
      delete data[hutId];
      removed++;
      emptied++;
    }
  }

  if (removed) writeFileSync(path, JSON.stringify(data));
  return { removed, emptied };
}

function main() {
  const rows = blocklist();
  console.log(`${rows.length} entries in the blocklist\n`);
  if (!rows.length) return;

  let total = 0;
  for (const f of ['photo-index.json', 'refuges-photos.json', 'brave-images.json', 'openverse-photos.json']) {
    const { removed, emptied } = prune(f);
    total += removed;
    console.log(`  ${f.padEnd(24)} removed ${String(removed).padStart(3)}   places left with none: ${emptied}`);
  }

  console.log(`\n${total} photo${total === 1 ? '' : 's'} removed.`);

  /**
   * ⚠️ AN ENTRY THAT MATCHED NOTHING IS THE FAILURE WORTH REPORTING, and the
   * first version of this check missed it — it only listed entries still
   * present, so a URL that matched nothing at all passed silently. That is
   * exactly what happened: the blocklist said `upload.wikimedia.org` while the
   * index held `thumb.wikimedia.org`, so "Combi e Lanza" was never removed and
   * nothing said so. A blocklist that quietly does nothing is worse than none,
   * because it is believed.
   */
  const files = ['photo-index.json', 'refuges-photos.json', 'brave-images.json', 'openverse-photos.json']
    .filter((f) => existsSync(D(f)))
    .map((f) => JSON.parse(readFileSync(D(f), 'utf8')) as Record<string, unknown>);

  const stillThere = rows.filter((b) =>
    files.some((data) => {
      const v = data[b.hutId];
      if (Array.isArray(v)) return b.url === '*' ? v.length > 0 : v.some((p: Photo) => isBlocked(b.hutId, p.url));
      if (v && typeof v === 'object' && 'url' in v) {
        return b.url === '*' || isBlocked(b.hutId, (v as Photo).url);
      }
      return false;
    }),
  );

  if (stillThere.length) {
    console.log('\n⚠️  BLOCKED BUT STILL PRESENT — the URL in the blocklist does not match the data:');
    for (const b of stillThere) console.log(`   ${b.hutId}  ${b.name ?? ''}`);
    process.exitCode = 1;
  }
}

main();
