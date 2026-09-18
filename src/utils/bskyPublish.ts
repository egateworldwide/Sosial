import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { BSKY_MAX_IMAGES, BSKY_MAX_TEXT, BSKY_BLOB_CAP } from './bskyConfig';
import { getValidBsky, BskyCreds } from './bskyAuth';

/** Dedicated video service (not the PDS) + bounded processing poll. */
const BSKY_VIDEO_HOST = 'https://video.bsky.app';
const BSKY_VIDEO_POLL_MS = 5 * 60 * 1000;

/** Bluesky errors look like { error, message }. */
function bskyErr(j: any, fallback: string): string {
  const m = j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (/blobtoolarge/i.test(base)) {
    return 'That photo is over Bluesky’s 1 MB limit — export a smaller size.';
  }
  return base;
}

function mimeFor(uri: string): string {
  const u = uri.toLowerCase().split('?')[0];
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function fitText(t: string): string {
  const s = (t ?? '').trim();
  const chars = [...s];
  if (chars.length <= BSKY_MAX_TEXT) return s;
  return chars.slice(0, BSKY_MAX_TEXT - 1).join('') + '…';
}

/** UTF-8 byte length without TextEncoder (not guaranteed on Hermes). */
function utf8len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/** Links only become tappable through explicit byte-offset facets. */
function linkFacets(text: string): any[] {
  const out: any[] = [];
  const re = /https?:\/\/[^\s<>()]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const url = m[0].replace(/[.,!?;:)\]]+$/, '');
    if (!url) continue;
    const start = utf8len(text.slice(0, m.index));
    out.push({
      index: { byteStart: start, byteEnd: start + utf8len(url) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }
  return out;
}

const B64ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 → bytes without atob (not guaranteed on Hermes). Shared with liPublish. */
export function b64ToBytes(b64: string): Uint8Array {
  const clean = (b64 ?? '').replace(/[^A-Za-z0-9+/]/g, '');
  const pad = clean.endsWith('==') ? 2 : 0;
  const out = new Uint8Array(Math.max(0, Math.floor((clean.length * 3) / 4) - pad));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64ABC.indexOf(clean[i] ?? '');
    const b = B64ABC.indexOf(clean[i + 1] ?? '');
    const c = B64ABC.indexOf(clean[i + 2] ?? '');
    const d = B64ABC.indexOf(clean[i + 3] ?? '');
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out[p++] = (n >> 16) & 255;
    if (p < out.length) out[p++] = (n >> 8) & 255;
    if (p < out.length) out[p++] = n & 255;
  }
  return out;
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
 * Bluesky blobs cap at 1 MB. Small files go as-is; bigger ones step down
 * through JPEG qualities (GIFs can't recompress without losing animation).
 * Returns the file to upload plus temp files the caller must delete.
 */
async function ensureSmallImage(uri: string, mime: string): Promise<{ uri: string; mime: string; cleanup: string[] }> {
  if (mime === 'image/gif') {
    if ((await fileSize(uri)) <= BSKY_BLOB_CAP) return { uri, mime, cleanup: [] };
    throw new Error('GIFs over 1 MB aren’t accepted by Bluesky — use a smaller one.');
  }
  if ((await fileSize(uri)) <= BSKY_BLOB_CAP && (mime === 'image/png' || mime === 'image/jpeg')) {
    return { uri, mime, cleanup: [] };
  }
  const cleanup: string[] = [];
  const drop = async (t: string) => {
    try {
      await FileSystem.deleteAsync(t, { idempotent: true });
    } catch {}
  };
  try {
    const probe = await manipulateAsync(uri, []);
    cleanup.push(probe.uri);
    const dims = [2000, 2000, 1600, 1280];
    const quals = [0.9, 0.75, 0.6, 0.45];
    for (let i = 0; i < quals.length; i++) {
      const scale = Math.min(1, dims[i] / Math.max(probe.width, probe.height, 1));
      const out = await manipulateAsync(
        uri,
        scale < 1
          ? [{ resize: { width: Math.max(1, Math.round(probe.width * scale)), height: Math.max(1, Math.round(probe.height * scale)) } }]
          : [],
        { compress: quals[i], format: SaveFormat.JPEG },
      );
      cleanup.push(out.uri);
      if ((await fileSize(out.uri)) <= BSKY_BLOB_CAP) {
        return { uri: out.uri, mime: 'image/jpeg', cleanup };
      }
    }
  } catch (e: any) {
    for (const t of cleanup) await drop(t);
    throw new Error(e?.message ?? 'Could not prepare that photo for Bluesky.');
  }
  for (const t of cleanup) await drop(t);
  throw new Error('That photo won’t squeeze under Bluesky’s 1 MB limit — export a smaller size.');
}

async function uploadBlob(creds: BskyCreds, bytes: Uint8Array, mime: string): Promise<any> {
  const r = await fetch(`${creds.pdsHost}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': mime },
    body: bytes as any,
  });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Bluesky session expired — reconnect Bluesky.');
  if (!r.ok || !j?.blob) throw new Error(bskyErr(j, 'Bluesky image upload failed.'));
  return j.blob;
}

function videoMimeFor(uri: string): string {
  const u = uri.toLowerCase().split('?')[0];
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

/**
 * The video service does NOT accept the session access token — it needs a
 * short-lived service token (getServiceAuth) whose audience is the account's
 * own PDS. Mirrors the worker adapter so both paths publish identically.
 */
async function getBskyServiceToken(creds: BskyCreds): Promise<string> {
  const host = creds.pdsHost.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const exp = Math.floor(Date.now() / 1000) + 1800;
  const url =
    `${creds.pdsHost}/xrpc/com.atproto.server.getServiceAuth` +
    `?aud=${encodeURIComponent(`did:web:${host}`)}` +
    `&lxm=${encodeURIComponent('com.atproto.repo.uploadBlob')}` +
    `&exp=${exp}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${creds.token}` } });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Bluesky session expired — reconnect Bluesky.');
  if (!r.ok || !j?.token) throw new Error(bskyErr(j, 'Bluesky video auth failed.'));
  return String(j.token);
}

/**
 * Upload to the video service and wait for processing; returns the embed
 * blob. The file streams from disk natively (Hermes can't build Blobs).
 */
async function uploadVideo(creds: BskyCreds, uri: string): Promise<any> {
  const svc = await getBskyServiceToken(creds);
  const mime = videoMimeFor(uri);
  const url =
    `${BSKY_VIDEO_HOST}/xrpc/app.bsky.video.uploadVideo` +
    `?did=${encodeURIComponent(creds.did)}&name=${encodeURIComponent('sosial.mp4')}`;
  const up = await FileSystem.uploadAsync(url, uri, {
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${svc}`, 'Content-Type': mime },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });
  let uj: any = {};
  try {
    uj = JSON.parse(up.body || '{}');
  } catch {}
  if (up.status === 401) throw new Error('Bluesky session expired — reconnect Bluesky.');
  if (up.status < 200 || up.status >= 300 || !uj?.jobId) {
    throw new Error(bskyErr(uj, 'Bluesky video upload failed.'));
  }
  const jobId = String(uj.jobId);
  const start = Date.now();
  for (;;) {
    const r = await fetch(
      `${BSKY_VIDEO_HOST}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`,
      { headers: { Authorization: `Bearer ${svc}` } },
    );
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Bluesky session expired — reconnect Bluesky.');
    // already_exists (and any other response) carrying a blob is usable.
    if (j?.jobStatus?.blob) return j.jobStatus.blob;
    if (String(j?.jobStatus?.state ?? '') === 'JOB_STATE_FAILED') {
      throw new Error(`Bluesky rejected the video — ${String(j?.jobStatus?.message ?? 'processing failed')}`);
    }
    if (Date.now() - start > BSKY_VIDEO_POLL_MS) {
      throw new Error('Bluesky is still processing the video — try again in a few minutes.');
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
}

/** A published post reference — the at:// uri plus the CID needed to reply. */
export interface BskyRef {
  uri: string;
  cid: string;
}

async function publishBskyWith(
  creds: BskyCreds,
  opts: {
    text: string;
    imageUris?: string[];
    videoUri?: string;
    /** reply chain: root is the first post, parent the one directly above */
    replyTo?: { root: BskyRef; parent: BskyRef };
  },
): Promise<BskyRef> {
  const text = fitText(opts.text);
  const uris = (opts.imageUris ?? []).filter(Boolean).slice(0, BSKY_MAX_IMAGES);
  const videoUri = opts.videoUri && opts.videoUri.trim() ? opts.videoUri : undefined;
  if (videoUri && uris.length > 0) {
    throw new Error('Bluesky can’t mix photos and video — send one or the other.');
  }
  if (!text && uris.length === 0 && !videoUri) {
    throw new Error('Write something or attach a photo or video — Bluesky needs one of them.');
  }
  let videoBlob: any = null;
  const images: any[] = [];
  if (videoUri) {
    try {
      videoBlob = await uploadVideo(creds, videoUri);
    } catch (e: any) {
      throw new Error(`Video: ${e?.message ?? 'upload failed'}`);
    }
  } else {
    const temps: string[] = [];
    try {
      for (let i = 0; i < uris.length; i++) {
        const tag = `Photo ${i + 1}/${uris.length}`;
        let small;
        try {
          small = await ensureSmallImage(uris[i], mimeFor(uris[i]));
        } catch (e: any) {
          throw new Error(`${tag}: ${e?.message ?? 'too big'}`);
        }
        temps.push(...small.cleanup);
        const b64 = await FileSystem.readAsStringAsync(small.uri, { encoding: FileSystem.EncodingType.Base64 });
        let blob;
        try {
          blob = await uploadBlob(creds, b64ToBytes(b64), small.mime);
        } catch (e: any) {
          throw new Error(`${tag}: ${e?.message ?? 'upload failed'}`);
        }
        images.push({ alt: text.slice(0, 200) || 'Image', image: blob });
      }
    } finally {
      for (const t of temps) {
        try {
          await FileSystem.deleteAsync(t, { idempotent: true });
        } catch {}
      }
    }
  }
  const record: Record<string, any> = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
  };
  const facets = text ? linkFacets(text) : [];
  if (facets.length) record.facets = facets;
  if (videoBlob) record.embed = { $type: 'app.bsky.embed.video', video: videoBlob };
  else if (images.length) record.embed = { $type: 'app.bsky.embed.images', images };
  if (opts.replyTo) {
    // Both refs are required; root pins the thread, parent the immediate reply.
    record.reply = {
      root: { uri: opts.replyTo.root.uri, cid: opts.replyTo.root.cid },
      parent: { uri: opts.replyTo.parent.uri, cid: opts.replyTo.parent.cid },
    };
  }
  const r = await fetch(`${creds.pdsHost}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: creds.did, collection: 'app.bsky.feed.post', record }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Bluesky session expired — reconnect Bluesky.');
  if (!r.ok || !j?.uri) throw new Error(bskyErr(j, 'Bluesky post failed.'));
  return { uri: String(j.uri), cid: String(j.cid ?? '') };
}

/**
 * Post to Bluesky: text (≤300, links auto-faceted) + up to 4 photos OR one
 * video, optionally as a chain reply. Retries once on an expired token.
 * Returns the post ref (uri + cid) so callers can chain.
 */
export async function publishBsky(opts: {
  text: string;
  imageUris?: string[];
  videoUri?: string;
  replyTo?: { root: BskyRef; parent: BskyRef };
}): Promise<BskyRef> {
  const creds = await getValidBsky();
  try {
    return await publishBskyWith(creds, opts);
  } catch (e: any) {
    if (/expired|unauthorized|401|ExpiredToken|invalid token/i.test(String(e?.message ?? ''))) {
      return await publishBskyWith(await getValidBsky(true), opts);
    }
    throw e;
  }
}
