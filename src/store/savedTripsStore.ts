import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Hut } from '../types/hut';
import type { RideUse } from '../types/ride';
import type { PackedLeg } from '../utils/packLeg';

export interface SavedTrip {
  id: string;
  name: string;
  /** Ordered huts, stored in full so a trip can be reloaded and re-routed. */
  huts: Hut[];
  /** Whether the trip's legs use scenic routing (so it reloads matching). */
  scenic?: boolean;
  /** Ride (lift/train) used per leg, aligned to `huts` (index i = huts[i]→
   *  huts[i+1]); absent/empty when the trip is all walking. */
  rides?: (RideUse | null)[];
  /**
   * The routed geometry and stats per leg, aligned to `huts` the same way.
   *
   * This is what makes a saved trip work with NO NETWORK: the React Query cache
   * is memory-only, so without this a reopened trip had to re-ask BRouter for
   * every leg — meaning no trail on the map and no distance/ascent/grade the
   * moment you lose signal, which is precisely when you're walking it.
   * Stored packed; see `src/utils/packLeg.ts` for why.
   *
   * Optional because trips saved before this existed don't have it (they fall
   * back to routing on open, exactly as they used to).
   */
  legs?: PackedLeg[];
  /**
   * The code this trip has been shared under, once it has been.
   *
   * Kept here so the Saved tab can show "shared" without asking the server —
   * which matters because the Saved tab is the one screen people open with no
   * signal. The server remains the authority: a code revoked from another phone
   * still sits here, and finding that out costs a connection.
   */
  shareCode?: string;
  createdAt: number;
}

interface SavedTripsState {
  trips: SavedTrip[];
  /** Persist the current ordered huts under a name. Returns the new trip id. */
  save: (
    name: string,
    huts: Hut[],
    scenic: boolean,
    rides?: (RideUse | null)[],
    legs?: PackedLeg[],
  ) => string;
  rename: (id: string, name: string) => void;
  removeTrip: (id: string) => void;
  /** Remember (or forget, with null) the code this trip is shared under. */
  setShareCode: (id: string, code: string | null) => void;
  /** Take a trip somebody shared and keep it as one of ours. Returns the id. */
  addTrip: (trip: Omit<SavedTrip, 'id' | 'createdAt'>) => string;
  /** True once the persisted state has been read from storage. */
  _hydrated: boolean;
}

export const useSavedTripsStore = create<SavedTripsState>()(
  persist(
    (set) => ({
      trips: [],
      _hydrated: false,
      save: (name, huts, scenic, rides = [], legs) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const trip: SavedTrip = {
          id,
          name: name.trim() || 'Untitled trip',
          huts,
          scenic,
          rides: rides.some(Boolean) ? rides : undefined,
          // Only when EVERY leg routed. A partial set would redraw a trail with
          // silent gaps offline, which is worse than honestly re-routing.
          legs:
            legs && legs.length === Math.max(0, huts.length - 1)
              ? legs
              : undefined,
          createdAt: Date.now(),
        };
        set((state) => ({ trips: [trip, ...state.trips] }));
        return id;
      },
      rename: (id, name) =>
        set((state) => ({
          trips: state.trips.map((t) =>
            t.id === id ? { ...t, name: name.trim() || t.name } : t,
          ),
        })),
      removeTrip: (id) =>
        set((state) => ({ trips: state.trips.filter((t) => t.id !== id) })),
      setShareCode: (id, code) =>
        set((state) => ({
          trips: state.trips.map((t) =>
            t.id === id ? { ...t, shareCode: code ?? undefined } : t,
          ),
        })),
      /**
       * ⚠️ A RECEIVED TRIP BECOMES AN ORDINARY ONE, AND KEEPS NO CODE. The
       * sharer can revoke theirs; a copy that quietly pointed back at it would
       * vanish from under the person who accepted it. From here it is theirs —
       * renameable, deletable, and shareable again under a code of their own.
       */
      addTrip: (trip) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((state) => ({
          trips: [{ ...trip, shareCode: undefined, id, createdAt: Date.now() }, ...state.trips],
        }));
        return id;
      },
    }),
    {
      name: 'alpine-huts.saved-trips',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ trips: state.trips }),
      // See selectedRegionsStore.ts: must go through setState, not mutate the
      // callback argument, or subscribers never see `_hydrated` flip to true.
      onRehydrateStorage: () => () => {
        useSavedTripsStore.setState({ _hydrated: true });
      },
    },
  ),
);
