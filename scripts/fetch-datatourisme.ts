/**
 * Fetch the DATAtourisme flux and report what actually arrived.
 *
 * ⚠️ DELIBERATELY NOT A PARSER YET. The flux can arrive as a single JSON-LD
 * document, as NDJSON, or as a zip of an index plus one file per POI, and
 * which one depends on how the flux was configured. Writing a parser for a
 * shape nobody has looked at is how this project got a 60% coverage figure
 * that was really 29%. Run this first, look, then write the matcher.
 *
 * ⚠️ tsx DOES NOT LOAD .env. It has silently handed scripts `undefined` here
 * before and made them measure the wrong thing entirely, so the file is parsed
 * by hand and a missing or unsubstituted key is a loud failure, not an empty
 * result.
 *
 * Licence: Etalab Open Licence. Commercial use is fine; each record must cite
 * its `hasBeenCreatedBy` and the dataset's last update date.
 *
 * Run: tsx scripts/fetch-datatourisme.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = join(ROOT, '.env');
const OUT = join(ROOT, 'assets', 'data', '.datatourisme-raw');

function fromEnvFile(key: string): string | undefined {
  if (!existsSync(ENV)) return undefined;
  for (const line of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

async function main() {
  const url = process.env.DATATOURISME_FLUX_URL ?? fromEnvFile('DATATOURISME_FLUX_URL');

  if (!url) {
    console.error('DATATOURISME_FLUX_URL is not set in .env — nothing to fetch.');
    process.exit(1);
  }
  if (url.includes('{app_key}') || url.includes('{APP_KEY}')) {
    console.error(
      'DATATOURISME_FLUX_URL still contains the literal {app_key} placeholder.\n' +
      '  Open .env and replace it with the application key from\n' +
      '  diffuseur.datatourisme.fr (Applications → your application).\n' +
      '  The key stays in .env, which is gitignored.',
    );
    process.exit(1);
  }

  // Never print the URL: it embeds the key.
  console.log('fetching the flux...');
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'AlpineHutsApp/1.0 (hut photo index; build script)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    console.error(`the request failed: ${(e as Error).name}`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`HTTP ${res.status}. A 401/403 means the application key is wrong or the flux is not published yet.`);
    process.exit(1);
  }

  const type = res.headers.get('content-type') ?? '(none)';
  const buf = new Uint8Array(await res.arrayBuffer());
  console.log(`content-type: ${type}`);
  console.log(`size: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  // Magic bytes settle what it is far more reliably than the header.
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  const head = Buffer.from(buf.slice(0, 400)).toString('utf8');

  if (isZip) {
    const path = `${OUT}.zip`;
    writeFileSync(path, buf);
    console.log(`\nIt is a ZIP archive -> ${path}`);
    console.log('Unpack with:  Expand-Archive -Path "<that file>" -DestinationPath "<a folder>"');
    return;
  }
  if (isGzip) {
    const path = `${OUT}.gz`;
    writeFileSync(path, buf);
    console.log(`\nIt is gzipped -> ${path}`);
    return;
  }

  const path = `${OUT}.json`;
  writeFileSync(path, buf);
  console.log(`\nfirst bytes:\n${head.replace(/\s+/g, ' ').slice(0, 300)}\n`);
  try {
    const json = JSON.parse(Buffer.from(buf).toString('utf8'));
    const arr = Array.isArray(json) ? json : (json['@graph'] ?? json.data ?? json.items ?? null);
    if (Array.isArray(arr)) {
      console.log(`parsed: ${arr.length.toLocaleString()} records`);
      console.log(`top-level keys of the first: ${Object.keys(arr[0] ?? {}).slice(0, 25).join(', ')}`);
    } else {
      console.log(`parsed an object; keys: ${Object.keys(json).slice(0, 25).join(', ')}`);
    }
  } catch {
    console.log('not a single JSON document — may be NDJSON (one object per line).');
    const lines = Buffer.from(buf).toString('utf8').split('\n').filter(Boolean);
    console.log(`${lines.length.toLocaleString()} lines; first parses: ${(() => { try { JSON.parse(lines[0]); return 'yes'; } catch { return 'no'; } })()}`);
  }
  console.log(`-> ${path}`);
}

main();
