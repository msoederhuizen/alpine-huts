import * as FileSystem from 'expo-file-system/legacy';

/**
 * Persistent storage for user-added hut photos. The image picker returns a URI
 * in a cache directory the OS may clear; copying into the app's document
 * directory makes photos survive app updates (they're still lost on uninstall —
 * cloud backup is a later milestone).
 */
const PHOTO_DIR = `${FileSystem.documentDirectory}hut-photos/`;

/** Copy a picked photo into permanent storage; returns the persisted URI. */
export async function savePhoto(hutId: string, srcUri: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(
    () => {},
  );
  const safe = hutId.replace(/[^a-zA-Z0-9]/g, '_');
  const dest = `${PHOTO_DIR}${safe}_${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: srcUri, to: dest });
  return dest;
}

/** Delete a single stored photo file by its URI. No-op if it's not ours. */
export async function deletePhotoFile(uri: string): Promise<void> {
  if (!uri.startsWith(PHOTO_DIR)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}
