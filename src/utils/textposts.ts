import AsyncStorage from '@react-native-async-storage/async-storage';
import { uid } from '../constants';

export interface TextPost {
  id: string;
  title: string;
  body: string;
  platforms: string[];
  scheduledAt?: number;
  createdAt: number;
}

const KEY = 'quickpost_text_posts_v1';

export async function loadTextPosts(): Promise<TextPost[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: TextPost[] = raw ? JSON.parse(raw) : [];
    return list.sort((a, b) => (b.scheduledAt ?? 0) - (a.scheduledAt ?? 0));
  } catch {
    return [];
  }
}

export async function saveTextPost(p: TextPost): Promise<TextPost[]> {
  const list = await loadTextPosts();
  const i = list.findIndex((x) => x.id === p.id);
  const rec = { ...p, id: p.id || uid('txt') };
  if (i >= 0) list[i] = rec;
  else list.unshift(rec);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  return list;
}

export async function deleteTextPost(id: string): Promise<TextPost[]> {
  const list = await loadTextPosts();
  const next = list.filter((x) => x.id !== id);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return next;
}
