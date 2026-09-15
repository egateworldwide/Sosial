import * as SecureStore from 'expo-secure-store';

const KEY = 'zap_gemini_key_v1';

/** The user's own Gemini key — lives in the device keychain, never bundled. */
export async function getAiKey(): Promise<string | null> {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export async function setAiKey(v: string): Promise<void> {
  try {
    if (v.trim()) await SecureStore.setItemAsync(KEY, v.trim());
    else await SecureStore.deleteItemAsync(KEY);
  } catch {}
}
