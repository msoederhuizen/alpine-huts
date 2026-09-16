import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** User-contributed info for a hut, stored on-device. */
export interface HutUserData {
  /** Local file URIs of photos the user added. */
  photoUris?: string[];
  /** @deprecated legacy single-photo field; read for migration only. */
  photoUri?: string;
  /** Free-text notes the user typed (facilities, conditions, anything). */
  notes?: string;
}

/** Normalise to the list of user photos, tolerating the legacy single field. */
export function getUserPhotos(d?: HutUserData): string[] {
  if (d?.photoUris) return d.photoUris;
  return d?.photoUri ? [d.photoUri] : [];
}

interface HutUserDataState {
  data: Record<string, HutUserData>;
  addPhoto: (hutId: string, uri: string) => void;
  removePhoto: (hutId: string, uri: string) => void;
  clearPhotos: (hutId: string) => void;
  setNotes: (hutId: string, notes: string) => void;
  _hydrated: boolean;
}

export const useHutUserDataStore = create<HutUserDataState>()(
  persist(
    (set) => ({
      data: {},
      _hydrated: false,
      addPhoto: (hutId, uri) =>
        set((s) => {
          const cur = s.data[hutId];
          const next = [...getUserPhotos(cur), uri];
          return {
            data: { ...s.data, [hutId]: { ...cur, photoUri: undefined, photoUris: next } },
          };
        }),
      removePhoto: (hutId, uri) =>
        set((s) => {
          const cur = s.data[hutId];
          const next = getUserPhotos(cur).filter((u) => u !== uri);
          return {
            data: { ...s.data, [hutId]: { ...cur, photoUri: undefined, photoUris: next } },
          };
        }),
      clearPhotos: (hutId) =>
        set((s) => ({
          data: {
            ...s.data,
            [hutId]: { ...s.data[hutId], photoUri: undefined, photoUris: [] },
          },
        })),
      setNotes: (hutId, notes) =>
        set((s) => ({
          data: { ...s.data, [hutId]: { ...s.data[hutId], notes } },
        })),
    }),
    {
      name: 'alpine-huts.hut-user-data',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ data: s.data }),
      // See selectedRegionsStore.ts: must go through setState, not mutate the
      // callback argument, or subscribers never see `_hydrated` flip to true.
      onRehydrateStorage: () => () => {
        useHutUserDataStore.setState({ _hydrated: true });
      },
    },
  ),
);
