/**
 * Propose stage ids for the classic routes — for REVIEW, never for blind use.
 *
 * ⚠️ Name matching against this dataset is dangerous on its own. It has produced
 * a cableway, a road, a junction, "Elm"→Gelmerhütte and "Boz"→Rifugio Angelino
 * Bozzi (right name, wrong massif). So this script scores candidates and prints
 * them with everything a human needs to reject a bad one:
 *
 *   • exact name match beats a substring
 *   • a real lodging type beats anything else
 *   • CHAIN COHERENCE — a stage must be a plausible day's walk from the
 *     previous one. This is what catches the wrong-massif case, which no amount
 *     of name cleverness can.
 *
 * Nothing is written to disk. Run it, read the output, and copy across only the
 * ids whose whole chain looks like a walk.
 *
 *   npx tsx scripts/resolve-classic-routes.ts [routeId]
 */
import { CLASSIC_ROUTES } from '../src/constants/classicRoutes';
import { searchBundledPlaces } from '../src/data/hutBundle';
import type { Hut } from '../src/types/hut';

/** Below this two "different" stages are really the same place. */
const MIN_STAGE_KM = 0.3;

/**
 * ⚠️ The chain-coherence limit CANNOT be one number. It was 30 km — a day's
 * walk — which is right for a hut-to-hut trek but wrong for a route whose
 * published "stages" are multi-day SECTIONS. The Slovenian Mountain Trail is
 * 600 km in 11 listed stages (~55 km each), so every single stage read as a
 * CHAIN BREAK and the whole route resolved to nothing. Derive it from the
 * route's own published length instead.
 */
function maxStageKm(publishedLength: string, stageCount: number): number {
  // "~413 km", "600 km", "80–120 km" → the last number present.
  const nums = publishedLength.match(/\d+/g);
  if (!nums || stageCount < 2) return 30;
  const km = Number(nums[nums.length - 1]);
  const perStage = km / (stageCount - 1);
  // 2.5× the average leg absorbs an uneven itinerary without letting a
  // wrong-massif match (which is out by 100 km+) back in.
  return Math.min(120, Math.max(30, perStage * 2.5));
}

/**
 * Generic words for "mountain hut" in every language the dataset uses. They are
 * useless as search probes — "hutte" alone matches thousands — so the probe must
 * pick the DISTINCTIVE word instead.
 */
const GENERIC_PLACE_WORDS = new Set([
  'hutte', 'huette', 'haus', 'berghaus', 'berggasthaus', 'gasthof', 'hotel',
  'rifugio', 'refuge', 'refugi', 'capanna', 'cabane', 'chalet', 'gite',
  'koca', 'dom', 'bivacco', 'biwak', 'bivak', 'zavetisce', 'planinski',
  'alm', 'alpe', 'auberge', 'pension', 'camping',
]);

const LODGING = new Set(['alpine_hut', 'wilderness_hut', 'guesthouse', 'shelter']);

/** Words that mean the stage IS a mountain refuge, so the match had better be
 *  one — high, and typed as a hut. Catches "Boè" matching a valley Hotel Boe. */
const REFUGE_WORDS =
  /rifugio|refuge|refugi|hütte|huette|hutte|capanna|cabane|koča|chata|schutzhaus|berghaus|biwak|bivacco/i;
/** A refuge below this in the Alps is almost certainly the wrong place. */
const REFUGE_MIN_ELE = 1200;

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Strip the noise a guidebook adds: "Rifugio", "Hütte", accents, punctuation. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Candidate {
  hut: Hut;
  regionId: string;
  score: number;
  why: string[];
}

function candidatesFor(stage: string, anchor: Hut | undefined, maxKm: number): Candidate[] {
  // A stage may be written "A → B"; the stop is the destination.
  const target = stage.includes('→') ? stage.split('→').pop()!.trim() : stage.trim();
  const q = norm(target);
  const words = q.split(' ').filter((w) => w.length >= 3);
  // ⚠️ WAS `words[words.length - 1]` — the LAST word. For "Berliner Hütte" that
  // probes "hutte", which returns 400 generic huts and buries the real one, so
  // the stage was reported as "no candidate" when it was in the data all along.
  // Thirteen stops across five routes were wrongly listed as missing this way.
  // Prefer the last word that is not a generic word for "hut".
  const distinctive = words.filter((w) => !GENERIC_PLACE_WORDS.has(w));
  const probe = distinctive.length
    ? distinctive[distinctive.length - 1]
    : words.length
      ? words[words.length - 1]
      : q;
  const found = searchBundledPlaces(probe, 400);

  const out: Candidate[] = [];
  for (const { hut, regionId } of found) {
    const n = norm(hut.name);
    const why: string[] = [];
    let score = 0;

    if (n === q) {
      score += 100;
      why.push('exact name');
    } else if (n.includes(q)) {
      score += 60;
      why.push('name contains stage');
    } else if (q.includes(n) && n.length >= 5) {
      score += 45;
      why.push('stage contains name');
    } else if (words.every((w) => n.includes(w))) {
      score += 35;
      why.push('all words present');
    } else {
      continue; // too loose to offer
    }

    if (LODGING.has(hut.type)) {
      score += 25;
      why.push(hut.type);
    } else {
      score -= 20;
      why.push(`NOT LODGING (${hut.type})`);
    }

    // ⚠️ A stage called "Rifugio X" must resolve to an actual mountain refuge.
    // Without this, "Boè" matched a 1858 m valley Hotel Boe and scored well,
    // and "Bressanone" matched the Brixner Hütte instead of the town it starts
    // from. Both looked fine on name alone.
    const stageIsRefuge = REFUGE_WORDS.test(target);
    const matchIsRefuge =
      hut.type === 'alpine_hut' || hut.type === 'wilderness_hut';
    if (stageIsRefuge && !matchIsRefuge) {
      score -= 60;
      why.push('!! stage names a refuge, match is not a hut');
    }
    if (stageIsRefuge && (hut.elevation ?? 0) > 0 && (hut.elevation ?? 0) < REFUGE_MIN_ELE) {
      score -= 60;
      why.push(`!! refuge stage but only ${Math.round(hut.elevation!)} m`);
    }
    // …and the converse: a plain place name is usually a village/valley base.
    if (!stageIsRefuge && hut.type === 'village') {
      score += 15;
      why.push('village (stage reads as a town)');
    }

    if (anchor) {
      const d = km(anchor, hut);
      if (d > maxKm) {
        score -= 200;
        why.push(`${d.toFixed(0)} km from previous — CHAIN BREAK`);
      } else if (d < MIN_STAGE_KM) {
        score -= 50;
        why.push('same place as previous');
      } else {
        score += Math.max(0, 30 - d);
        why.push(`${d.toFixed(1)} km from previous`);
      }
    }
    out.push({ hut, regionId, score, why });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

const only = process.argv[2];
const routes = CLASSIC_ROUTES.filter(
  (r) => (!only || r.id === only) && !r.stageIds,
);

console.log(`Proposing ids for ${routes.length} route(s). NOTHING IS WRITTEN.\n`);

for (const route of routes) {
  console.log(`\n${'='.repeat(78)}\n${route.name} — ${route.where}`);
  const maxKm = maxStageKm(route.length, route.stages.length);
  console.log(
    `published: ${route.length}, ${route.days}  (chain limit ${maxKm.toFixed(0)} km/stage)`,
  );
  let anchor: Hut | undefined;
  let resolved = 0;
  const ids: (string | null)[] = [];

  for (const stage of route.stages) {
    const cands = candidatesFor(stage, anchor, maxKm);
    const best = cands[0];
    const ok = best && best.score >= 60;
    if (ok) {
      resolved++;
      anchor = best.hut;
      ids.push(best.hut.id);
    } else {
      ids.push(null);
    }
    const label = ok ? '  OK ' : cands.length ? ' ??? ' : ' --- ';
    console.log(
      `${label}${stage.padEnd(34)} ${
        best
          ? `${best.hut.name} (${best.hut.elevation ? Math.round(best.hut.elevation) + 'm' : '?'}) [${best.regionId}] score ${best.score} — ${best.why.join(', ')}`
          : 'no candidate'
      }`,
    );
    for (const c of cands.slice(1)) {
      console.log(
        `      alt: ${c.hut.name} (${c.hut.elevation ? Math.round(c.hut.elevation) + 'm' : '?'}) [${c.regionId}] score ${c.score} — ${c.why.join(', ')}`,
      );
    }
  }
  console.log(`\n  resolved ${resolved}/${route.stages.length}`);
  if (resolved >= 2) {
    console.log('  stageIds: [');
    route.stages.forEach((s, i) => {
      if (ids[i]) console.log(`    '${ids[i]}', // ${s}`);
    });
    console.log('  ],');
  }
}
