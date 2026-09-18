import AsyncStorage from '@react-native-async-storage/async-storage';
import { uid } from '../constants';

/** A content idea: social-style title + description + optional image/video.
 *  Tapping "Design" spins up a design-studio project linked via designProjectId.
 *  `thread` holds an optional chain of segments when the idea is long-form. */
export interface Idea {
  id: string;
  title: string;
  body: string;
  imageUri?: string;
  videoUri?: string;
  thread?: string[];
  designProjectId?: string;
  createdAt: number;
}

const KEY = 'zap_ideas_v1';

export async function loadIdeas(): Promise<Idea[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: Idea[] = raw ? JSON.parse(raw) : [];
    return list.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function saveIdea(p: Partial<Idea> & { title: string }): Promise<Idea[]> {
  const list = await loadIdeas();
  const rec: Idea = {
    id: p.id || uid('idea'),
    title: p.title,
    body: p.body ?? '',
    imageUri: p.imageUri,
    videoUri: p.videoUri,
    thread: p.thread && p.thread.length > 0 ? p.thread : undefined,
    designProjectId: p.designProjectId,
    createdAt: p.createdAt ?? Date.now(),
  };
  const i = list.findIndex((x) => x.id === rec.id);
  if (i >= 0) list[i] = rec;
  else list.unshift(rec);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  return list;
}

export async function deleteIdea(id: string): Promise<Idea[]> {
  const list = await loadIdeas();
  const next = list.filter((x) => x.id !== id);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return next;
}
