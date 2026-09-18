import * as FileSystem from 'expo-file-system/legacy';
import { X_MEDIA_UPLOAD, X_API, X_MAX_IMAGES, X_MAX_TEXT } from './xConfig';
import { getValidXToken } from './xAuth';

/** X error shapes: {error, error_description}, {title, detail}, {errors:[{message}]}. */
function xerr(j: any, fallback: string): string {
  const m =
    j?.error_description ||
    (typeof j?.error === 'string' ? j.error : j?.error?.message) ||
    j?.detail ||
    j?.errors?.[0]?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (/deplet|exhaust|credit|quota|usage|over.?cap/i.test(base)) {
    return `${base} — X posting quota is out. Check Usage in the developer portal (resets monthly) or upgrade to Basic.`;
  }
  return base;
}

const authH = (token: string) => ({ Authorization: `Bearer ${token}` });

/** JSON call with human errors for the statuses X actually returns. */
async function xjson(url: string, init: RequestInit, fallback: string): Promise<any> {
  const r = await fetch(url, init);
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('X session expired — reconnect X.');
  if (r.status === 403) {
    throw new Error(
      'X refused the request (403) — the X app needs Read+Write permission and posting quota (Basic tier or higher), then reconnect.',
    );
  }
  if (r.status === 429) throw new Error('X rate limit hit (429) — wait a few minutes and retry.');
  if (!r.ok) throw new Error(xerr(j, `${fallback} (${r.status})`));
  if (j?.errors?.length) throw new Error(xerr(j, fallback));
  return j;
}

/**
 * Multipart must go through XMLHttpRequest — expo/fetch (SDK 57) can't
 * serialize React Native {uri,name,type} FormData parts ("Unsupported
 * FormDataPart implementation"), while XHR runs on the native module.
 */
function xhrForm(url: string, token: string, form: FormData, timeoutMs = 120000): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      let j: any = {};
      try {
        j = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 401) return reject(new Error('X session expired — reconnect X.'));
      if (xhr.status === 403) {
        return reject(
          new Error(
            'X refused the upload (403) — the token needs the media.write scope: disconnect X and connect again.',
          ),
        );
      }
      if (xhr.status === 429) return reject(new Error('X rate limit hit (429) — wait a few minutes and retry.'));
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(xerr(j, `X upload failed (${xhr.status})`)));
      if (j?.errors?.length) return reject(new Error(xerr(j, 'X upload failed.')));
      resolve(j);
    };
    xhr.onerror = () => reject(new Error('Network request failed — check your connection.'));
    xhr.ontimeout = () => reject(new Error('X upload timed out — try again.'));
    xhr.send(form as any);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mimeFor(uri: string): string {
  const u = uri.toLowerCase().split('?')[0];
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function fitText(t: string): string {
  const s = (t ?? '').trim();
  if (s.length <= X_MAX_TEXT) return s;
  return s.slice(0, X_MAX_TEXT - 1) + '…';
}

async function fileSize(uri: string): Promise<number> {
  try {
    const info: any = await FileSystem.getInfoAsync(uri);
    if (info?.exists && typeof info.size === 'number' && info.size > 0) return info.size;
  } catch {}
  // fallback: measure via base64 length
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return Math.floor(b64.length * 0.75);
}

/**
 * One-shot image upload: multipart `media` bytes + `media_category`.
 * Photos finish synchronously — no INIT/APPEND/FINALIZE dance needed for
 * anything under X's 5 MB image cap (which covers everything this app makes).
 */
async function uploadOneImage(uri: string, token: string): Promise<string> {
  const total = await fileSize(uri);
  if (total > 5 * 1024 * 1024) {
    throw new Error('That photo is over X’s 5 MB image limit — export a smaller size.');
  }
  const mime = mimeFor(uri);
  const form = new FormData();
  form.append('media', { uri, name: 'sosial', type: mime } as any);
  form.append('media_category', mime === 'image/gif' ? 'tweet_gif' : 'tweet_image');
  const j = await xhrForm(X_MEDIA_UPLOAD, token, form);
  const mediaId = String(j?.data?.id ?? '');
  if (!mediaId) throw new Error(xerr(j, 'X image upload failed.'));
  const proc = j?.data?.processing_info;
  if (proc && proc.state !== 'succeeded') {
    await waitReady(mediaId, token);
  }
  return mediaId;
}

/** STATUS poll for async media (GIFs) — bounded, honors check_after_secs. */
async function waitReady(mediaId: string, token: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const s = await xjson(
      `${X_MEDIA_UPLOAD}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      { headers: authH(token) },
      'X media status failed.',
    );
    const info = s?.data?.processing_info;
    if (!info || info.state === 'succeeded') return;
    if (info.state === 'failed') {
      throw new Error(xerr(info.error, 'X could not process that image.'));
    }
    if (Date.now() - start >= timeoutMs) {
      throw new Error('X is still processing the image — try publishing again in a minute.');
    }
    await sleep(Math.min(10000, (Number(info.check_after_secs) || 5) * 1000));
  }
}

/** Resolve a pasted X URL (or numeric id) to a status id for replies. */
export function xStatusId(source: string): string {
  const s = (source ?? '').trim();
  if (!s) throw new Error('Paste the X post URL or ID first.');
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/(?:x\.com|twitter\.com)\/\w+\/status(?:es)?\/(\d+)/i);
  if (m) return m[1];
  throw new Error('Could not read that X URL — paste the full post link or numeric ID.');
}

/**
 * Post to X: text (≤280) + up to 4 photos, optionally as a reply.
 * Returns the tweet id. Videos aren't produced by this app — photo or text only.
 */
export async function publishX(opts: { text: string; imageUris?: string[]; replyTo?: string }): Promise<string> {
  const token = await getValidXToken();
  const text = fitText(opts.text);
  const uris = (opts.imageUris ?? []).filter(Boolean).slice(0, X_MAX_IMAGES);
  if (!text && uris.length === 0) {
    throw new Error('Write something or attach a photo — X needs one of them.');
  }
  const mediaIds: string[] = [];
  for (let i = 0; i < uris.length; i++) {
    try {
      mediaIds.push(await uploadOneImage(uris[i], token));
    } catch (e: any) {
      throw new Error(`Photo ${i + 1}/${uris.length}: ${e?.message ?? 'upload failed'}`);
    }
  }
  const body: Record<string, any> = {};
  if (text) body.text = text;
  if (opts.replyTo) body.reply = { in_reply_to_tweet_id: opts.replyTo };
  if (mediaIds.length) body.media = { media_ids: mediaIds };
  const j = await xjson(
    `${X_API}/tweets`,
    { method: 'POST', headers: { ...authH(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    'X post failed.',
  );
  if (!j?.data?.id) throw new Error(xerr(j, 'X post failed.'));
  return String(j.data.id);
}
