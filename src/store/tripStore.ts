import { create } from 'zustand';
import { useAlternativesStore } from './alternativesStore';
import type { Hut } from '../types/hut';
import type { RideUse } from '../types/ride';

interface TripState {
  /** Selected huts in the user's chosen walking order. */
  huts: Hut[];
  /** Whether this route's legs are the scenic (mountain) routing rather than
   *  the fast one — set when a scenic route is generated. Drives which BRouter
   *  geometry the Map/Route tabs fetch so they match what was generated. */
  scenic: boolean;
  /** Ride (lift/train) used on each leg, aligned to `huts` (index i = leg from
   *  huts[i] to huts[i+1]); `null` where a leg is walked. Set only by the
   *  generator via `setTrip`/`previewTrip`; any manual edit clears it (a
   *  hand-built leg is plain walking). */
  rides: (RideUse | null)[];
  /** Add a hut to the end of the route (no-op if already present). */
  add: (hut: Hut) => void;
  /** Remove a hut from the route by id. */
  remove: (id: string) => void;
  /** Add if absent, remove if present. */
  toggle: (hut: Hut) => void;
  /**
   * Add a hut to the END even if it's already in the route.
   *
   * `toggle` can't do this — for a hut already present it means "remove", which
   * is what made round trips impossible to build by hand: tapping your start
   * again deleted it instead of closing the loop. The rest of the app already
   * expects a hut to appear twice (see `orderById` on the Map, and the
   * index-suffixed keyExtractor on the Route tab).
   */
  append: (hut: Hut) => void;
  /** Replace the whole ordered list (used after a drag reorder). */
  reorder: (huts: Hut[]) => void;
  /** Flip the whole route between scenic (mountain) and fast walking geometry,
   *  keeping the same huts — the Route tab's scenic toggle. `useRouteLegs` keys
   *  its BRouter queries on `scenic`, so this just re-fetches each leg's
   *  geometry/stats (cached separately per mode). */
  setScenic: (scenic: boolean) => void;
  /** Replace the route, whether its legs are scenic, and any per-leg rides, as
   *  a FINAL decision — ends any alternatives comparison in progress (see
   *  `alternativesStore`). Used by the generator's fast-apply path and by
   *  "Use this route" buttons. */
  setTrip: (huts: Hut[], scenic: boolean, rides?: (RideUse | null)[]) => void;
  /** Same as `setTrip` but WITHOUT ending an alternatives comparison — used
   *  while swiping/browsing the ≤3 generated alternatives (Plan's carousel and
   *  the Map tab's swipe-to-compare) so trying one on doesn't dismiss the
   *  others you're still comparing against. */
  previewTrip: (huts: Hut[], scenic: boolean, rides?: (RideUse | null)[]) => void;
  /** Empty the route. */
  clear: () => void;
}

export const useTripStore = create<TripState>((set) => ({
  huts: [],
  scenic: false,
  rides: [],
  add: (hut) =>
    set((state) => {
      useAlternativesStore.getState().clear(); // manual edit diverges from any alternative
      return state.huts.some((h) => h.id === hut.id)
        ? state
        : { huts: [...state.huts, hut], rides: [] };
    }),
  remove: (id) => {
    useAlternativesStore.getState().clear();
    set((state) => ({
      huts: state.huts.filter((h) => h.id !== id),
      rides: [],
    }));
  },
  toggle: (hut) =>
    set((state) => {
      useAlternativesStore.getState().clear();
      return state.huts.some((h) => h.id === hut.id)
        ? { huts: state.huts.filter((h) => h.id !== hut.id), rides: [] }
        : { huts: [...state.huts, hut], rides: [] };
    }),
  append: (hut) =>
    set((state) => {
      useAlternativesStore.getState().clear();
      return { huts: [...state.huts, hut], rides: [] };
    }),
  reorder: (huts) => {
    useAlternativesStore.getState().clear();
    set({ huts, rides: [] });
  },
  setScenic: (scenic) => set({ scenic }),
  setTrip: (huts, scenic, rides = []) => {
    useAlternativesStore.getState().clear();
    set({ huts, scenic, rides });
  },
  previewTrip: (huts, scenic, rides = []) => set({ huts, scenic, rides }),
  clear: () => {
    useAlternativesStore.getState().clear();
    set({ huts: [], scenic: false, rides: [] });
  },
}));
