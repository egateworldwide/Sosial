import { TT_API } from './tiktokConfig';
import { getValidToken } from './tiktokAuth';

const CHUNK = 8 * 1024 * 1024; // 8MB parts — bounded memory, no giant buffers
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(code: string, fallback: string): string {
  // raw code rides along so failures are reportable without screenshots
  const tag = code && code !== 'ok' ? ` [${code}]` : '';
  switch (code) {
    case 'unaudited_client_can_only_post_to_private_accounts':
      return 'TikTok rejected it: an unaudited app can only post from accounts added as test users — even “Only me” fails otherwise. Add this TikTok account as a test user in your TikTok developer portal, reconnect TikTok, and retry. Public posting needs TikTok app review.' + tag;
    case 'privacy_level_option_mismatch':
      return 'That privacy setting isn’t allowed for this account — pick another.' + tag;
    case 'spam_risk_too_many_posts':
      return 'TikTok daily post limit reached — try again tomorrow.' + tag;
    case 'spam_risk_user_banned_from_posting':
      return 'TikTok blocked this account from posting.' + tag;
    case 'reached_active_user_cap':
      return 'TikTok daily publishing quota for this app is reached — try tomorrow.' + tag;
    case 'scope_not_authorized':
      return 'TikTok is missing the video.publish permission — disconnect and reconnect TikTok.' + tag;
    case 'access_token_invalid':
      return 'TikTok session expired — reconnect TikTok.' + tag;
    case 'url_ownership_unverified':
      return 'TikTok only pulls photos from a domain you own and have verified — photo posts need a verified domain (video posts don’t).' + tag;
    default:
      return fallback + tag;
  }
}

function ok(j: any): boolean {
  return j?.error?.code === 'ok';
}

function contentTypeFor(uri: string): string {
  const u = uri.split('?')[0].toLowerCase();
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

/** Poll a TikTok publish until terminal — check immediately, then back off. */
async function pollTikTokStatus(publishId: string, token: string, kind: string): Promise<string> {
  const start = Date.now();
  let delay = 2000;
  for (;;) {
    const sJ: any = await fetchJson(`${TT_API}/v2/post/publish/status/fetch/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id: publishId }),
    }, 20000);
    const status = String(sJ?.data?.status ?? '');
    if (status === 'PUBLISH_COMPLETE') return publishId;
    if (status === 'FAILED') {
      throw new Error(friendly(sJ?.error?.code, `TikTok failed to process the ${kind}.`));
    }
    if (Date.now() - start >= 60000) {
      throw new Error('TikTok is still processing — check your TikTok app in a few minutes.');
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), 8000);
  }
}

/**
 * expo/fetch (SDK 57 global fetch) has no file:// support and drops
 * Content-Range/Content-Length headers — both required by TikTok's
 * chunked upload. XMLHttpRequest still runs on the native Networking
 * module: it can read file:// URIs as Blobs and sends every header.
 */
function xhrRequest(
  method: string,
  url: string,
  opts?: { headers?: Record<string, string>; body?: any; responseType?: 'text' | 'blob'; timeoutMs?: number },
): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (opts?.headers) {
      for (const [k, v] of Object.entries(opts.headers)) xhr.setRequestHeader(k, v);
    }
    if (opts?.responseType) xhr.responseType = opts.responseType;
    // Without this the request can hang forever on a stalled connection
    // (timeout defaults to 0 = never) — the app then sits on an
    // undismissable spinner and looks frozen.
    if (opts?.timeoutMs) xhr.timeout = opts.timeoutMs;
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error('Network request failed — check your connection.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out — try again.'));
    xhr.send(opts?.body);
  });
}

/** fetch with a hard ceiling — plain fetch has no timeout and a dropped
 *  connection would await forever behind the loading overlay. */
async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: c.signal });
    return await r.json().catch(() => ({}));
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('TikTok took too long to answer — try again.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Direct Post a video: init -> chunked PUTs -> poll until published.
 * Throws human-readable messages (audit gate, privacy mismatch, daily caps).
 */
export async function publishTikTokVideo(opts: {
  title: string;
  privacyLevel: string;
  videoUri: string;
}): Promise<string> {
  const token = await getValidToken();

  // XHR (native Networking) can read file:// URIs — one Blob, sliced per
  // chunk, never the whole file decoded in JS memory.
  const fileXhr = await xhrRequest('GET', opts.videoUri, { responseType: 'blob', timeoutMs: 60000 });
  const blob: any = fileXhr.response;
  const size: number = blob?.size ?? 0;
  if (!size) throw new Error('Could not read the video file — re-attach it and try again.');
  const totalChunks = Math.max(1, Math.ceil(size / CHUNK));
  const chunkSize = Math.min(CHUNK, size);

  const initJ: any = await fetchJson(`${TT_API}/v2/post/publish/video/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: opts.title.slice(0, 150),
        privacy_level: opts.privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    }),
  }, 30000);
  const publishId: string | undefined = initJ?.data?.publish_id;
  const uploadUrl: string | undefined = initJ?.data?.upload_url;
  if (!ok(initJ) || !publishId || !uploadUrl) {
    throw new Error(friendly(initJ?.error?.code, 'TikTok upload init failed.'));
  }

  const ctype = contentTypeFor(opts.videoUri);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(size, start + chunkSize);
    const part = blob.slice(start, end);
    const putXhr = await xhrRequest('PUT', uploadUrl, {
      headers: {
        'Content-Type': ctype,
        'Content-Range': `bytes ${start}-${end - 1}/${size}`,
      },
      body: part,
      // 8MB parts on a slow mobile link need room; stalled ones must still die
      timeoutMs: 120000,
    });
    // TikTok answers chunk PUTs with 200/201/206 and usually an empty body
    if (putXhr.status !== 200 && putXhr.status !== 201 && putXhr.status !== 206) {
      throw new Error(`TikTok upload stalled on part ${i + 1}/${totalChunks} — try again.`);
    }
  }

  // processing is async — poll until terminal (fast backoff, no fixed 10s waits)
  return pollTikTokStatus(publishId, token, 'video');
}

/**
 * Direct Post photos (carousel): /content/init/ with PULL_FROM_URL —
 * TikTok pulls the images itself, so every uri must already be public.
 * Same status endpoint as video, so poll until PUBLISH_COMPLETE.
 */
export async function publishTikTokPhotos(opts: {
  title: string;
  privacyLevel: string;
  /** public https URLs, 1–35 */
  imageUrls: string[];
}): Promise<string> {
  const token = await getValidToken();
  if (!opts.imageUrls.length) throw new Error('TikTok photo post needs at least one photo.');

  const initJ: any = await fetchJson(`${TT_API}/v2/post/publish/content/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: opts.title.slice(0, 90),
        description: opts.title.slice(0, 4000),
        privacy_level: opts.privacyLevel,
        disable_comment: false,
        auto_add_music: true,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_images: opts.imageUrls,
        photo_cover_index: 0,
      },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    }),
  }, 30000);
  const publishId: string | undefined = initJ?.data?.publish_id;
  if (!ok(initJ) || !publishId) {
    throw new Error(friendly(initJ?.error?.code, 'TikTok photo post failed.'));
  }

  return pollTikTokStatus(publishId, token, 'photos');
}
