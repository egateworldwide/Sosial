/**
 * Mastodon publish adapter. Ports publishMastodon from
 * src/utils/mastodonPublish.ts: media upload (POST /api/v2/media, poll async
 * video processing) → status (POST /api/v1/statuses), thread chains via
 * in_reply_to_id. Token is long-lived (no refresh dance); the instance comes
 * from the channel row. Same rules as the app: up to 4 images XOR 1 video,
 * 500-char text cap.
 */
import { readSecret } from './db';
import { storageSign, storageDownload } from './rest';
import { info } from './logger';

const MAX_IMAGES = 4;
const MAX_TEXT = 500;
/** Same single-file cap as the YouTube/TikTok adapters — Buffers are held whole. */
const VIDEO_MAX_BYTES = 128 * 1024 * 1024;
/** Media processing poll ceiling: the status post happens once at the end, so
 *  a retry re-uploads attachments but never double-posts. */
const MEDIA_POLL_MS = 3 * 60 * 1000;

interface Bundle {
  target: { id: string; provider: string; caption: string | null; options: any; status: string };
  post: { id: string; title: string; body: string };
  media: { storage_path: string; kind: string; mime_type: string | null; position: number }[];
  channel: { id: string; external_id: string; instance_url: string | null; metadata: any };
  secrets: { access_secret_id: string | null; refresh_secret_id: string | null; expires_at: string | null };
}

function merr(j: any, status: number, fallback: string): string {
  const m =
    j?.error_description ||
    (typeof j?.error === 'string' ? j.error : j?.error?.message) ||
    j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (status === 401) return 'Mastodon session expired — reconnect Mastodon in Connect.';
  if (status === 403) return `${base} — the app needs write access; reconnect Mastodon and approve it.`;
  if (status === 429) return 'Mastodon rate limit hit — the job will retry shortly.';
  return `${base} (${status})`;
}

function normalizeBase(instanceUrl: string | null): string {
  const host = String(instanceUrl ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .split('/')[0]
    .split('?')[0];
  if (!host || /\s/.test(host)) {
    throw new Error('Mastodon channel missing its instance — toggle cloud publishing off and on in Connect.');
  }
  return `https://${host}`;
}

function mimeFor(storagePath: string, stored: string | null, kind: 'image' | 'video'): string {
  if (kind === 'image' && /^image\//.test(stored ?? '')) return String(stored);
  const u = String(storagePath ?? '').toLowerCase().split('?')[0];
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.webm')) return 'video/webm';
  if (u.endsWith('.mp4')) return 'video/mp4';
  return kind === 'video' ? 'video/mp4' : 'image/jpeg';
}

const cap = (t: string): string => (t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + '…' : t);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Upload one attachment, polling async (video) processing. Returns the media id. */
async function uploadMedia(base: string, token: string, buf: Buffer, mime: string, kind: 'image' | 'video', tag: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf) as unknown as BlobPart], { type: mime }), kind === 'video' ? 'sosial.mp4' : 'sosial.jpg');
  const r = await fetch(`${base}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.id) throw new Error(`${tag}: ${merr(j, r.status, 'Mastodon media upload failed.')}`);
  const id = String(j.id);
  if (j.url) return id;
  const start = Date.now();
  let delay = 1000;
  for (;;) {
    const s = await fetch(`${base}/api/v1/media/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sj: any = await s.json().catch(() => ({}));
    if (s.ok && sj?.url) return id;
    if (Date.now() - start >= MEDIA_POLL_MS) {
      throw new Error(`${tag}: Mastodon is still processing the media — the job will retry shortly.`);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 5000);
  }
}

async function postStatus(base: string, token: string, text: string, mediaIds: string[], replyToId?: string): Promise<string> {
  const body: Record<string, any> = { status: text };
  if (mediaIds.length) body.media_ids = mediaIds;
  if (replyToId) body.in_reply_to_id = replyToId;
  const r = await fetch(`${base}/api/v1/statuses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.id) throw new Error(merr(j, r.status, 'Mastodon post failed.'));
  return String(j.id);
}

/** Full target publish. Returns the head status id + permalink. */
export async function publishMastodonTarget(bundle: Bundle): Promise<{ remoteId: string; remoteUrl: string }> {
  const b = bundle as Bundle;
  const base = normalizeBase(b.channel.instance_url);
  if (!b.secrets.access_secret_id) throw new Error('Mastodon token missing — re-enable cloud publishing.');
  const token = await readSecret(b.secrets.access_secret_id);
  if (!token) throw new Error('Mastodon session expired — reconnect Mastodon in Connect.');

  const items = (b.media ?? [])
    .filter((m) => m.kind === 'image' || m.kind === 'video')
    .sort((a, z) => a.position - z.position);
  // Mirror the app: a video post carries the first video only; images ride only
  // when there is no video (never both).
  const video = items.find((m) => m.kind === 'video');
  const images = video ? [] : items.filter((m) => m.kind === 'image').slice(0, MAX_IMAGES);

  const text = (b.target.caption ?? b.post.body ?? '').trim();
  if (!text && !video && images.length === 0) {
    throw new Error('Write something or attach media — Mastodon needs one of them.');
  }

  const mediaIds: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const m = images[i];
    let raw: Buffer;
    try {
      raw = await storageDownload(await storageSign('post-media', m.storage_path));
    } catch (e: any) {
      throw new Error(`Photo ${i + 1}/${images.length}: download failed — ${e?.message ?? 'storage error'}`);
    }
    mediaIds.push(await uploadMedia(base, token, raw, mimeFor(m.storage_path, m.mime_type, 'image'), 'image', `Photo ${i + 1}`));
  }
  if (video) {
    let raw: Buffer;
    try {
      raw = await storageDownload(await storageSign('post-media', video.storage_path), VIDEO_MAX_BYTES);
    } catch (e: any) {
      throw new Error(`Video: download failed — ${e?.message ?? 'storage error'}`);
    }
    mediaIds.push(await uploadMedia(base, token, raw, mimeFor(video.storage_path, video.mime_type, 'video'), 'video', 'Video'));
  }

  // Manual/auto thread segments from the app. Head carries media; replies are
  // text-only and chain via in_reply_to_id.
  const segments = ((b.target.options?.thread as string[] | undefined) ?? [])
    .map((s) => (s ?? '').trim())
    .filter(Boolean);

  let remoteId = '';
  if (segments.length > 1) {
    info(`mastodon target ${b.target.id}: THREAD ${segments.length}`);
    let parent: string | undefined;
    for (let i = 0; i < segments.length; i++) {
      const id = await postStatus(base, token, cap(segments[i]), i === 0 ? mediaIds : [], parent);
      if (i === 0) remoteId = id;
      parent = id;
    }
  } else {
    info(`mastodon target ${b.target.id}: ${video ? 'VIDEO' : images.length ? `PHOTOS x${images.length}` : 'TEXT'}`);
    remoteId = await postStatus(base, token, cap(text), mediaIds);
  }

  // Permalink needs the account username: https://instance/@user/<statusId>.
  let remoteUrl = `${base}/`;
  try {
    const v = await fetch(`${base}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const vj: any = await v.json().catch(() => ({}));
    const acct = String(vj?.acct ?? vj?.username ?? '').replace(/^@/, '').trim();
    if (v.ok && acct) remoteUrl = `${base}/@${encodeURIComponent(acct)}/${encodeURIComponent(remoteId)}`;
  } catch {}
  return { remoteId, remoteUrl };
}
