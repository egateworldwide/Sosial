import { Alert, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system/legacy';
import type { QuickPost } from '../types';

/**
 * expo-media-library is loaded lazily (dynamic import) instead of a top-level
 * import, because old and new Expo Go apps ship DIFFERENT native modules:
 * - old Go (notably Android): only `ExpoMediaLibrary` (legacy entry works)
 * - new Go (notably iOS): only `ExpoMediaLibraryNext` (root entry works)
 * A top-level import crashes launch on whichever side lacks the module.
 * We probe root first, then legacy. Also note the root `saveToLibraryAsync`
 * is a stub that THROWS — the new API saves via `Asset.create()`.
 */
type MLHandle = { kind: 'next' | 'legacy'; mod: any };

async function getMediaLibrary(): Promise<MLHandle | null> {
  try {
    const mod = await import('expo-media-library');
    if (!mod.Asset || !mod.requestPermissionsAsync) throw new Error('no next api');
    return { kind: 'next', mod };
  } catch {
    // fall through to legacy
  }
  try {
    const mod = await import('expo-media-library/legacy');
    if (!mod.saveToLibraryAsync || !mod.requestPermissionsAsync) throw new Error('no legacy api');
    return { kind: 'legacy', mod };
  } catch {
    return null;
  }
}

export async function ensureMediaPermission(): Promise<boolean> {
  const ML = await getMediaLibrary();
  if (!ML) return false;
  try {
    const { status } = await ML.mod.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to save your posts.');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function saveOne(ML: MLHandle, uri: string): Promise<void> {
  if (ML.kind === 'next') {
    await ML.mod.Asset.create(uri);
  } else {
    await ML.mod.saveToLibraryAsync(uri);
  }
}

/** Capture a single ViewShot ref to a tmp png file */
export async function capturePage(ref: any, tag: string): Promise<string> {
  try {
    const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
    const dest = `${FileSystem.cacheDirectory ?? ''}quickpost_${tag}_${Date.now()}.png`;
    try {
      await FileSystem.copyAsync({ from: uri, to: dest });
      return dest;
    } catch {
      return uri;
    }
  } catch {
    throw new Error('Failed to capture page');
  }
}

/** Android fallback when the gallery native module is missing: let the user
 * pick a folder (e.g. Downloads) and write the PNGs there via Storage Access Framework. */
async function saveViaSAF(uris: string[]): Promise<number> {
  const SAF = (FileSystem as any).StorageAccessFramework;
  if (!SAF) return 0;
  try {
    const perm = await SAF.requestDirectoryPermissionsAsync();
    if (!perm.granted) return 0;
    let saved = 0;
    for (let i = 0; i < uris.length; i++) {
      try {
        const base64 = await FileSystem.readAsStringAsync(uris[i], {
          encoding: FileSystem.EncodingType.Base64,
        });
        const fileUri = await SAF.createFileAsync(
          perm.directoryUri,
          `quickpost_${Date.now()}_${i}.png`,
          'image/png',
        );
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        saved++;
      } catch (e) {
        console.warn('saf save failed', e);
      }
    }
    if (saved > 0) {
      Alert.alert('Saved', `Saved ${saved}/${uris.length} image(s) to the folder you picked.`);
    }
    return saved;
  } catch (e) {
    console.warn('saf failed', e);
    return 0;
  }
}

/** Capture every page ref to tmp png files (used by "Save all"). */
export async function saveAllImages(refs: any[], post: QuickPost, _sizeRatio: number): Promise<string[]> {
  const uris: string[] = [];
  for (let i = 0; i < post.pages.length; i++) {
    // let AutoFit measure passes + fonts settle so capture matches preview
    await new Promise((r) => setTimeout(r, 700));
    const ref = refs[i];
    if (!ref) continue;
    const uri = await capturePage(ref, `p${i}`);
    uris.push(uri);
  }
  if (uris.length === 0) throw new Error('Could not capture pages.');
  return uris;
}

/** Save URIs to the photo library, falling back to folder-save on Android
 * when the gallery write fails (Expo Go can't write to the media library). */
export async function saveUrisToGallery(uris: string[]) {
  const ML = await getMediaLibrary();
  if (!ML) {
    // Gallery native module missing (old Expo Go) — fall back gracefully
    if (Platform.OS === 'android') {
      const saved = await saveViaSAF(uris);
      if (saved > 0) return saved;
    }
    Alert.alert(
      'Gallery unavailable',
      'This Expo Go version cannot save to the gallery. Update Expo Go to the latest version, or use Share to save the images manually.',
    );
    return 0;
  }
  const ok = await ensureMediaPermission();
  if (!ok) return 0;
  // re-resolve (permission helper already probed, but keep one handle)
  const ML2 = await getMediaLibrary();
  if (!ML2) return 0;
  let saved = 0;
  const failed: string[] = [];
  for (const u of uris) {
    try {
      await saveOne(ML2, u);
      saved++;
    } catch (e) {
      console.warn('save failed', e);
      failed.push(u);
    }
  }
  if (saved === uris.length) {
    Alert.alert('Saved', `Saved ${saved}/${uris.length} image(s) to your gallery.`);
    return saved;
  }
  // Gallery write failed (typical on Android Expo Go) — save the rest to a folder
  if (Platform.OS === 'android' && failed.length > 0) {
    const viaFolder = await saveViaSAF(failed);
    if (viaFolder > 0) {
      if (saved > 0) {
        Alert.alert('Saved', `${saved} image(s) went to your gallery, ${viaFolder} to the folder you picked.`);
      }
      return saved + viaFolder;
    }
  }
  Alert.alert(
    'Could not save',
    saved > 0
      ? `Only ${saved}/${uris.length} image(s) saved. Try the Share button on each page to save them manually.`
      : 'The gallery refused the images. Try the Share button on each page to save them manually.',
  );
  return saved;
}

/** Share a single file */
export async function shareSingleFile(uri: string) {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
      return;
    }
    await Sharing.shareAsync(uri, { dialogTitle: 'Share your Zap' });
  } catch {
    Alert.alert('Share failed', 'Could not share file.');
  }
}
