/**
 * YouTube publish adapter (Wave C). Ports src/utils/ytPublish.ts to the
 * worker: Google OAuth refresh from the Vault-backed token, then a resumable
 * upload (POST metadata → session URL in Location → single PUT of the bytes).
 * YouTube is video-only — photos/text alone throw a clear error instead of
 * silently skipping the channel.
 */
import { readSecret, updateSecret } from './db';
import { storageSign, storageDownload } from './rest';
import { env } from './env';
import { info } from './logger';

const YT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const YT_UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
const YT_MAX_TITLE = 100;
const YT_MAX_DESC = 5000;
/** Same single-PUT cap as the app — Buffers are held whole in memory. */
const YT_MAX_BYTES = 128 * 1024 * 1024;

type Privacy = 'public' | 'unlisted' | 'private';

interface Bundle {
  target: { id: string; provider: string; caption: string | null; options: any; status: string };
  post: { id: string; title: string; body: string };
  media: { storage_path: string; kind: string; mime_type: string | null; position: number }[];
  channel: { id: string; external_id: string; instance_url: string | null; metadata: any };
  secrets: { access_secret_id: string | null; refresh_secret_id: string | null; expires_at: string | null };
}

function yerr(j: any, status: number, fallback: string): string {
  const m =
    j?.error?.message ||
    (typeof j?.error === 'string' ? j.error : undefined) ||
    j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (status === 401) return '__EXPIRED__';
  if (status === 403) {
    if (/quota/i.test(base)) return 'YouTube API quota exhausted for today — uploads reset at midnight Pacific.';
    if (/accessNotConfigured|disabled/i.test(base)) return 'YouTube Data API v3 isn’t enabled on your Google Cloud project.';
    return `${base} — check the API is enabled and your account is a test user.`;
  }
  return `${base} (${status})`;
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

/** Google client id/secret — same pair the app ships as EXPO_PUBLIC_YT_*. */
function clientCreds(): { id: string; secret: string } {
  const id = env('YT_CLIENT_ID') || env('GOOGLE_CLIENT_ID');
  const secret = env('YT_CLIENT_SECRET') || env('GOOGLE_CLIENT_SECRET');
  if (!id || !secret) {
    throw new Error('YouTube cloud publishing needs YT_CLIENT_ID + YT_CLIENT_SECRET on the worker (see apps/worker/.env.example).');
  }
  return { id, secret };
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
    throw new Error('YouTube session expired — toggle cloud publishing off and on in Connect to refresh.');
  }
  const refresh = await readSecret(b.secrets.refresh_secret_id);
  if (!refresh) throw new Error('YouTube session expired — toggle cloud publishing off and on in Connect to refresh.');
  const { id, secret } = clientCreds();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: id,
    client_secret: secret,
  });
  const r = await fetch(YT_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.access_token) {
    const msg = String(j?.error_description || j?.error || 'YouTube session expired');
    throw new Error(`${msg} — toggle cloud publishing off and on in Connect to refresh.`);
  }
  const newAccess = String(j.access_token);
  const newRefresh = String(j.refresh_token || refresh);
  if (b.secrets.access_secret_id) await updateSecret(b.secrets.access_secret_id, newAccess);
  // Google only returns a refresh token on first consent — keep the old one.
  await updateSecret(b.secrets.refresh_secret_id, newRefresh);
  const expiresIn = Number(j.expires_in) || 3600;
  await patchExpiry(b.channel.id, new Date(Date.now() + expiresIn * 1000));
  return newAccess;
}

function videoMimeFor(path: string, declared: string | null): string {
  if (declared && /^video\//.test(declared)) return declared;
  const u = path.toLowerCase().split('?')[0];
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

function fit(s: string, max: number): string {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

/** Resumable upload: init POST → PUT the whole file to the session URL. */
async function uploadVideo(
  token: string,
  buf: Buffer,
  mime: string,
  title: string,
  description: string,
  privacy: Privacy,
): Promise<string> {
  const init = await fetch(`${YT_UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(buf.length),
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
  const put = await fetch(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime, 'Content-Length': String(buf.length) },
    body: Uint8Array.from(buf),
  });
  const j: any = await put.json().catch(() => ({}));
  if (put.status === 401) throw new Error('__EXPIRED__');
  if (!put.ok || !j?.id) throw new Error(yerr(j, put.status, 'YouTube upload failed.'));
  return String(j.id);
}

/** Full target publish: token → media → resumable upload. Returns the video id. */
export async function publishYouTubeTarget(bundle: Bundle): Promise<{ videoId: string; videoUrl: string }> {
  const b = bundle as Bundle;
  const video = (b.media ?? [])
    .filter((m) => m.kind === 'video')
    .sort((a, z) => a.position - z.position)[0];
  if (!video) throw new Error('YouTube needs a video — attach one to post here.');
  const caption = (b.target.caption ?? b.post.body ?? '').trim();
  const title = caption.split('\n')[0];
  const privacy = (String(b.target.options?.ytPrivacy ?? 'public') as Privacy) ?? 'public';
  info(`youtube target ${b.target.id}: 1 video (${privacy})`);

  let raw: Buffer;
  try {
    raw = await storageDownload(await storageSign('post-media', video.storage_path), YT_MAX_BYTES);
  } catch (e: any) {
    throw new Error(`Video: download failed — ${e?.message ?? 'storage error'}`);
  }
  const mime = videoMimeFor(video.storage_path, video.mime_type);

  const attempt = async (force: boolean): Promise<{ videoId: string; videoUrl: string }> => {
    const token = await ensureToken(b, force);
    try {
      const videoId = await uploadVideo(token, raw, mime, title || 'Sosial video', caption, privacy);
      return { videoId, videoUrl: `https://youtu.be/${videoId}` };
    } catch (e: any) {
      if (String(e?.message ?? '') === '__EXPIRED__' && !force) return attempt(true);
      if (String(e?.message ?? '') === '__EXPIRED__') {
        throw new Error('YouTube session expired — toggle cloud publishing off and on in Connect to refresh.');
      }
      throw e;
    }
  };
  return attempt(false);
}
