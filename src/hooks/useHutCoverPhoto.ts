import { useQuery } from '@tanstack/react-query';
import { fetchRemoteHutPhoto } from '../api/hutPhoto';
import { getUserPhotos, useHutUserDataStore } from '../store/hutUserDataStore';
import type { Hut } from '../types/hut';
import { resolveHutImage, type HutImage } from '../utils/hutImage';

/**
 * The single "cover" photo for a hut: the user's first photo, else the OSM
 * image, else a remote lookup (Wikidata → Wikipedia). Used for the map card
 * thumbnail and the detail hero. Shares the ['hut-photo', id] query cache.
 */
export function useHutCoverPhoto(hut?: Hut): {
  photo: HutImage | null;
  isLoading: boolean;
} {
  const userData = useHutUserDataStore((s) => (hut ? s.data[hut.id] : undefined));
  const userPhotos = getUserPhotos(userData);
  const osmPhoto = hut ? resolveHutImage(hut) : null;

  const enabled =
    !!hut && userPhotos.length === 0 && !osmPhoto && !!(hut.wikidata || hut.wikipedia);
  const { data: remote, isFetching } = useQuery({
    queryKey: ['hut-photo', hut?.id],
    queryFn: ({ signal }) => fetchRemoteHutPhoto(hut!, signal),
    enabled,
    staleTime: 1000 * 60 * 60,
  });

  const photo = userPhotos[0]
    ? { url: userPhotos[0], credit: 'Your photo' }
    : (osmPhoto ?? remote ?? null);

  return { photo, isLoading: enabled && isFetching && !remote };
}
