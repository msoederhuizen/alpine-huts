/**
 * Fetch a shared route, check it, and keep it.
 *
 * ⚠️ ONE PLACE, BECAUSE THERE ARE TWO DOORS. A code can arrive by being typed
 * into the Account tab or by following an `alpinehuts://r/CODE` link, and those
 * two paths must not drift into giving different answers about the same code —
 * accepting through one and refusing through the other would be impossible for
 * anyone to report, let alone fix.
 */
import { openSharedRoute } from '../api/community';
import { useSavedTripsStore } from '../store/savedTripsStore';
import { parseSharePayload } from './tripShare';

export type ImportFailure = 'not_found' | 'offline' | 'failed' | 'unreadable';

export type ImportResult =
  | { ok: true; id: string; name: string; huts: number; routed: boolean }
  | { ok: false; why: ImportFailure };

/** How a refusal is put to the person holding the code. */
export const IMPORT_SAYS: Record<ImportFailure, string> = {
  not_found:
    'No route with that code. Check the characters, or ask for it again — the person who shared it can also have stopped sharing.',
  offline: 'No connection — opening a shared route needs signal, once.',
  failed: 'That did not work. Please try again.',
  unreadable:
    'That code found a route this version of the app cannot read. Updating the app is the likeliest fix.',
};

export async function importSharedRoute(code: string): Promise<ImportResult> {
  const got = await openSharedRoute(code);
  if (got === 'not_found' || got === 'offline' || got === 'failed') return { ok: false, why: got };

  const trip = parseSharePayload(got.payload, got.title);
  if (!trip) return { ok: false, why: 'unreadable' };

  const id = useSavedTripsStore.getState().addTrip(trip);
  return { ok: true, id, name: trip.name, huts: trip.huts.length, routed: Boolean(trip.legs) };
}
