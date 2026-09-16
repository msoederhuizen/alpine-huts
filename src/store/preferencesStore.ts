import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { SAC_SCALE_ORDER, type SacScale } from '../utils/sacScale';

/**
 * Walking preferences that apply everywhere — routes you load, legs you draw on
 * the Map tab, and itineraries the Plan tab generates.
 *
 * ── maxSac: the hardest ground the router may use ──────────────────────────
 *
 * ⚠️ This REPLACES a per-route `alpineRouting` flag, and the reason matters.
 * The app used to cap routing at T3 for everything except two routes graded
 * "Very difficult". Where a real trail crossed harder ground, BRouter did not
 * refuse and did not warn — it routed AROUND. The Adlerweg's stage 11 came back
 * as 32.3 km against a real 13.9 km, indistinguishable from an ordinary long
 * day. Hiding a hard trail does not keep anyone off it; it just replaces the
 * walk they asked about with one nobody does.
 *
 * So the ceiling belongs to the walker. It defaults to T6 — show the trail that
 * exists — and anyone who wants the router to stay off hard ground lowers it.
 * Every leg still carries its SAC badge, so a hard day announces itself.
 *
 * ⚠️ A LOW ceiling can make a hut genuinely unreachable, and that is the point:
 * the Map tab then says the hut can't be reached rather than drawing a detour.
 * `isRouterUnavailable` keeps that distinct from "the router didn't answer".
 *
 * ⚠️ Untagged ground is NOT covered. Most OSM trail segments carry no
 * `sac_scale` at all, so this is a ceiling on what is KNOWN to be hard — never
 * a promise that a route has no hard sections. Anything user-facing must say so
 * (see `isWithinSacLimit`).
 */
interface PreferencesState {
  /** Hardest SAC grade the router may route over. Default T6. */
  maxSac: SacScale;
  /** True once the persisted value has loaded, so routing can wait for it
   *  rather than fetching every leg twice at startup. */
  _hydrated: boolean;
  setMaxSac: (scale: SacScale) => void;
}

/** Show the trail that exists; let the walker narrow it. */
export const DEFAULT_MAX_SAC: SacScale = 'difficult_alpine_hiking';

/** Stand-in for AsyncStorage outside React Native — see the `storage` note. */
const memoryStorage = (() => {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
    removeItem: async (k: string) => void m.delete(k),
  };
})();

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      maxSac: DEFAULT_MAX_SAC,
      _hydrated: false,
      setMaxSac: (maxSac) => set({ maxSac }),
    }),
    {
      name: 'preferences',
      // ⚠️ Node-safe. `src/api/brouter.ts` reads this store, and the build-time
      // scripts import brouter — under plain Node, Metro's resolution doesn't
      // apply and `@react-native-async-storage` resolves to its WEB build, whose
      // first `setItem` throws `ReferenceError: window is not defined` and kills
      // the process. React Native does define `window`, so this picks the real
      // AsyncStorage on device and a throwaway in-memory store in scripts —
      // where there is no user whose preference should be remembered anyway.
      storage: createJSONStorage(() =>
        typeof window === 'undefined' ? memoryStorage : AsyncStorage,
      ),
      partialize: (s) => ({ maxSac: s.maxSac }),
      onRehydrateStorage: () => (state) => {
        // Guard against a persisted value from an older build (or a hand-edited
        // store) that isn't a grade any more — fall back rather than asking
        // BRouter for a profile that doesn't exist.
        if (state && !SAC_SCALE_ORDER.includes(state.maxSac)) {
          state.maxSac = DEFAULT_MAX_SAC;
        }
        usePreferencesStore.setState({ _hydrated: true });
      },
    },
  ),
);

/**
 * The current ceiling, readable OUTSIDE React.
 *
 * `src/api/brouter.ts` is a plain module, not a hook, and it needs the ceiling
 * on every leg. Zustand's `getState` is the supported way to read a store from
 * non-component code.
 */
export function currentMaxSac(): SacScale {
  return usePreferencesStore.getState().maxSac;
}
