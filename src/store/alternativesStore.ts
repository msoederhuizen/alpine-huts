import { create } from 'zustand';
import type { PlanOutcome } from '../utils/planRoute';

/** One of the (≤3) routes offered when a generated route couldn't fully match
 *  the requested criteria — shared shape with the Plan tab's own carousel card. */
export interface AlternativeOption {
  key: string;
  label: string;
  recommended: boolean;
  outcome: PlanOutcome;
}

interface AlternativesState {
  /** The remembered alternatives from the last "no full match" generation, so
   *  the Map tab can offer the same swipe-to-compare as the Plan tab's
   *  carousel. Empty when there's nothing to compare (a clean match, or the
   *  user has since edited/finalised the route). */
  options: AlternativeOption[];
  /** Which alternative is currently previewed (drives what Map/Route show). */
  activeIndex: number;
  /** Whether these routes' legs are scenic — shared by all options in a batch
   *  (scenic is a generation input, not a per-route property). */
  scenic: boolean;
  /** Start (or replace) a comparison. */
  setOptions: (options: AlternativeOption[], scenic: boolean, activeIndex?: number) => void;
  setActiveIndex: (i: number) => void;
  /** End the comparison — does NOT touch the trip itself, so whichever route
   *  was last previewed simply stays as the current one. */
  clear: () => void;
}

export const useAlternativesStore = create<AlternativesState>((set) => ({
  options: [],
  activeIndex: 0,
  scenic: false,
  setOptions: (options, scenic, activeIndex = 0) =>
    set({ options, scenic, activeIndex }),
  setActiveIndex: (activeIndex) => set({ activeIndex }),
  clear: () => set({ options: [], activeIndex: 0 }),
}));
