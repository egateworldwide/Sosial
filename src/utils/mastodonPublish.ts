import { MASTODON_MAX_IMAGES, MASTODON_MAX_TEXT, mastodonBase } from './mastodonConfig';
import { getValidMastodon } from './mastodonAuth';

function merr(j: any, status: number, fallback: string): string {
  const m =
    j?.error_description ||
    (typeof j?.error === 'string' ? j.error : j?.error?.message) ||
    j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (status === 401) return 'Mastodon session expired — reconnect Mastodon.';
  if (status === 403) return `${base} — the app needs write access; reconnect Mastodon and approve it.`;
  if (status === 429) return 'Mastodon rate limit hit — wait a few minutes and retry.';
  return `${base} (${status})`;
}

function mimeFor(uri: string): string {
  const u = uri.toLowerCase().split('?')[0];
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.webm')) return 'video/webm';
  if (u.endsWith('.mp4')) return 'video/mp4';
  return 'image/jpeg';
}

function fitText(t: string): string {
  const s = (t ?? '').trim();
  if (s.length <= MASTODON_MAX_TEXT) return s;
  return s.slice(0, MASTODON_MAX_TEXT - 1) + '…';
}

/**
 * Multipart uploads must go through XMLHttpRequest — expo/fetch (SDK 57) can't
 * serialize React Native {uri,name,type} FormData parts, while XHR runs on the
 * native networking module and accepts file:// uris.
 */
function xhrForm(url: string, token: string, form: FormData, timeoutMs = 180000): Promise<any> {
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
      if (xhr.status === 401) return reject(new Error('Mastodon session expired — reconnect Mastodon.'));
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(new Error(merr(j, xhr.status, 'Mastodon media upload failed.')));
      }
      resolve(j);
    };
    xhr.onerror = () => reject(new Error('Network request failed — check your connection.'));
    xhr.ontimeout = () => reject(new Error('Mastodon upload timed out — try again.'));
    xhr.send(form as any);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Video uploads are processed async — poll until a public url exists. */
async function waitMediaReady(instance: string, token: string, id: string, timeoutMs = 120000): Promise<void> {
  const start = Date.now();
  let delay = 1000;
  for (;;) {
    const r = await fetch(`${mastodonBase(instance)}/api/v1/media/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j: any = await r.json().catch(() => ({}));
    if (j?.url) return;
    if (Date.now() - start >= timeoutMs) {
      throw new Error('Mastodon is still processing the video — try publishing again in a minute.');
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 5000);
  }
}

/** POST /api/v2/media — returns the media id to attach to a status. */
async function uploadMedia(instance: string, token: string, uri: string, kind: 'image' | 'video'): Promise<string> {
  const name = kind === 'video' ? 'sosial.mp4' : 'sosial.jpg';
  const form = new FormData();
  form.append('file', { uri, name, type: mimeFor(uri) } as any);
  const j = await xhrForm(`${mastodonBase(instance)}/api/v2/media`, token, form);
  if (!j?.id) throw new Error('Mastodon media upload failed.');
  if (!j.url) await waitMediaReady(instance, token, String(j.id));
  return String(j.id);
}

/**
 * Post a status. Mastodon allows up to 4 images OR a single video; media is
 * uploaded first, then referenced by id. Returns the new status id.
 */
export async function publishMastodon(opts: {
  text: string;
  imageUris?: string[];
  videoUri?: string;
}): Promise<string> {
  const { token, instance } = await getValidMastodon();
  const text = fitText(opts.text);
  const videoUri = opts.videoUri && opts.videoUri.trim() ? opts.videoUri : undefined;
  const images = videoUri ? [] : (opts.imageUris ?? []).filter(Boolean).slice(0, MASTODON_MAX_IMAGES);
  if (!text && !videoUri && images.length === 0) {
    throw new Error('Write something or attach media — Mastodon needs one of them.');
  }
  const mediaIds: string[] = [];
  for (let i = 0; i < images.length; i++) {
    try {
      mediaIds.push(await uploadMedia(instance, token, images[i], 'image'));
    } catch (e: any) {
      throw new Error(`Photo ${i + 1}/${images.length}: ${e?.message ?? 'upload failed'}`);
    }
  }
  if (videoUri) mediaIds.push(await uploadMedia(instance, token, videoUri, 'video'));
  const body: Record<string, any> = { status: text };
  if (mediaIds.length) body.media_ids = mediaIds;
  const r = await fetch(`${mastodonBase(instance)}/api/v1/statuses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.id) throw new Error(merr(j, r.status, 'Mastodon post failed.'));
  return String(j.id);
}
