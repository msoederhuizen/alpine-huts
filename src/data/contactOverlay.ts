import { HIDDEN_PLACES, PLACE_CORRECTIONS } from '../constants/placeCorrections';
import type { Hut } from '../types/hut';

/**
 * Contact details merged in from outside hut lists, on top of OSM.
 *
 * ⚠️ IT ONLY EVER FILLS A GAP. OSM is the source of record and stays the source
 * of record: every field here is written only where the bundled place has
 * nothing, so a later `generate-huts` run that picks up a real OSM `phone` tag
 * silently wins and this file stops applying to that place. That is deliberate —
 * the overlay must never be the reason the app shows something stale.
 *
 * ⚠️ AND IT IS CHECKED AGAIN HERE, NOT TRUSTED FROM THE FILE. The overlays were
 * computed against one particular bundle. Bundles are regenerated; ids survive
 * but tags change, so "this field was missing" was true when the file was built
 * and may not be true now. Re-testing costs one property read per place and
 * removes a whole class of "why is it showing the wrong number" bug.
 *
 * Built by `npm run import-hut-database` and `npm run import-alpenverein`, which
 * match to places by POSITION rather than by name — see `scripts/lib/
 * place-matcher.ts` for why that distinction is the whole design.
 */
interface Overlay {
  name?: string;
  website?: string;
  phone?: string;
  /** The alpine club or section that runs it — OSM `operator`. */
  operator?: string;
  /** The hut keeper, a person — OSM `contact:person`, a different thing. */
  warden?: string;
  /** "yes" / "no"; `parseFacilities` already renders this as a paw icon. */
  dog?: string;
  /** A hut-reservation.org / huetten-holiday reservation page. */
  booking?: string;
  ele?: string;
  /** Only tyrol.com carries these; the detail screen already renders an email. */
  email?: string;
  /** Nearest railway station, bus stop and where to leave a car. */
  station?: string;
  bus?: string;
  car?: string;
}

// `require`, not `import`: a large JSON `import` makes tsc infer the whole
// literal as a type. Same reasoning as the region files in hutBundle.ts.
const SPREADSHEET: Record<string, Overlay> = require('../../assets/data/hut-contact-overlay.json');
const ALPENVEREIN: Record<string, Overlay> = require('../../assets/data/alpenverein-overlay.json');
const TYROL: Record<string, Overlay> = require('../../assets/data/tyrol-overlay.json');

/**
 * ⚠️ THE SPREADSHEET WINS WHERE BOTH HAVE A VALUE, and the order is the point.
 * It was compiled and checked by hand for this app; the Alpenverein register is
 * a bulk import, accurate but unverified here. Where only one has a field the
 * other simply contributes it — the two overlap on a few hundred huts and are
 * complementary everywhere else, the register covering the Austrian and German
 * clubs and being the only source in the project that knows how to reach a hut
 * by train or bus.
 *
 * Merged once at module load rather than per place: there are a few hundred
 * entries and this runs for every place in every region as it loads.
 */
const DATA: Record<string, Overlay> = (() => {
  // Weakest first, so the strongest source's value survives the spread.
  const out: Record<string, Overlay> = { ...TYROL };
  for (const layer of [ALPENVEREIN, SPREADSHEET]) {
    for (const [id, add] of Object.entries(layer)) {
      out[id] = out[id] ? { ...out[id], ...add } : add;
    }
  }
  return out;
})();

/**
 * Return the place with any missing contact details filled in, or the very same
 * object when there is nothing to add.
 *
 * Returning the original reference matters: this runs over every place in a
 * region as it loads, and the overlay covers a few hundred of twenty-three
 * thousand. Copying them all would allocate a new object per place for no
 * reason, and would also break the identity checks callers rely on.
 */
export function withContactOverlay(hut: Hut): Hut {
  const add = DATA[hut.id];
  if (!add) return hut;

  const tags = hut.tags ?? {};
  const patch: Partial<Hut> = {};
  const tagPatch: Record<string, string> = {};

  if (add.website && !(tags.website || tags['contact:website'] || hut.website)) {
    patch.website = add.website;
    tagPatch.website = add.website;
  }
  if (add.phone && !(tags.phone || tags['contact:phone'])) tagPatch.phone = add.phone;
  if (add.email && !(tags.email || tags['contact:email'])) tagPatch.email = add.email;
  if (add.operator && !(tags.operator || tags.owner)) tagPatch.operator = add.operator;
  if (add.warden && !tags['contact:person']) tagPatch['contact:person'] = add.warden;
  if (add.dog && !tags.dog) tagPatch.dog = add.dog;

  if (add.booking && !hut.reservationWebsite && !tags['reservation:website']) {
    patch.reservationWebsite = add.booking;
    tagPatch['reservation:website'] = add.booking;
  }

  if (add.ele && !tags.ele && hut.elevation == null) {
    const metres = Number(add.ele);
    if (Number.isFinite(metres)) {
      patch.elevation = metres;
      tagPatch.ele = add.ele;
    }
  }

  // A real name where OSM has only "Wilderness hut" or "Alpine hut". This is the
  // one field that changes what the person sees first, and the one that makes a
  // place findable at all — every photo source in the project searches by name.
  if (add.name && (!hut.name || isPlaceholder(hut.name))) patch.name = add.name;

  const tagKeys = Object.keys(tagPatch);
  if (!tagKeys.length && !Object.keys(patch).length) return hut;
  return { ...hut, ...patch, tags: tagKeys.length ? { ...tags, ...tagPatch } : tags };
}

/**
 * Kept in step with `isFallbackHutName` in utils/hutMeta, deliberately as a
 * separate copy: that one decides what the MAP shows and is tuned for it, while
 * this one decides whether a spreadsheet name may replace what OSM holds. They
 * happen to agree today; tying them together would mean a change made for the
 * map's sake quietly started rewriting names.
 */
function isPlaceholder(name: string): boolean {
  return /^(Unnamed (shelter|hut)|Wilderness hut|Alpine hut|Shelter|Bivouac)$/.test(name.trim());
}

/** Which app-level field each correction key removes. */
const DROPPABLE: Record<string, { tags?: string[]; prop?: 'website' | 'elevation' | 'reservationWebsite' }> = {
  website: { tags: ['website', 'contact:website', 'url'], prop: 'website' },
  phone: { tags: ['phone', 'contact:phone'] },
  email: { tags: ['email', 'contact:email'] },
  operator: { tags: ['operator', 'owner'] },
  warden: { tags: ['contact:person'] },
  dog: { tags: ['dog'] },
  ele: { tags: ['ele'], prop: 'elevation' },
  booking: { tags: ['reservation:website'], prop: 'reservationWebsite' },
};

/**
 * Apply the hand-verified corrections — the last word on a place.
 *
 * ⚠️ RUNS AFTER THE OVERLAY, NEVER BEFORE. Its whole purpose is to undo values
 * the overlay inherited from a source row that was itself wrong, so it has to
 * see the merged result. See `src/constants/placeCorrections.ts`.
 */
export function withCorrections(hut: Hut): Hut {
  const fix = PLACE_CORRECTIONS[hut.id];
  if (!fix) return hut;

  const patch: Partial<Hut> = {};
  const tags = { ...(hut.tags ?? {}) };
  let touchedTags = false;

  for (const key of fix.drop ?? []) {
    const d = DROPPABLE[key];
    if (!d) continue;
    for (const t of d.tags ?? []) {
      if (t in tags) {
        delete tags[t];
        touchedTags = true;
      }
    }
    if (d.prop) patch[d.prop] = undefined;
  }

  if (fix.name) patch.name = fix.name;
  if (fix.website) {
    patch.website = fix.website;
    tags.website = fix.website;
    touchedTags = true;
  }

  return { ...hut, ...patch, tags: touchedTags ? tags : hut.tags };
}

export function isHidden(id: string): boolean {
  return id in HIDDEN_PLACES;
}
