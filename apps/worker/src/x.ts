/**
 * X publish adapter (Wave A). Ports xPublish.ts + xAuth.ts refresh logic:
 * rotating-refresh session (client id travels in channel metadata), simple
 * multipart image upload (≤5 MB, GIFs included), v2 chunked video upload
 * (INIT/APPEND/FINALIZE/STATUS), POST /tweets.
 */
import { readSecret, updateSecret } from './db';
import { storageSign, storageDownload } from './rest';
import { info } from './logger';

const X_TOKEN_ENDPOINT = 'https://api.x.com/2/oauth2/token';
const X_API = 'https://api.x.com/2';
const X_MEDIA_UPLOAD = 'https://api.x.com/2/media/upload';
const X_MAX_IMAGES = 4;
const X_MAX_TEXT = 280;
const X_IMG_CAP = 5 * 1024 * 1024;
const X_CHUNK_BYTES = 4 * 1024 * 1024; // APPEND segments must stay under 5 MB

interface Bundle {
  target: { id: string; provider: string; caption: string | null; options: any; status: string };
  post: { id: string; title: string; body: string };
  media: { storage_path: string; kind: string; mime_type: string | null; position: number }[];
  channel: { id: string; external_id: string; instance_url: string | null; metadata: any };
  secrets: { access_secret_id: string | null; refresh_secret_id: string | null; expires_at: string | null };
}

function xerr(j: any, fallback: string): string {
  const m =
    j?.error_description ||
    (typeof j?.error === 'string' ? j.error : j?.error?.message) ||
    j?.detail ||
    j?.errors?.[0]?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (/deplet|exhaust|credit|quota|usage|over.?cap/i.test(base)) {
    return `${base} — X posting quota is out (resets monthly) or needs Basic tier.`;
  }
  return base;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function xjson(url: string, init: RequestInit, fallback: string): Promise<any> {
  const r = await fetch(url, init);
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('__EXPIRED__');
  if (r.status === 403) {
    throw new Error('X refused (403) — the X app needs Read+Write permission and posting quota, then reconnect.');
  }
  if (r.status === 429) throw new Error('X rate limit hit (429).');
  if (!r.ok) throw new Error(xerr(j, `${fallback} (${r.status})`));
  if (j?.errors?.length) throw new Error(xerr(j, fallback));
  return j;
}

async function ensureToken(b: Bundle, force = false): Promise<string> {
  const fresh =
    !force && b.secrets.expires_at && Date.parse(b.secrets.expires_at) > Date.now() + 600000;
  if (fresh && b.secrets.access_secret_id) {
    const access = await readSecret(b.secrets.access_secret_id);
    if (access) return access;
  }
  if (!b.secrets.refresh_secret_id) {
    throw new Error('X session expired — toggle cloud publishing off and on in Connect to refresh.');
  }
  const clientId = String(b.channel.metadata?.xClientId ?? '');
  if (!clientId) {
    throw new Error('X channel imported before client-id metadata — toggle cloud publishing off and on in Connect to refresh.');
  }
  const refresh = await readSecret(b.secrets.refresh_secret_id);
  if (!refresh) throw new Error('X session expired — toggle cloud publishing off and on in Connect to refresh.');
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refresh,
  });
  const r = await fetch(X_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) {
    throw new Error(`${xerr(j, 'X session expired')} — toggle cloud publishing off and on in Connect to refresh.`);
  }
  const newAccess = String(j.access_token);
  const newRefresh = String(j.refresh_token || refresh);
  if (b.secrets.access_secret_id) await updateSecret(b.secrets.access_secret_id, newAccess);
  await updateSecret(b.secrets.refresh_secret_id, newRefresh);
  const { required } = await import('./env');
  const base = required('WORKER_SUPABASE_URL').replace(/\/+$/, '');
  const k = required('WORKER_SERVICE_ROLE_KEY');
  const pr = await fetch(
    `${base}/rest/v1/channel_tokens?channel_id=eq.${encodeURIComponent(b.channel.id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: k,
        Authorization: `Bearer ${k}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        expires_at: new Date(Date.now() + Number(j.expires_in ?? 7200) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!pr.ok) {
    const t = await pr.text().catch(() => '');
    throw new Error(`patch channel_tokens (${pr.status}): ${t.slice(0, 200)}`);
  }
  return newAccess;
}

function mimeFor(path: string, declared: string | null): string {
  if (declared) return declared;
  const u = path.toLowerCase().split('?')[0];
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function videoMimeFor(path: string, declared: string | null): string {
  if (declared && declared.startsWith('video/')) return declared;
  const u = path.toLowerCase().split('?')[0];
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

/** Poll STATUS after FINALIZE until the video finishes processing. */
async function waitVideoReady(mediaId: string, token: string, timeoutMs = 15 * 60 * 1000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const s = await xjson(
      `${X_MEDIA_UPLOAD}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
      'X video status failed.',
    );
    const info = s?.data?.processing_info;
    if (!info || info.state === 'succeeded') return;
    if (info.state === 'failed') throw new Error(xerr(info.error, 'X could not process that video.'));
    if (Date.now() - start >= timeoutMs) throw new Error('X is still processing the video — try again in a few minutes.');
    await sleep(Math.min(10000, (Number(info.check_after_secs) || 5) * 1000));
  }
}

/**
 * Video needs the v2 chunked flow: INIT (JSON) → APPEND (one multipart POST
 * per ≤4 MB segment) → FINALIZE → STATUS poll.
 */
async function uploadVideo(buf: Buffer, mime: string, token: string): Promise<string> {
  const init = await xjson(
    `${X_MEDIA_UPLOAD}/initialize`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: mime, total_bytes: buf.length, media_category: 'tweet_video' }),
    },
    'X video upload failed.',
  );
  const mediaId = String(init?.data?.id ?? '');
  if (!mediaId) throw new Error(xerr(init, 'X video upload failed.'));

  let segment = 0;
  for (let start = 0; start < buf.length; start += X_CHUNK_BYTES) {
    const chunk = buf.subarray(start, Math.min(start + X_CHUNK_BYTES, buf.length));
    const form = new FormData();
    form.append('segment_index', String(segment));
    form.append('media', new Blob([Uint8Array.from(chunk)], { type: 'application/octet-stream' }), `chunk${segment}`);
    await xjson(
      `${X_MEDIA_UPLOAD}/${encodeURIComponent(mediaId)}/append`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form as any },
      'X video upload failed.',
    );
    segment += 1;
  }

  const fin = await xjson(
    `${X_MEDIA_UPLOAD}/${encodeURIComponent(mediaId)}/finalize`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    'X video finalize failed.',
  );
  const proc = fin?.data?.processing_info;
  if (proc && proc.state !== 'succeeded') await waitVideoReady(mediaId, token);
  return mediaId;
}

async function uploadImage(buf: Buffer, mime: string, token: string): Promise<string> {
  if (buf.length > X_IMG_CAP) throw new Error('Photo over X’s 5 MB image limit.');
  const form = new FormData();
  // Uint8Array.from copies into a fresh ArrayBuffer — satisfies BlobPart
  // typing across @types/node versions (Buffer<ArrayBufferLike> doesn't).
  form.append('media', new Blob([Uint8Array.from(buf)], { type: mime }), 'sosial');
  form.append('media_category', mime === 'image/gif' ? 'tweet_gif' : 'tweet_image');
  const j = await xjson(
    X_MEDIA_UPLOAD,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form as any },
    'X image upload failed.',
  );
  const mediaId = String(j?.data?.id ?? '');
  if (!mediaId) throw new Error(xerr(j, 'X image upload failed.'));
  const proc = j?.data?.processing_info;
  if (proc && proc.state !== 'succeeded') {
    const start = Date.now();
    for (;;) {
      const s = await xjson(
        `${X_MEDIA_UPLOAD}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
        'X media status failed.',
      );
      const st = s?.data?.processing_info;
      if (!st || st.state === 'succeeded') break;
      if (st.state === 'failed') throw new Error(xerr(st.error, 'X could not process that image.'));
      if (Date.now() - start > 60000) throw new Error('X is still processing the image — retry in a minute.');
      await sleep(Math.min(10000, (Number(st.check_after_secs) || 5) * 1000));
    }
  }
  return mediaId;
}

/** POST one tweet. Text is trimmed to the cap here (replies included). */
async function sendTweet(token: string, text: string, mediaIds: string[], replyToId?: string): Promise<string> {
  const t = text.length > X_MAX_TEXT ? text.slice(0, X_MAX_TEXT - 1) + '…' : text;
  const body: Record<string, any> = {};
  if (t) body.text = t;
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
  if (mediaIds.length) body.media = { media_ids: mediaIds };
  const j = await xjson(
    `${X_API}/tweets`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    'X post failed.',
  );
  if (!j?.data?.id) throw new Error(xerr(j, 'X post failed.'));
  return String(j.data.id);
}

export async function publishXTarget(bundle: Bundle): Promise<{ tweetId: string; tweetUrl: string }> {
  const b = bundle as Bundle;
  const text = (b.target.caption ?? b.post.body ?? '').trim();
  const all = (b.media ?? []).sort((a, z) => a.position - z.position);
  const video = all.find((m) => m.kind === 'video');
  if (video && all.some((m) => m.kind !== 'video')) {
    throw new Error('X can’t mix photos and video — attach one or the other.');
  }
  const media = video ? [] : all.slice(0, X_MAX_IMAGES);

  // Manual/auto thread segments from the app. Media rides the head only;
  // replies are text-only and chain via in_reply_to_tweet_id.
  const segments = ((b.target.options?.thread as string[] | undefined) ?? [])
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  const chain = segments.length > 1 ? segments : null;
  const headText = chain ? chain[0] : text;
  if (!headText && all.length === 0) throw new Error('Nothing to publish — empty text and no media.');
  info(`x target ${b.target.id}: ${chain ? `THREAD ${chain.length}` : video ? '1 video' : `${media.length} image(s)`}`);

  const attempt = async (force: boolean): Promise<{ tweetId: string; tweetUrl: string }> => {
    const token = await ensureToken(b, force);
    const mediaIds: string[] = [];
    if (video) {
      let raw: Buffer;
      try {
        raw = await storageDownload(await storageSign('post-media', video.storage_path));
      } catch (e: any) {
        throw new Error(`Video: download failed — ${e?.message ?? 'storage error'}`);
      }
      try {
        mediaIds.push(await uploadVideo(raw, videoMimeFor(video.storage_path, video.mime_type), token));
      } catch (e: any) {
        if (String(e?.message ?? '') === '__EXPIRED__' && !force) return attempt(true);
        throw new Error(`Video: ${e?.message ?? 'upload failed'}`);
      }
    }
    for (let i = 0; i < media.length; i++) {
      let raw: Buffer;
      try {
        raw = await storageDownload(await storageSign('post-media', media[i].storage_path));
      } catch (e: any) {
        throw new Error(`Photo ${i + 1}: download failed — ${e?.message ?? 'storage error'}`);
      }
      try {
        mediaIds.push(await uploadImage(raw, mimeFor(media[i].storage_path, media[i].mime_type), token));
      } catch (e: any) {
        if (String(e?.message ?? '') === '__EXPIRED__' && !force) return attempt(true);
        throw new Error(`Photo ${i + 1}/${media.length}: ${e?.message ?? 'upload failed'}`);
      }
    }
    try {
      const tweetId = await sendTweet(token, headText, mediaIds);
      if (chain) {
        let parent = tweetId;
        for (let i = 1; i < chain.length; i++) {
          parent = await sendTweet(token, chain[i], [], parent);
        }
      }
      return { tweetId, tweetUrl: `https://x.com/i/status/${tweetId}` };
    } catch (e: any) {
      if (String(e?.message ?? '') === '__EXPIRED__' && !force) return attempt(true);
      if (String(e?.message ?? '') === '__EXPIRED__') {
        throw new Error('X session expired — toggle cloud publishing off and on in Connect to refresh.');
      }
      throw e;
    }
  };
  return attempt(false);
}
