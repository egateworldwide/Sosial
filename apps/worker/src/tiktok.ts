/**
 * TikTok publish adapter (Wave D). Ports src/utils/tiktokPublish.ts +
 * refreshTikTokToken to the worker: Vault-backed token (24h access, rotating
 * 1-year refresh), FILE_UPLOAD video flow (init → 8MB chunked PUTs → poll),
 * and PULL_FROM_URL photo posts via the user's verified photo host (synced
 * into channel metadata — TikTok rejects any host the user hasn't verified).
 */
import { readSecret, updateSecret } from './db';
import { storageSign, storageDownload } from './rest';
import { env } from './env';
import { info } from './logger';

const TT_TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
const TT_API = 'https://open.tiktokapis.com';
const CHUNK = 8 * 1024 * 1024;
/** Same single-file cap as the YouTube adapter — Buffers are held whole. */
const TT_MAX_BYTES = 128 * 1024 * 1024;
/** Worker poll ceiling: a retry after init would double-post, so wait out
 *  processing instead of failing fast like the app (60s) does. */
const POLL_MS = 5 * 60 * 1000;

interface Bundle {
  target: { id: string; provider: string; caption: string | null; options: any; status: string };
  post: { id: string; title: string; body: string };
  media: { storage_path: string; kind: string; mime_type: string | null; position: number }[];
  channel: { id: string; external_id: string; instance_url: string | null; metadata: any };
  secrets: { access_secret_id: string | null; refresh_secret_id: string | null; expires_at: string | null };
}

/** Same human-readable mapping as the app (audit gate, caps, ownership). */
function friendly(code: string, fallback: string): string {
  const tag = code && code !== 'ok' ? ` [${code}]` : '';
  switch (code) {
    case 'unaudited_client_can_only_post_to_private_accounts':
      return 'TikTok rejected it: an unaudited app can only post from accounts added as test users — even “Only me” fails otherwise. Add this TikTok account as a test user in your TikTok developer portal, reconnect TikTok, and retry. Public posting needs TikTok app review.' + tag;
    case 'privacy_level_option_mismatch':
      return 'That privacy setting isn’t allowed for this account — pick another audience and re-queue.' + tag;
    case 'spam_risk_too_many_posts':
      return 'TikTok daily post limit reached — try again tomorrow.' + tag;
    case 'spam_risk_user_banned_from_posting':
      return 'TikTok blocked this account from posting.' + tag;
    case 'reached_active_user_cap':
      return 'TikTok daily publishing quota for this app is reached — try tomorrow.' + tag;
    case 'scope_not_authorized':
      return 'TikTok is missing the video.publish permission — disconnect and reconnect TikTok.' + tag;
    case 'access_token_invalid':
      return 'TikTok session expired — toggle cloud publishing off and on in Connect to refresh.' + tag;
    case 'url_ownership_unverified':
      return 'TikTok only pulls photos from a domain you own and have verified — set the photo host in Connect → TikTok (video posts don’t need it).' + tag;
    default:
      return fallback + tag;
  }
}

const ok = (j: any): boolean => j?.error?.code === 'ok';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/** TikTok client key/secret — same pair the app ships as EXPO_PUBLIC_TT_*. */
function clientCreds(): { key: string; secret: string } {
  const key = env('TT_CLIENT_KEY') || env('TIKTOK_CLIENT_KEY');
  const secret = env('TT_CLIENT_SECRET') || env('TIKTOK_CLIENT_SECRET');
  if (!key || !secret) {
    throw new Error('TikTok cloud publishing needs TT_CLIENT_KEY + TT_CLIENT_SECRET on the worker (see apps/worker/.env.example).');
  }
  return { key, secret };
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
    throw new Error('TikTok session expired — toggle cloud publishing off and on in Connect to refresh.');
  }
  const refresh = await readSecret(b.secrets.refresh_secret_id);
  if (!refresh) throw new Error('TikTok session expired — toggle cloud publishing off and on in Connect to refresh.');
  const { key, secret } = clientCreds();
  const r = await fetch(TT_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: key,
      client_secret: secret,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }).toString(),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.access_token) {
    const msg = String(j?.error?.message || j?.error?.code || 'TikTok session expired');
    if (/invalid_grant|invalid_request/i.test(msg)) {
      throw new Error('TikTok session expired — reconnect TikTok.');
    }
    throw new Error(`${msg} — toggle cloud publishing off and on in Connect to refresh.`);
  }
  const newAccess = String(j.access_token);
  const newRefresh = String(j.refresh_token || refresh);
  if (b.secrets.access_secret_id) await updateSecret(b.secrets.access_secret_id, newAccess);
  await updateSecret(b.secrets.refresh_secret_id, newRefresh);
  await patchExpiry(b.channel.id, new Date(Date.now() + Number(j.expires_in ?? 86400) * 1000));
  return newAccess;
}

function videoMimeFor(path: string, declared: string | null): string {
  if (declared && /^video\//.test(declared)) return declared;
  const u = path.toLowerCase().split('?')[0];
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

/** Poll one publish until terminal (bounded — see POLL_MS). */
async function pollStatus(publishId: string, token: string, kind: string): Promise<void> {
  const start = Date.now();
  let delay = 3000;
  for (;;) {
    const s = await fetch(`${TT_API}/v2/post/publish/status/fetch/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const sj: any = await s.json().catch(() => ({}));
    const status = String(sj?.data?.status ?? '');
    if (status === 'PUBLISH_COMPLETE') return;
    if (status === 'FAILED') {
      throw new Error(friendly(String(sj?.error?.code ?? ''), `TikTok failed to process the ${kind}.`));
    }
    if (Date.now() - start > POLL_MS) {
      throw new Error('TikTok is still processing — check the TikTok app in a few minutes (the post may still land).');
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), 10000);
  }
}

async function publishVideo(token: string, buf: Buffer, mime: string, title: string, privacy: string): Promise<string> {
  const size = buf.length;
  if (!size) throw new Error('Downloaded video is empty — re-attach it and re-queue.');
  const totalChunks = Math.max(1, Math.ceil(size / CHUNK));
  const chunkSize = Math.min(CHUNK, size);
  const init = await fetch(`${TT_API}/v2/post/publish/video/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: title.slice(0, 150),
        privacy_level: privacy,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks },
    }),
  });
  const initJ: any = await init.json().catch(() => ({}));
  const publishId = String(initJ?.data?.publish_id ?? '');
  const uploadUrl = String(initJ?.data?.upload_url ?? '');
  if (!ok(initJ) || !publishId || !uploadUrl) {
    throw new Error(friendly(String(initJ?.error?.code ?? ''), 'TikTok upload init failed.'));
  }
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(size, start + chunkSize);
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mime, 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
      body: Uint8Array.from(buf.subarray(start, end)),
    });
    await put.arrayBuffer().catch(() => null);
    if (put.status !== 200 && put.status !== 201 && put.status !== 206) {
      throw new Error(`TikTok upload stalled on part ${i + 1}/${totalChunks} — the job will retry shortly.`);
    }
  }
  await pollStatus(publishId, token, 'video');
  return publishId;
}

/** Upload one photo's bytes to the user's verified host (same contract as the app). */
async function hostPhoto(host: string, buf: Buffer, mime: string, tag: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf) as unknown as BlobPart], { type: mime }), 'sosial.jpg');
  const r = await fetch(host, { method: 'POST', body: form });
  const txt = (await r.text().catch(() => '')).trim();
  if (r.status >= 200 && r.status < 300) {
    if (txt.startsWith('http')) return txt;
    try {
      const j = JSON.parse(txt);
      const u = String(j?.url ?? j?.data?.url ?? '');
      if (u.startsWith('http')) return u;
    } catch {}
  }
  throw new Error(`${tag}: photo host rejected the upload — check the host in Connect → TikTok.`);
}

async function publishPhotos(token: string, urls: string[], title: string, privacy: string): Promise<string> {
  const init = await fetch(`${TT_API}/v2/post/publish/content/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: title.slice(0, 90),
        description: title.slice(0, 4000),
        privacy_level: privacy,
        disable_comment: false,
        auto_add_music: true,
      },
      source_info: { source: 'PULL_FROM_URL', photo_images: urls, photo_cover_index: 0 },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    }),
  });
  const j: any = await init.json().catch(() => ({}));
  const publishId = String(j?.data?.publish_id ?? '');
  if (!ok(j) || !publishId) {
    throw new Error(friendly(String(j?.error?.code ?? ''), 'TikTok photo post failed.'));
  }
  await pollStatus(publishId, token, 'photos');
  return publishId;
}

/** Full target publish. TikTok returns a publish id (no public URL yet). */
export async function publishTikTokTarget(bundle: Bundle): Promise<{ publishId: string }> {
  const b = bundle as Bundle;
  const privacy = String(b.target.options?.ttPrivacy ?? '').trim();
  if (!privacy) {
    throw new Error('TikTok audience not chosen — open the post, pick an audience, and re-queue (background runs never prompt).');
  }
  const caption = (b.target.caption ?? b.post.body ?? '').trim();
  const title = caption.split('\n')[0] || b.post.title || 'Sosial post';
  const videos = (b.media ?? [])
    .filter((m) => m.kind === 'video')
    .sort((a, z) => a.position - z.position);
  const images = (b.media ?? [])
    .filter((m) => m.kind === 'image')
    .sort((a, z) => a.position - z.position);
  const token = await ensureToken(b);

  if (videos.length > 0) {
    info(`tiktok target ${b.target.id}: VIDEO (${privacy})`);
    let raw: Buffer;
    try {
      raw = await storageDownload(await storageSign('post-media', videos[0].storage_path), TT_MAX_BYTES);
    } catch (e: any) {
      throw new Error(`Video: download failed — ${e?.message ?? 'storage error'}`);
    }
    const publishId = await publishVideo(token, raw, videoMimeFor(videos[0].storage_path, videos[0].mime_type), title, privacy);
    return { publishId };
  }
  if (images.length > 0) {
    const host = String(b.channel.metadata?.ttPhotoHost ?? '').trim().replace(/\/+$/, '');
    if (!host) {
      throw new Error('TikTok photo posts need your verified photo host — set it in Connect → TikTok (video posts work without it).');
    }
    info(`tiktok target ${b.target.id}: PHOTOS x${images.length} (${privacy})`);
    const urls: string[] = [];
    for (let i = 0; i < Math.min(images.length, 35); i++) {
      const m = images[i];
      let raw: Buffer;
      try {
        raw = await storageDownload(await storageSign('post-media', m.storage_path));
      } catch (e: any) {
        throw new Error(`Photo ${i + 1}: download failed — ${e?.message ?? 'storage error'}`);
      }
      const mime = /^image\//.test(m.mime_type ?? '') ? String(m.mime_type) : 'image/jpeg';
      urls.push(await hostPhoto(host, raw, mime, `Photo ${i + 1}`));
    }
    const publishId = await publishPhotos(token, urls, title, privacy);
    return { publishId };
  }
  throw new Error('TikTok needs a photo or video — text-only is not allowed by their API.');
}
