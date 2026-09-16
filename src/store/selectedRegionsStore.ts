import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The mountain subregions the user has chosen to walk in (region ids from
 * `REGIONS`). This is the app's core scoping decision — the huts/villages hooks
 * load ONLY these (plus a ~150 km neighbourly halo, see `regionsWithinKm`), so
 * there's never more than a handful of regions' worth of data on the map. An
 * empty selection means "first run" — the app shows the region picker until the
 * user has chosen at least one.
 *
 * `_hydrated` flips true once the persisted value has loaded from disk, so the
 * first-run gate can wait for it rather than briefly flashing the picker over an
 * already-made choice.
 */
interface SelectedRegionsState {
  selected: string[];
  _hydrated: boolean;
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  setSelected: (ids: string[]) => void;
}

export const useSelectedRegionsStore = create<SelectedRegionsState>()(
  persist(
    (set) => ({
      selected: [],
      _hydrated: false,
      add: (id) =>
        set((s) =>
          s.selected.includes(id)
            ? s
            : { selected: [...s.selected, id] },
        ),
      remove: (id) =>
        set((s) => ({ selected: s.selected.filter((x) => x !== id) })),
      toggle: (id) =>
        set((s) =>
          s.selected.includes(id)
            ? { selected: s.selected.filter((x) => x !== id) }
            : { selected: [...s.selected, id] },
        ),
      setSelected: (ids) => set({ selected: [...new Set(ids)] }),
    }),
    {
      name: 'alpine-huts.selected-regions',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ selected: s.selected }),
      // Bumped to 1 to discard selections written by pre-release dev builds.
      // Those were written while the picker flow was still being built, and
      // they silently suppress the first-run screen forever (a non-empty
      // `selected` IS the "already onboarded" signal), which is indis-
      // tinguishable from the gate being broken. Dropping them once makes
      // every existing install do first-run exactly once; after that the
      // choice persists normally and this never fires again.
      version: 1,
      migrate: () => ({ selected: [] }),
      // Mutating `s._hydrated` directly here would NOT notify React — zustand
      // only re-renders subscribers on a real `setState` call, and this
      // callback's argument is applied to the store via `set()` before this
      // runs, so mutating it in place is invisible to `useSyncExternalStore`.
      // `_layout.tsx` gates the whole app on this flag, so getting it wrong
      // means the app never advances past a blank screen. Must go through
      // `useSelectedRegionsStore.setState` instead.
      onRehydrateStorage: () => () => {
        useSelectedRegionsStore.setState({ _hydrated: true });
      },
    },
  ),
);
