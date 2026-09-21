/**
 * Build-time: find each place's website in Overture Maps, by COORDINATE.
 *
 * WHY THIS AND NOT A SEARCH API. The job is "given a name and a position, find
 * the website", and a web search answers a different question — "what pages
 * mention these words" — handing back the name-ambiguity problem that has
 * caused every wrong photo in this project. Overture's places are point
 * geometries, so position does the discriminating and the name only has to
 * corroborate. Measured against Brave's free tier: ~3,900 websites versus
 * ~500, for nothing, in about a minute.
 *
 * ⚠️ PROXIMITY IS NOT A MATCH ON ITS OWN. refuges.info could be matched on
 * coordinates alone because every point in it IS a refuge. Overture is a
 * general business directory: within 500 m of a village guesthouse there are
 * about two dozen places with websites, and coordinate-only matching cheerfully
 * returns the supermarket. Measured rejections from exactly that bucket:
 *
 *   Hôtel de la Gare  ->  sncf.fr      (the railway's site)
 *   Résidence Orfea   ->  Photomaton   (a photo booth)
 *   Roc del Castell   ->  Caprabo      (a supermarket)
 *
 * So a candidate must agree on BOTH position and name.
 *
 * Needs the DuckDB CLI — a single standalone binary, no install:
 *   https://duckdb.org/docs/installation/   (or `winget install DuckDB.cli`)
 * Point DUCKDB_PATH at it, or have `duckdb` on PATH.
 *
 * Run: npm run generate-overture-websites
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import {
  distinctiveTokens,
  normalizePlaceName,
  textNamesPlace,
} from '../src/utils/dedupePlaces';
import { isFallbackHutName } from '../src/utils/hutMeta';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGIONS = join(ROOT, 'assets', 'data', 'regions');
const PHOTO_INDEX = join(ROOT, 'assets', 'data', 'photo-index.json');
const REFUGES = join(ROOT, 'assets', 'data', 'refuges-photos.json');
const OUT = join(ROOT, 'assets', 'data', 'overture-websites.json');

/**
 * Overture publishes monthly. Bump this to pick up a newer release; the path is
 * the only thing that changes. Listed at https://docs.overturemaps.org/release/
 */
const RELEASE = '2026-08-19.0';
const S3 = `s3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/*`;

/**
 * How far an Overture point may sit from ours and still be the same building.
 *
 * ⚠️ TWO THRESHOLDS, because distance and name strength trade off. The two
 * datasets geocode differently — one takes the door, the other a roof centroid
 * — so 500 m is not unreasonable for a genuine match, and "Rifugio Magnolini"
 * sits 433 m from "Rifugio Magnolini". But at that range a merely OVERLAPPING
 * name starts collecting neighbours: measured rejects were
 *
 *   Rifugio Belvedere  ~  Belvedere Ski Area   495 m
 *   ENCAMP             ~  Pij Encamp           486 m   (the town council)
 *   Casa Sestrales     ~  Los Sestrales…       485 m
 *
 * So past NEAR_METRES the names must be the same name, not merely related.
 */
const NEAR_METRES = 200;
const MAX_METRES = 500;

/**
 * Sites that are somebody's listing OF the place rather than the place's own.
 * Their photo would be credited to the aggregator and often is not this
 * building at all. Hotel GROUPS are deliberately absent: hotansa.com really is
 * Hotel Roc Meler's own site, and hilton.com really is that hotel's page.
 */
const AGGREGATOR =
  /(booking\.com|tripadvisor|expedia|hotels\.com|airbnb|agoda|trivago|hrs\.de|hostelworld|kayak|orbitz|priceline|placestars|yelp\.|foursquare|facebook\.com|instagram\.com)/i;

interface Match {
  url: string;
  /** Kept so a wrong photo can be traced back to the row that caused it. */
  name: string;
  metres: number;
  confidence: number;
}

/**
 * Does the Overture name name OUR place?
 *
 * ⚠️ DELIBERATELY WEAKER than the Commons name test. `distinctiveTokens` drops
 * generic words so that searching all of Wikimedia for "Berghaus" does not
 * match four hundred files — correct there, wrong here: it leaves NOTHING for
 * "Hotel Coma" or "Gîte de Nève", which then scored as disagreeing with
 * themselves, verbatim, five metres apart. The coordinates have already done
 * the discriminating, so when there are no distinctive tokens an identical or
 * contained name is accepted. That recovered 249 places.
 */
function namesAgree(ours: string, theirs: string, metres: number): boolean {
  if (!theirs || isFallbackHutName(ours)) return false;
  const a = normalizePlaceName(ours);
  const b = normalizePlaceName(theirs);
  if (!a || !b) return false;
  // Beyond NEAR_METRES, only the same name counts — see the constant.
  if (metres > NEAR_METRES) return a === b;
  const tokens = distinctiveTokens(a);
  if (tokens.length) return textNamesPlace(b, tokens);
  return a === b || b.includes(a) || a.includes(b);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n');
  if (!lines.length) return [];
  const cols = lines[0].split(',').map((c) => c.trim());
  const out: Record<string, string>[] = [];
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
    const row: Record<string, string> = {};
    cols.forEach((c, j) => (row[c] = v[j] ?? ''));
    out.push(row);
  }
  return out;
}

function main() {
  const duckdb = process.env.DUCKDB_PATH ?? 'duckdb';

  // ── Who still needs a website ─────────────────────────────────────────────
  const idx: Record<string, unknown[]> = existsSync(PHOTO_INDEX)
    ? JSON.parse(readFileSync(PHOTO_INDEX, 'utf8'))
    : {};
  const refuges: Record<string, unknown[]> = existsSync(REFUGES)
    ? JSON.parse(readFileSync(REFUGES, 'utf8'))
    : {};

  const byId = new Map<string, Hut>();
  for (const f of readdirSync(REGIONS).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(REGIONS, f), 'utf8')) as Record<string, Hut[]>;
    for (const b of ['core', 'accommodations']) {
      for (const h of d[b] ?? []) if (h.name && !byId.has(h.id)) byId.set(h.id, h);
    }
  }

  const usable = (raw?: string) => {
    if (!raw) return null;
    const t = raw.trim().split(/[\s,;]/)[0];
    return t && /^([a-z]+:\/\/)?[^/\s.]+\.[^/\s]+/i.test(t) ? t : null;
  };
  // Only places that have NO photo and NO website: anywhere else, Overture would
  // be answering a question already answered by a better source.
  const targets = [...byId.values()].filter(
    (h) => !refuges[h.id]?.length && !idx[h.id]?.length && !usable(h.website),
  );
  if (!targets.length) {
    console.log('every place already has a photo or a website — nothing to do');
    return;
  }

  // Bbox of the targets, with a small margin. Queried remotely, so a tight box
  // is the difference between a minute and a very long download.
  const pad = 0.2;
  const minLon = Math.min(...targets.map((h) => h.lon)) - pad;
  const maxLon = Math.max(...targets.map((h) => h.lon)) + pad;
  const minLat = Math.min(...targets.map((h) => h.lat)) - pad;
  const maxLat = Math.max(...targets.map((h) => h.lat)) + pad;

  console.log(`${targets.length.toLocaleString()} places have no photo and no website`);
  console.log(`bbox  lon ${minLon.toFixed(2)}..${maxLon.toFixed(2)}  lat ${minLat.toFixed(2)}..${maxLat.toFixed(2)}`);
  console.log(`overture release ${RELEASE}\n`);

  const work = mkdtempSync(join(tmpdir(), 'overture-'));
  const targetsCsv = join(work, 'targets.csv').replace(/\\/g, '/');
  const candidatesCsv = join(work, 'candidates.csv').replace(/\\/g, '/');
  const sqlFile = join(work, 'q.sql');

  writeFileSync(
    targetsCsv,
    ['id,name,lat,lon', ...targets.map((h) => [h.id, csvCell(h.name), h.lat, h.lon].join(','))].join('\n'),
    'utf8',
  );

  /**
   * The join runs INSIDE DuckDB, against the remote parquet, so the only thing
   * written to disk is the candidate list. Pulling every website in the bbox
   * first and joining afterwards also works and produced a 529 MB intermediate
   * for a 28 MB answer.
   *
   * Bucketed to a ~1.1 km grid so this is a hash join with the precise
   * haversine applied after; a bare range join asks the same question the slow
   * way. Each target claims the eight cells around it too, so a match just over
   * a boundary is not lost.
   */
  writeFileSync(
    sqlFile,
    `
INSTALL httpfs; LOAD httpfs;
SET s3_region = 'us-west-2';

CREATE TABLE targets AS SELECT * FROM read_csv('${targetsCsv}', header = true);

CREATE TABLE ov AS
  SELECT names.primary AS ov_name, websites[1] AS website, confidence,
         operating_status, bbox.xmin AS lon, bbox.ymin AS lat
  FROM read_parquet('${S3}', hive_partitioning = 1)
  WHERE websites IS NOT NULL
    AND operating_status IS DISTINCT FROM 'permanently_closed'
    AND bbox.xmin BETWEEN ${minLon} AND ${maxLon}
    AND bbox.ymin BETWEEN ${minLat} AND ${maxLat};

CREATE TABLE t_cells AS
  SELECT t.id, t.name, t.lat, t.lon,
         CAST(floor(t.lat / 0.01) + dy AS INTEGER) AS cy,
         CAST(floor(t.lon / 0.01) + dx AS INTEGER) AS cx
  FROM targets t,
       (SELECT unnest([-1, 0, 1]) AS dy) a,
       (SELECT unnest([-1, 0, 1]) AS dx) b;

CREATE TABLE o_cells AS
  SELECT *, CAST(floor(lat / 0.01) AS INTEGER) AS cy,
            CAST(floor(lon / 0.01) AS INTEGER) AS cx
  FROM ov;

COPY (
  SELECT * FROM (
    SELECT t.id, t.name, o.ov_name, o.website, o.confidence,
           2 * 6371000 * asin(sqrt(
             pow(sin(radians(o.lat - t.lat) / 2), 2) +
             cos(radians(t.lat)) * cos(radians(o.lat)) * pow(sin(radians(o.lon - t.lon) / 2), 2)
           )) AS metres
    FROM t_cells t JOIN o_cells o USING (cy, cx)
  ) WHERE metres <= ${MAX_METRES}
) TO '${candidatesCsv}' (FORMAT CSV, HEADER);
`,
    'utf8',
  );

  console.log('querying Overture (this reads only the bbox, ~1 min)...');
  try {
    execFileSync(duckdb, ['-c', `.read ${sqlFile.replace(/\\/g, '/')}`], { stdio: 'inherit' });
  } catch (e) {
    console.error(
      `\nFAILED to run DuckDB ("${duckdb}").\n` +
      `  Get the standalone binary from https://duckdb.org/docs/installation/\n` +
      `  then set DUCKDB_PATH to it, or put it on PATH.\n`,
    );
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }

  // ── Pick the best candidate per place ─────────────────────────────────────
  const rows = parseCsv(readFileSync(candidatesCsv, 'utf8'));
  const byTarget = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    if (!byTarget.has(r.id)) byTarget.set(r.id, []);
    byTarget.get(r.id)!.push(r);
  }

  const found: Record<string, Match> = {};
  let aggregatorsDropped = 0;
  for (const [id, cands] of byTarget) {
    const ours = cands[0].name;
    const agreed = cands
      .filter((c) => c.website && namesAgree(ours, c.ov_name, Number(c.metres)))
      .sort((a, b) => Number(a.metres) - Number(b.metres));
    if (!agreed.length) continue;
    const pick = agreed.find((c) => !AGGREGATOR.test(c.website));
    if (!pick) { aggregatorsDropped++; continue; }
    found[id] = {
      url: pick.website,
      name: pick.ov_name,
      metres: Math.round(Number(pick.metres)),
      confidence: Number(pick.confidence) || 0,
    };
  }

  writeFileSync(OUT, JSON.stringify(found, null, 0), 'utf8');
  rmSync(work, { recursive: true, force: true });

  const n = Object.keys(found).length;
  const byType: Record<string, number> = {};
  for (const id of Object.keys(found)) {
    const t = byId.get(id)?.type ?? '?';
    byType[t] = (byType[t] ?? 0) + 1;
  }
  const totals: Record<string, number> = {};
  for (const h of targets) totals[h.type] = (totals[h.type] ?? 0) + 1;

  console.log(`\n${'='.repeat(58)}`);
  console.log(`candidates within ${MAX_METRES} m   ${byTarget.size.toLocaleString()} places`);
  console.log(`name also agrees          ${n.toLocaleString()}  ${((n / targets.length) * 100).toFixed(1)}% of the gap`);
  if (aggregatorsDropped) console.log(`dropped, aggregator only  ${aggregatorsDropped}`);
  console.log('\nby type:');
  for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(16)} ${String(c).padStart(5)} of ${String(totals[t] ?? 0).padStart(5)}  (${Math.round((c / (totals[t] || 1)) * 100)}%)`);
  }
  console.log(`\n-> ${OUT}`);
  console.log('   now run `npm run retry-photo-index` to turn these into photos');
}

main();
