/**
 * X publish adapter (Wave A). Ports xPublish.ts + xAuth.ts refresh logic:
 * rotating-refresh session (client id travels in channel metadata), simple
 * multipart image upload (≤5 MB, GIFs included), POST /tweets.
 * Videos are rejected loudly — the app never produces X videos either.
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

export async function publishXTarget(bundle: Bundle): Promise<{ tweetId: string; tweetUrl: string }> {
  const b = bundle as Bundle;
  const text = (b.target.caption ?? b.post.body ?? '').trim();
  const sliced = text.length > X_MAX_TEXT ? text.slice(0, X_MAX_TEXT - 1) + '…' : text;
  const media = (b.media ?? []).sort((a, z) => a.position - z.position).slice(0, X_MAX_IMAGES);
  for (const m of media) {
    if (m.kind === 'video') throw new Error('X video posts aren’t supported — attach photos or post text only.');
  }
  if (!sliced && media.length === 0) throw new Error('Nothing to publish — empty text and no images.');
  info(`x target ${b.target.id}: ${media.length} image(s)`);

  const attempt = async (force: boolean): Promise<{ tweetId: string; tweetUrl: string }> => {
    const token = await ensureToken(b, force);
    const mediaIds: string[] = [];
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
    const body: Record<string, any> = {};
    if (sliced) body.text = sliced;
    const replyTo = String(b.target.options?.replyTo ?? '');
    if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
    if (mediaIds.length) body.media = { media_ids: mediaIds };
    try {
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
      const tweetId = String(j.data.id);
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
