/**
 * Build a page for reviewing every place the imports changed.
 *
 * ⚠️ ORDERED BY RISK, NOT BY NAME. 1,232 changes across two sources will bury a
 * dozen wrong ones if the list is alphabetical, and the reviewer gives up long
 * before reaching them. `risk()` puts first the matches where the NAME did work
 * that POSITION normally does — a renamed place, a redirect, a match found
 * beyond the radius — then the ones where the two names do not corroborate, and
 * only then the eight hundred that are simply near and agree.
 *
 * ⚠️ IT IS A LOCAL FILE, NOT AN ARTIFACT. It links out to OpenStreetMap at each
 * hut's coordinates so a doubtful match can be checked against the map in one
 * click, and it shows the values that were written. Nothing here is fetched.
 *
 *   npm run review-overlay        # writes and prints the path
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hut } from '../src/types/hut';
import { type Provenance, risk } from './lib/provenance';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f: string) => join(ROOT, 'assets', 'data', f);
const OUT = join(ROOT, 'overlay-review.html');

const read = (p: string): Record<string, Provenance> =>
  existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};

/** Which region each place lives in, so a reviewer can tell where they are. */
function regions(): Map<string, string> {
  const dir = join(ROOT, 'assets', 'data', 'regions');
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== '_meta.json')) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, Hut[]>;
    for (const b of ['core', 'accommodations', 'villages']) {
      for (const h of d[b] ?? []) if (!out.has(h.id)) out.set(h.id, f.replace('.json', ''));
    }
  }
  return out;
}

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The single reason this row is where it is in the list. */
function why(p: Provenance): { label: string; cls: string } {
  if (p.fields.name) return { label: 'RENAMED', cls: 'renamed' };
  if (p.how === 'redirected') return { label: 'REDIRECTED', cls: 'redirected' };
  if (p.how === 'widened') return { label: `FOUND AT ${p.metres} m`, cls: 'widened' };
  if (p.nameDisagrees) return { label: 'NAMES DIFFER', cls: 'differ' };
  if (p.alsoClaimedBy?.length) return { label: 'TWO ROWS', cls: 'two' };
  return { label: 'routine', cls: 'ok' };
}

function main() {
  const sheet = read(D('hut-contact-overlay-provenance.json'));
  const av = read(D('alpenverein-overlay-provenance.json'));
  const region = regions();

  /**
   * ⚠️ ONE ROW PER PLACE, NOT ONE PER SOURCE. 394 huts are matched by BOTH the
   * spreadsheet and the register, and listing each twice made the review read as
   * though the app held duplicates — which is exactly what it was reported as.
   * The app itself never doubles them: `useHuts` keys by id and then runs
   * `collapseDuplicatePlaces`. This was the review tool lying about the data.
   *
   * Merged the same way the app merges them: the spreadsheet's fields win, the
   * register's fill the rest, and the row keeps the riskier of the two matches
   * so nothing gets hidden behind an easier one.
   */
  const merged = new Map<string, Provenance>();
  for (const [id, p] of [...Object.entries(av), ...Object.entries(sheet)]) {
    const prev = merged.get(id);
    const row: Provenance = prev
      ? {
          ...(risk(p) >= risk(prev) ? p : prev),
          fields: { ...prev.fields, ...p.fields },
          source: `${prev.source} + ${p.source}`,
        }
      : p;
    merged.set(id, row);
  }
  const all: Provenance[] = [...merged].map(([id, p]) => ({ ...p, region: region.get(id) }));
  if (!all.length) {
    console.error('No provenance files. Re-run the importers with --write first.');
    process.exit(1);
  }
  all.sort((a, b) => risk(b) - risk(a));

  const counts = new Map<string, number>();
  for (const p of all) counts.set(why(p).cls, (counts.get(why(p).cls) ?? 0) + 1);

  const rows = all
    .map((p) => {
      const w = why(p);
      const fields = Object.entries(p.fields)
        .map(([k, v]) => {
          const link = /^https?:\/\//.test(v)
            ? `<a href="${esc(v)}" target="_blank" rel="noreferrer">${esc(v)}</a>`
            : esc(v);
          return `<div class="f"><span class="k">${esc(k)}</span>${link}</div>`;
        })
        .join('');
      const osm = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}`;
      const instead = p.insteadOf
        ? `<div class="note">moved off <b>${esc(p.insteadOf.name)}</b>, which was ${Math.round(p.insteadOf.m)} m away</div>`
        : '';
      const also = p.alsoClaimedBy?.length
        ? `<div class="note">also claimed by ${p.alsoClaimedBy.map((n) => `“${esc(n)}”`).join(', ')}</div>`
        : '';
      const named =
        p.appName.toLowerCase() === p.rowName.toLowerCase()
          ? ''
          : `<div class="note">source calls it <b>“${esc(p.rowName)}”</b></div>`;
      return `<tr class="${w.cls}" data-cls="${w.cls}" data-src="${p.source}">
        <td class="flag"><span class="badge ${w.cls}">${w.label}</span></td>
        <td>
          <div class="name"><a href="${osm}" target="_blank" rel="noreferrer">${esc(p.appName)}</a></div>
          <div class="meta">${esc(p.region ?? '')} · ${p.metres} m · ${esc(p.source)}</div>
          ${named}${instead}${also}
        </td>
        <td class="fields">${fields}</td>
      </tr>`;
    })
    .join('\n');

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Overlay review</title>
<style>
  :root { --ink:#1b1b1b; --muted:#6b6b6b; --line:#e6e6e6; --bg:#fbfaf8; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
  header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line);
           padding:16px 20px; z-index:2; }
  h1 { margin:0 0 4px; font-size:18px; }
  p.sub { margin:0 0 12px; color:var(--muted); }
  .filters { display:flex; gap:6px; flex-wrap:wrap; }
  button { border:1px solid var(--line); background:#fff; border-radius:999px;
           padding:5px 11px; font-size:12px; cursor:pointer; color:var(--ink); }
  button[aria-pressed="true"] { background:var(--ink); color:#fff; border-color:var(--ink); }
  table { width:100%; border-collapse:collapse; }
  td { border-bottom:1px solid var(--line); padding:10px 12px; vertical-align:top; }
  td.flag { width:150px; }
  .badge { display:inline-block; font-size:10px; font-weight:700; letter-spacing:.04em;
           padding:3px 7px; border-radius:4px; background:#eee; color:#555; white-space:nowrap; }
  .badge.renamed { background:#7b2d8e; color:#fff; }
  .badge.redirected { background:#c0392b; color:#fff; }
  .badge.widened { background:#d67c00; color:#fff; }
  .badge.differ { background:#b8860b; color:#fff; }
  .badge.two { background:#2b6cb0; color:#fff; }
  .badge.ok { background:#eee; color:#777; }
  .name { font-weight:600; }
  .name a { color:inherit; }
  .meta { color:var(--muted); font-size:12px; }
  .note { color:var(--muted); font-size:12px; margin-top:3px; }
  .fields { width:46%; }
  .f { margin-bottom:2px; word-break:break-word; }
  .k { display:inline-block; min-width:74px; color:var(--muted); font-size:12px; }
  a { color:#1a5fb4; }
  @media (max-width:760px){ td.flag{width:auto} .fields{width:auto} table,tbody,tr,td{display:block}
    tr{border-bottom:1px solid var(--line); padding:8px 0} td{border:0; padding:2px 12px} }
</style>
<header>
  <h1>Overlay review — ${all.length.toLocaleString()} places changed</h1>
  <p class="sub">Riskiest first. The name did work that position normally does in the coloured rows;
     click a hut to open its coordinates on OpenStreetMap.</p>
  <div class="filters">
    <button data-f="all" aria-pressed="true">Everything (${all.length})</button>
    <button data-f="renamed" aria-pressed="false">Renamed (${counts.get('renamed') ?? 0})</button>
    <button data-f="redirected" aria-pressed="false">Redirected (${counts.get('redirected') ?? 0})</button>
    <button data-f="widened" aria-pressed="false">Found past 250 m (${counts.get('widened') ?? 0})</button>
    <button data-f="differ" aria-pressed="false">Names differ (${counts.get('differ') ?? 0})</button>
    <button data-f="two" aria-pressed="false">Two rows (${counts.get('two') ?? 0})</button>
    <button data-f="ok" aria-pressed="false">Routine (${counts.get('ok') ?? 0})</button>
  </div>
</header>
<table><tbody>
${rows}
</tbody></table>
<script>
  const btns = [...document.querySelectorAll('button[data-f]')];
  btns.forEach((b) => b.addEventListener('click', () => {
    btns.forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    const f = b.dataset.f;
    document.querySelectorAll('tbody tr').forEach((tr) => {
      tr.style.display = f === 'all' || tr.dataset.cls === f ? '' : 'none';
    });
  }));
</script>`;

  writeFileSync(OUT, html);
  console.log(`${all.length.toLocaleString()} changed places`);
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${v}`);
  }
  console.log(`\n-> ${OUT}`);
}

main();
