import AsyncStorage from '@react-native-async-storage/async-storage';
import { uid } from '../constants';
import { pushPostToCloud, deleteCloudPost } from './cloudPosts';

export type PostStatus = 'draft' | 'queued' | 'approval' | 'sent';

export interface MediaAttachment {
  uri: string;
  kind: 'image' | 'video';
}

export type ChannelKey = 'facebook' | 'instagram' | 'threads' | 'tiktok' | 'x' | 'bluesky' | 'linkedin' | 'mastodon' | 'pinterest' | 'youtube';

/** Per-channel post format. TikTok is auto-derived from media (video vs photo). */
export type PlatformTypes = Partial<{
  facebook: 'post' | 'reel' | 'story';
  instagram: 'post' | 'reel' | 'story';
  threads: 'post' | 'ghost';
  tiktok: 'video' | 'photo';
  x: 'post';
  bluesky: 'post';
  linkedin: 'post';
  mastodon: 'post';
  pinterest: 'post';
  youtube: 'video' | 'short';
}>;

export const POST_TYPE_OPTIONS: Record<'facebook' | 'instagram' | 'threads' | 'x' | 'linkedin' | 'youtube' | 'bluesky' | 'mastodon' | 'pinterest' | 'tiktok', { id: string; label: string }[]> = {
  facebook: [
    { id: 'post', label: 'Post' },
    { id: 'reel', label: 'Reel' },
    { id: 'story', label: 'Story' },
  ],
  instagram: [
    { id: 'post', label: 'Post' },
    { id: 'reel', label: 'Reel' },
    { id: 'story', label: 'Story' },
  ],
  threads: [
    { id: 'post', label: 'Post' },
    { id: 'ghost', label: 'Ghost post' },
  ],
  x: [
    { id: 'post', label: 'Post' },
  ],
  linkedin: [
    { id: 'post', label: 'Post' },
  ],
  youtube: [
    { id: 'video', label: 'Video' },
    // Same upload — YouTube auto-classifies vertical ≤3min clips as Shorts.
    // No separate API exists, so this just records intent.
    { id: 'short', label: 'Short' },
  ],
  bluesky: [
    { id: 'post', label: 'Post' },
  ],
  mastodon: [
    { id: 'post', label: 'Post' },
  ],
  pinterest: [
    { id: 'post', label: 'Pin' },
  ],
  tiktok: [
    { id: 'video', label: 'Video' },
    { id: 'photo', label: 'Photo' },
  ],
};

/** Sensible default format for a channel given the attached media. */
export function defaultPlatformType(channel: ChannelKey, attachments: MediaAttachment[]): string {
  if (channel === 'tiktok') return attachments.some((a) => a.kind === 'video') ? 'video' : 'photo';
  if (channel === 'youtube') return 'video';
  if (channel === 'instagram') return attachments.some((a) => a.kind === 'video') ? 'reel' : 'post';
  return 'post';
}

/** A managed social post: title + photos/videos + description + channels + time + pipeline status. */
export interface ManagedPost {
  id: string;
  title: string;
  body: string;
  imageUri?: string;
  videoUri?: string;
  /** all attached media in order; legacy imageUri/videoUri mirror the first of each kind */
  attachments?: MediaAttachment[];
  platforms: string[];
  /** per-channel post format (reel/story/repost/quote…) */
  platformTypes?: PlatformTypes;
  /** Threads community/topic pill (topic_tag param, max 50 chars) */
  threadsTopic?: string;
  /** TikTok audience picked upfront (privacy level); falls back to asking at publish */
  ttPrivacy?: string;
  /** YouTube listing (public/unlisted/private); defaults to public */
  ytPrivacy?: string;
  /** Threads repost/quote source post URL or numeric media ID */
  sourceUrl?: string;
  scheduledAt?: number;
  createdAt: number;
  status?: PostStatus;
  sentAt?: number;
  /** per-channel remote ids returned at publish time (post/media/tweet/video id
   *  or at:// URI) — powers the per-post analytics in the Sent view. */
  remoteIds?: Record<string, string>;
}

/** Attachments with legacy fallback (posts saved before multi-attach existed). */
export function postAttachments(p: ManagedPost): MediaAttachment[] {
  if (p.attachments && p.attachments.length) return p.attachments;
  const out: MediaAttachment[] = [];
  if (p.imageUri) out.push({ uri: p.imageUri, kind: 'image' });
  if (p.videoUri) out.push({ uri: p.videoUri, kind: 'video' });
  return out;
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
  // Cloud mirror is best-effort: local save already succeeded above.
  void pushPostToCloud(rec).catch(() => {});
  return list;
}

export async function deleteManagedPost(id: string): Promise<ManagedPost[]> {
  const list = await loadManagedPosts();
  const next = list.filter((x) => x.id !== id);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  void deleteCloudPost(id).catch(() => {});
  return next;
}
