import type { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;

export interface Facility {
  icon: IoniconName;
  label: string;
  /** true = amenity present (green), false = explicitly absent (muted). */
  available: boolean;
}

const NO_VALUES = new Set(['no', 'none', 'false', '0']);

const isNo = (v?: string) => v != null && NO_VALUES.has(v.toLowerCase());
const isYes = (v?: string) => v != null && v !== '' && !isNo(v);

function intTag(v?: string): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive a list of accommodation facilities from a hut's raw OSM tags.
 * Only includes facts OSM actually records — unknowns are omitted rather than
 * shown as "unknown". Coverage varies a lot by hut (capacity and drinking
 * water are common; showers and private rooms are rare).
 */
export function parseFacilities(tags: Record<string, string>): Facility[] {
  const out: Facility[] = [];

  const capacity = intTag(tags.capacity) ?? intTag(tags.beds);
  if (capacity != null) {
    out.push({ icon: 'bed-outline', label: `Sleeps ${capacity}`, available: true });
  }

  const winter = intTag(tags['capacity:winter_room']);
  if (winter != null) {
    out.push({
      icon: 'snow-outline',
      label: `Winter room · ${winter} beds`,
      available: true,
    });
  }

  if (isYes(tags['rooms:family']) || isYes(tags.rooms)) {
    out.push({
      icon: 'people-outline',
      label: 'Family / private rooms',
      available: true,
    });
  }

  if (tags.drinking_water) {
    out.push({
      icon: 'water-outline',
      label: isNo(tags.drinking_water) ? 'No drinking water' : 'Drinking water',
      available: !isNo(tags.drinking_water),
    });
  }

  if (tags.shower) {
    out.push({
      icon: 'rainy-outline',
      label: isNo(tags.shower) ? 'No shower' : 'Shower',
      available: !isNo(tags.shower),
    });
  }

  if (isYes(tags.breakfast)) {
    out.push({ icon: 'cafe-outline', label: 'Breakfast', available: true });
  }
  if (isYes(tags.dinner) || isYes(tags.half_board)) {
    out.push({ icon: 'restaurant-outline', label: 'Dinner', available: true });
  }
  if (isYes(tags.kitchen)) {
    out.push({
      icon: 'flame-outline',
      label: 'Self-catering kitchen',
      available: true,
    });
  }

  if (tags.internet_access && !isNo(tags.internet_access)) {
    out.push({ icon: 'wifi-outline', label: 'Wi-Fi', available: true });
  }

  if (tags.dog) {
    out.push({
      icon: 'paw-outline',
      label: isNo(tags.dog) ? 'No dogs' : 'Dogs allowed',
      available: !isNo(tags.dog),
    });
  }

  if (isYes(tags['payment:credit_cards'])) {
    out.push({ icon: 'card-outline', label: 'Cards accepted', available: true });
  }

  return out;
}
