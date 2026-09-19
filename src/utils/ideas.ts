import AsyncStorage from '@react-native-async-storage/async-storage';
import { uid } from '../constants';

/** One chain segment: text plus an optional per-post photo/video.
 *  Publishing keeps today's rule — the head segment's media rides the post,
 *  replies stay text-only — so reply media never silently vanishes. */
export interface ThreadSeg {
  text: string;
  media: { uri: string; kind: 'image' | 'video' } | null;
}

/** A content idea: social-style title + description + optional image/video.
 *  Tapping "Design" spins up a design-studio project linked via designProjectId.
 *  `thread` holds an optional chain of segments when the idea is long-form. */
export interface Idea {
  id: string;
  title: string;
  body: string;
  imageUri?: string;
  videoUri?: string;
  thread?: ThreadSeg[];
  designProjectId?: string;
  createdAt: number;
}

/** Legacy ideas stored `thread` as bare strings — normalize on load so old
 *  chains keep working next to the new media-carrying segments. */
function normThread(t: unknown): ThreadSeg[] | undefined {
  if (!Array.isArray(t) || t.length === 0) return undefined;
  if (typeof t[0] === 'string') return (t as string[]).map((s) => ({ text: s, media: null }));
  return t as ThreadSeg[];
}

const KEY = 'zap_ideas_v1';

export async function loadIdeas(): Promise<Idea[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: Idea[] = raw ? JSON.parse(raw) : [];
    for (const idea of list) idea.thread = normThread(idea.thread);
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
