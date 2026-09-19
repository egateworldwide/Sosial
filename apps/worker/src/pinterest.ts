/**
 * Pinterest publish adapter. Ports publishPinterest from src/utils/pinPublish.ts:
 * one Pin per image (inline base64, no separate upload step) plus an optional
 * video Pin (/v5/media register → PUT bytes → poll → create), all on the
 * user's default board from channel metadata. Access tokens (~30d) refresh via
 * HTTP Basic (app id:secret), Vault-backed.
 */
import { readSecret, updateSecret } from './db';
import { storageSign, storageDownload } from './rest';
import { env } from './env';
import { info } from './logger';

const PIN_API = 'https://api.pinterest.com/v5';
const PIN_TOKEN_ENDPOINT = 'https://api.pinterest.com/v5/oauth/token';
const PIN_SCOPES = 'boards:read,boards:write,pins:read,pins:write,user_accounts:read';
const MAX_IMAGES = 4;
const MAX_TITLE = 100;
const MAX_DESC = 800;
const MAX_BYTES = 10 * 1024 * 1024; // images must stay under 10 MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** Media poll ceiling: the Pin create happens once at the end, so a retry
 *  re-uploads but never double-posts. */
const MEDIA_POLL_MS = 3 * 60 * 1000;

interface Bundle {
  target: { id: string; provider: string; caption: string | null; options: any; status: string };
  post: { id: string; title: string; body: string };
  media: { storage_path: string; kind: string; mime_type: string | null; position: number }[];
  channel: { id: string; external_id: string; instance_url: string | null; metadata: any };
  secrets: { access_secret_id: string | null; refresh_secret_id: string | null; expires_at: string | null };
}

function perr(j: any, status: number, fallback: string): string {
  const m =
    j?.error_description ||
    (typeof j?.error === 'string' ? j.error : j?.error?.message) ||
    j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (status === 401) return 'Pinterest session expired — reconnect Pinterest.';
  if (status === 403) return `${base} — the app may lack a scope or production access; check developers.pinterest.com.`;
  if (status === 429) return 'Pinterest rate limit hit — the job will retry shortly.';
  return `${base} (${status})`;
}

/** Same Pinterest app credentials the app ships as EXPO_PUBLIC_PIN_*. */
function clientCreds(): { id: string; secret: string } {
  const id = env('PIN_CLIENT_ID') || env('PINTEREST_CLIENT_ID');
  const secret = env('PIN_CLIENT_SECRET') || env('PINTEREST_CLIENT_SECRET');
  if (!id || !secret) {
    throw new Error('Pinterest cloud publishing needs PIN_CLIENT_ID + PIN_CLIENT_SECRET on the worker (see apps/worker/.env.example).');
  }
  return { id, secret };
}

async function patchExpiry(channelId: string, expiresAt: Date): Promise<void> {
  const { required } = await import('./env');
  const base = required('WORKER_SUPABASE_URL').replace(/\/+$/, '');
  const k = required('WORKER_SERVICE_ROLE_KEY');
  const r = await fetch(`${base}/rest/v1/channel_tokens?channel_id=eq.${encodeURIComponent(channelId)}`, {
    method: 'PATCH',
    headers: {
      apikey: k,
      Authorization: `Bearer ${k}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ expires_at: expiresAt.toISOString(), updated_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`patch channel_tokens (${r.status}): ${t.slice(0, 200)}`);
  }
}

/** Valid access token, refreshing 10 min before expiry (Vault-backed). */
async function ensureToken(b: Bundle, force = false): Promise<string> {
  const fresh =
    !force && b.secrets.expires_at && Date.parse(b.secrets.expires_at) > Date.now() + 600000;
  if (fresh && b.secrets.access_secret_id) {
    const access = await readSecret(b.secrets.access_secret_id);
    if (access) return access;
  }
  if (!b.secrets.refresh_secret_id) {
    throw new Error('Pinterest session expired — toggle cloud publishing off and on in Connect to refresh.');
  }
  const refresh = await readSecret(b.secrets.refresh_secret_id);
  if (!refresh) throw new Error('Pinterest session expired — toggle cloud publishing off and on in Connect to refresh.');
  const { id, secret } = clientCreds();
  const r = await fetch(PIN_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      scope: PIN_SCOPES,
    }).toString(),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.access_token) {
    const msg = String(j?.error_description || j?.error || j?.message || 'Pinterest session expired');
    if (/invalid_grant|invalid_request|expired|unauthorized/i.test(msg)) {
      throw new Error('Pinterest session expired — reconnect Pinterest.');
    }
    throw new Error(`${msg} — toggle cloud publishing off and on in Connect to refresh.`);
  }
  const newAccess = String(j.access_token);
  const newRefresh = String(j.refresh_token || refresh);
  if (b.secrets.access_secret_id) await updateSecret(b.secrets.access_secret_id, newAccess);
  await updateSecret(b.secrets.refresh_secret_id, newRefresh);
  await patchExpiry(b.channel.id, new Date(Date.now() + (Number(j.expires_in) || 2592000) * 1000));
  return newAccess;
}

function fit(s: string, max: number): string {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function imageMime(storagePath: string, stored: string | null): string {
  if (/^image\//.test(stored ?? '')) return String(stored);
  const u = String(storagePath ?? '').toLowerCase().split('?')[0];
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function videoMime(storagePath: string, stored: string | null): string {
  if (/^video\//.test(stored ?? '')) return String(stored);
  const u = String(storagePath ?? '').toLowerCase().split('?')[0];
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function createImagePin(boardId: string, token: string, title: string, description: string, buf: Buffer, mime: string, tag: string): Promise<string> {
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`${tag}: over Pinterest’s 10 MB limit.`);
  }
  const r = await fetch(`${PIN_API}/pins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board_id: boardId,
      title: fit(title, MAX_TITLE),
      description: fit(description, MAX_DESC),
      media_source: {
        source_type: 'image_base64',
        content_type: mime,
        data: buf.toString('base64'),
      },
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.id) throw new Error(`${tag}: ${perr(j, r.status, 'Pinterest Pin failed.')}`);
  return String(j.id);
}

async function createVideoPin(boardId: string, token: string, title: string, description: string, buf: Buffer, mime: string): Promise<string> {
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // 1. register the upload
  const reg: any = await (
    await fetch(`${PIN_API}/media`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ media_type: 'video' }),
    })
  ).json().catch(() => ({}));
  const mediaId = String(reg?.media_id ?? '');
  const uploadUrl = String(reg?.upload_url ?? '');
  const params = (reg?.upload_parameters ?? {}) as Record<string, string>;
  if (!mediaId || !uploadUrl) {
    throw new Error(`Video: ${perr(reg, 0, 'Pinterest would not start a video upload.')}`);
  }
  // 2. PUT the bytes (multipart; the signed URL is the auth)
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  const ext = mime === 'video/quicktime' ? 'mov' : 'mp4';
  form.append('file', new Blob([new Uint8Array(buf) as unknown as BlobPart], { type: mime }), `video.${ext}`);
  const put = await fetch(uploadUrl, { method: 'PUT', body: form });
  if (!put.ok) throw new Error(`Video: bytes rejected (${put.status}).`);
  // 3. wait for processing
  const start = Date.now();
  let delay = 5000;
  for (;;) {
    const st: any = await (
      await fetch(`${PIN_API}/media/${encodeURIComponent(mediaId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json().catch(() => ({}));
    const status = String(st?.status ?? '').toLowerCase();
    if (status === 'succeeded') break;
    if (status === 'failed') throw new Error('Video: Pinterest could not process that video — try MP4 under 15 minutes.');
    if (Date.now() - start > MEDIA_POLL_MS) {
      throw new Error('Video: Pinterest is still processing the video — the job will retry shortly.');
    }
    await sleep(delay);
    delay = Math.min(delay + 2000, 10000);
  }
  // 4. create the Pin from the finished media
  const r = await fetch(`${PIN_API}/pins`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      board_id: boardId,
      title: fit(title, MAX_TITLE),
      description: fit(description, MAX_DESC),
      media_source: { source_type: 'video_id', media_id: mediaId },
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.id) throw new Error(`Video: ${perr(j, r.status, 'Pinterest video Pin failed.')}`);
  return String(j.id);
}

/**
 * Full target publish. Pinterest has no multi-photo post — one Pin per image
 * (same caption, numbered titles) plus a video Pin when attached.
 * Returns the first Pin id + permalink.
 */
export async function publishPinterestTarget(bundle: Bundle): Promise<{ remoteId: string; remoteUrl: string }> {
  const b = bundle as Bundle;
  const boardId = String(b.channel.metadata?.pinBoardId ?? '').trim();
  if (!boardId) throw new Error('Pick a Pinterest board in Connect first.');
  const token = await ensureToken(b);

  const caption = (b.target.caption ?? b.post.body ?? '').trim();
  const firstLine = caption.split('\n')[0];
  const images = (b.media ?? [])
    .filter((m) => m.kind === 'image')
    .sort((a, z) => a.position - z.position)
    .slice(0, MAX_IMAGES);
  const video = (b.media ?? [])
    .filter((m) => m.kind === 'video')
    .sort((a, z) => a.position - z.position)[0];
  if (images.length === 0 && !video) {
    throw new Error('Pinterest Pins need a photo or video — attach media first.');
  }
  const ids: string[] = [];
  if (video) {
    let raw: Buffer;
    try {
      raw = await storageDownload(await storageSign('post-media', video.storage_path), MAX_VIDEO_BYTES);
    } catch (e: any) {
      throw new Error(`Video: download failed — ${e?.message ?? 'storage error'}`);
    }
    ids.push(await createVideoPin(boardId, token, firstLine || 'Sosial video', caption, raw, videoMime(video.storage_path, video.mime_type)));
  }
  for (let i = 0; i < images.length; i++) {
    const m = images[i];
    const title = images.length > 1 && firstLine
      ? `${firstLine} (${i + 1}/${images.length})`
      : firstLine || 'Sosial Pin';
    let raw: Buffer;
    try {
      raw = await storageDownload(await storageSign('post-media', m.storage_path));
    } catch (e: any) {
      throw new Error(`Photo ${i + 1}/${images.length}: download failed — ${e?.message ?? 'storage error'}`);
    }
    ids.push(await createImagePin(boardId, token, title, caption, raw, imageMime(m.storage_path, m.mime_type), `Photo ${i + 1}/${images.length}`));
  }
  const first = ids[0] ?? '';
  info(`pinterest target ${b.target.id}: PINS x${ids.length}`);
  return { remoteId: first, remoteUrl: first ? `https://www.pinterest.com/pin/${encodeURIComponent(first)}/` : '' };
}
