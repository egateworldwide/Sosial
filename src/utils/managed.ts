import AsyncStorage from '@react-native-async-storage/async-storage';
import { uid } from '../constants';

export type PostStatus = 'draft' | 'queued' | 'approval' | 'sent';

/** A managed social post: title + optional photo/video + description + channels + time + pipeline status. */
export interface ManagedPost {
  id: string;
  title: string;
  body: string;
  imageUri?: string;
  videoUri?: string;
  platforms: string[];
  scheduledAt?: number;
  createdAt: number;
  status?: PostStatus;
  sentAt?: number;
}

/** Backfill status for posts saved before the pipeline existed. */
export function withStatus(p: ManagedPost): ManagedPost {
  if (p.status) return p;
  return { ...p, status: p.scheduledAt ? 'queued' : 'draft' };
}

const KEY = 'quickpost_managed_posts_v1';
const LEGACY_KEY = 'quickpost_text_posts_v1';

interface LegacyTextPost {
  id: string;
  title: string;
  body: string;
  platforms: string[];
  scheduledAt?: number;
  createdAt: number;
}

export async function loadManagedPosts(): Promise<ManagedPost[]> {
  try {
    let raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      // one-time migration from the old text-post store
      const legacyRaw = await AsyncStorage.getItem(LEGACY_KEY);
      if (legacyRaw) {
        const legacy: LegacyTextPost[] = JSON.parse(legacyRaw);
        const migrated: ManagedPost[] = legacy.map((t) => ({
          id: t.id,
          title: t.title,
          body: t.body,
          platforms: t.platforms?.length ? t.platforms : ['any'],
          scheduledAt: t.scheduledAt,
          createdAt: t.createdAt,
        }));
        await AsyncStorage.setItem(KEY, JSON.stringify(migrated));
        await AsyncStorage.removeItem(LEGACY_KEY);
        raw = JSON.stringify(migrated);
      }
    }
    const list: ManagedPost[] = raw ? JSON.parse(raw) : [];
    return list.map(withStatus);
  } catch {
    return [];
  }
}

export async function saveManagedPost(p: ManagedPost): Promise<ManagedPost[]> {
  const list = await loadManagedPosts();
  const i = list.findIndex((x) => x.id === p.id);
  const rec = { ...p, id: p.id || uid('post') };
  if (i >= 0) list[i] = rec;
  else list.unshift(rec);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  return list;
}

export async function deleteManagedPost(id: string): Promise<ManagedPost[]> {
  const list = await loadManagedPosts();
  const next = list.filter((x) => x.id !== id);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return next;
}
