import * as FileSystem from 'expo-file-system/legacy';
import { YT_UPLOAD_API, YT_MAX_BYTES, YT_MAX_TITLE, YT_MAX_DESC } from './ytConfig';
import { getValidYt } from './ytAuth';
import { b64ToBytes } from './bskyPublish';

function yerr(j: any, status: number, fallback: string): string {
  const m =
    j?.error?.message ||
    (typeof j?.error === 'string' ? j.error : undefined) ||
    j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (status === 401) return 'YouTube session expired — reconnect YouTube.';
  if (status === 403) {
    if (/quota/i.test(base)) return 'YouTube API quota exhausted for today — uploads reset at midnight Pacific.';
    if (/accessNotConfigured|disabled/i.test(base)) return 'YouTube Data API v3 isn’t enabled on your Google Cloud project.';
    return `${base} — check the API is enabled and your account is a test user.`;
  }
  return `${base} (${status})`;
}

function mimeFor(uri: string): string {
  const u = uri.toLowerCase().split('?')[0];
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

function fit(s: string, max: number): string {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

async function fileSize(uri: string): Promise<number> {
  try {
    const info: any = await FileSystem.getInfoAsync(uri);
    if (info?.exists && typeof info.size === 'number' && info.size > 0) return info.size;
  } catch {}
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return Math.floor(b64.length * 0.75);
}

/**
 * Resumable upload in two hops: POST metadata → session URL in the Location
 * header → PUT raw bytes. Single PUT (no chunking) keeps memory bounded via
 * the YT_MAX_BYTES cap — fine for Shorts and short-form clips.
 */
async function uploadVideo(token: string, uri: string, title: string, description: string, privacy: 'public' | 'unlisted' | 'private'): Promise<string> {
  const size = await fileSize(uri);
  if (!size) throw new Error('Could not read that video file.');
  if (size > YT_MAX_BYTES) {
    throw new Error(`That video is ${(size / 1048576).toFixed(0)} MB — keep YouTube uploads under 128 MB.`);
  }
  const mime = mimeFor(uri);
  const init = await fetch(`${YT_UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({
      snippet: { title: fit(title, YT_MAX_TITLE), description: fit(description, YT_MAX_DESC), categoryId: '22' },
      status: { privacyStatus: privacy },
    }),
  });
  const sessionUrl = init.headers.get('location') ?? '';
  if (!init.ok || !sessionUrl) {
    const j: any = await init.json().catch(() => ({}));
    throw new Error(yerr(j, init.status, 'YouTube upload init failed.'));
  }
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const put = await fetch(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime, 'Content-Length': String(size) },
    body: b64ToBytes(b64) as any,
  });
  const j: any = await put.json().catch(() => ({}));
  if (!put.ok || !j?.id) throw new Error(yerr(j, put.status, 'YouTube upload failed.'));
  return String(j.id);
}

/**
 * Publish a video to YouTube (unlisted). YouTube is video-only — photos or
 * text alone throw a clear error instead of silently skipping the channel.
 * `kind` records intent only: Shorts need no separate API, YouTube
 * auto-classifies vertical ≤3min uploads, so both kinds upload identically.
 * Returns the new video id.
 */
export async function publishYouTube(opts: { text: string; videoUri?: string; kind?: 'video' | 'short'; privacy?: 'public' | 'unlisted' | 'private' }): Promise<string> {
  const { token } = await getValidYt();
  const videoUri = opts.videoUri && opts.videoUri.trim() ? opts.videoUri : undefined;
  if (!videoUri) {
    throw new Error('YouTube needs a video — attach one to post here.');
  }
  const firstLine = (opts.text ?? '').trim().split('\n')[0];
  return uploadVideo(token, videoUri, firstLine || 'Sosial video', opts.text ?? '', opts.privacy ?? 'public');
}
