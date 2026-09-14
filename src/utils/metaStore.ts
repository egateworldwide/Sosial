import * as SecureStore from 'expo-secure-store';

export interface MetaState {
  fbUserToken?: string;
  pageId?: string;
  pageName?: string;
  pageToken?: string;
  igToken?: string;
  igId?: string;
  igName?: string;
  threadsToken?: string;
  threadsId?: string;
  threadsName?: string;
}

const KEY = 'zap_meta_v1';

export async function loadMetaState(): Promise<MetaState> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveMetaState(patch: Partial<MetaState>): Promise<MetaState> {
  const cur = await loadMetaState();
  const next = { ...cur, ...patch };
  // drop cleared keys entirely
  for (const k of Object.keys(next) as (keyof MetaState)[]) {
    if (next[k] === undefined) delete next[k];
  }
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export async function clearMetaState(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {}
}
