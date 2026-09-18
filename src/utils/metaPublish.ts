import { graph, THREADS_API, IG_GRAPH } from './metaConfig';
import type { MediaAttachment } from './managed';
import { loadMetaState } from './metaStore';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/** Per-platform attachment caps. Code enforces these; the composer shows them. */
export const MAX_ATTACHMENTS = 10;
export const ATTACH_LIMITS: Record<string, { images: number; videos: number }> = {
  facebook: { images: 10, videos: 1 },
  instagram: { images: 10, videos: 1 },
  threads: { images: 1, videos: 1 },
  tiktok: { images: 10, videos: 1 },
  x: { images: 4, videos: 0 },
  bluesky: { images: 4, videos: 0 },
  linkedin: { images: 9, videos: 0 },
  mastodon: { images: 4, videos: 1 },
  pinterest: { images: 4, videos: 0 },
  youtube: { images: 0, videos: 1 },
};

/** Normalize legacy single-uri opts into an attachment list. */
function toAttachments(imageUri?: string, videoUri?: string, attachments?: MediaAttachment[]): MediaAttachment[] {
  if (attachments && attachments.length) return attachments;
  const out: MediaAttachment[] = [];
  if (imageUri) out.push({ uri: imageUri, kind: 'image' });
  if (videoUri) out.push({ uri: videoUri, kind: 'video' });
  return out;
}

function gerr(j: any, fallback: string): string {
  const m = j?.error?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  // Threads fails opaquely — translate their catch-all into something actionable
  if (/an unknown error occurred/i.test(base)) {
    return 'Threads gave no details — usually the photo URL it can’t fetch, text over 500 chars, or a rate limit. Try text-only to isolate.';
  }
  return base;
}

async function gjson(r: Response): Promise<any> {
  return r.json().catch(() => ({}));
}

/** Surface the raw upload response so opaque rupload failures are diagnosable. */
function rawErr(j: any, r: { status: number; text: string }, fallback: string): string {
  const m = gerr(j, '');
  if (m) return m;
  const snippet = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 200);
  return snippet ? `${fallback} (HTTP ${r.status}: ${snippet})` : `${fallback} (HTTP ${r.status})`;
}

/**
 * expo/fetch (SDK 57 global fetch) can't serialize React Native's
 * {uri,name,type} FormData parts — it throws "Unsupported FormDataPart
 * implementation". XMLHttpRequest still runs on the native Networking
 * module, which fully supports file:// uri parts. All multipart uploads
 * must go through here.
 */
function xhrSend(method: string, url: string, body?: any): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.timeout = 60000; // fail fast instead of hanging forever on an unresponsive host
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error('Network request failed — check your connection.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out — try again.'));
    xhr.send(body);
  });
}

/** Multipart POST returning parsed JSON (empty object on non-JSON). */
async function postFormJson(url: string, form: FormData): Promise<any> {
  const r = await xhrSend('POST', url, form);
  try {
    return JSON.parse(r.text);
  } catch {
    return {};
  }
}

/**
 * MVP public hosts for IG/Threads/TikTok media (they demand a public URL —
 * local files can't go direct). Tries three anonymous hosts in order; all
 * expire files eventually. Swap in your own storage when ready.
 */
export async function uploadPublic(uri: string, kind: 'image' | 'video'): Promise<string> {
  const name = kind === 'video' ? 'sosial.mp4' : 'sosial.jpg';
  const type = kind === 'video' ? 'video/mp4' : 'image/jpeg';

  // 1. 0x0.st — plain-text URL response
  try {
    const form = new FormData();
    form.append('file', { uri, name, type } as any);
    const r = await xhrSend('POST', 'https://0x0.st', form);
    const url = r.text.trim();
    if (r.status >= 200 && r.status < 300 && url.startsWith('http')) return url;
  } catch {}

  // 2. catbox.moe — plain-text URL response
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', { uri, name, type } as any);
    const r = await xhrSend('POST', 'https://catbox.moe/user/api.php', form);
    const url = r.text.trim();
    if (r.status >= 200 && r.status < 300 && url.startsWith('http')) return url;
  } catch {}

  // 3. tmpfiles.org — JSON response, page URL → direct via /dl/
  try {
    const form = new FormData();
    form.append('file', { uri, name, type } as any);
    const r = await xhrSend('POST', 'https://tmpfiles.org/api/v1/upload', form);
    const j = JSON.parse(r.text);
    const u = String(j?.data?.url ?? '');
    if (r.status >= 200 && r.status < 300 && u.startsWith('http')) {
      return u.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    }
  } catch {}

  throw new Error('Image hosts rejected the upload — check your connection, or post manually.');
}

/**
 * TikTok photo posts must be PULL_FROM_URL from a domain you own and verify
 * in the TikTok developer portal — anonymous hosts are rejected with
 * url_ownership_unverified. Upload to the configured endpoint (multipart
 * field "file"); it returns a JSON { url } or a plain-text URL.
 */
export async function uploadTikTokPhoto(uri: string): Promise<string> {
  const m = await loadMetaState();
  const host = (m.ttPhotoHost ?? '').trim().replace(/\/+$/, '');
  if (host) {
    try {
      const form = new FormData();
      form.append('file', { uri, name: 'sosial.jpg', type: 'image/jpeg' } as any);
      const r = await xhrSend('POST', host, form);
      if (r.status >= 200 && r.status < 300) {
        const txt = r.text.trim();
        if (txt.startsWith('http')) return txt;
        try {
          const j = JSON.parse(txt);
          const u = String(j?.url ?? j?.data?.url ?? '');
          if (u.startsWith('http')) return u;
        } catch {}
      }
      throw new Error('unexpected response — expected a URL');
    } catch (e: any) {
      throw new Error(`TikTok photo host failed: ${e?.message ?? 'upload error'}`);
    }
  }
  throw new Error('Add your TikTok photo host in Connect → TikTok to post photos. Video posts work without it.');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function igStatus(id: string, tok: string): Promise<string> {
  const s = await fetch(`${IG_GRAPH}/${id}?fields=status_code&access_token=${tok}`);
  const sj: any = await gjson(s);
  return String(sj.status_code ?? '');
}

/** Poll a container until FINISHED — check immediately, then back off. Bounded total wait. */
async function waitIgContainer(id: string, tok: string, label: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let delay = 1000;
  for (;;) {
    const status = await igStatus(id, tok);
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error(`Instagram could not process the ${label}.`);
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Instagram is still processing the ${label} — try publishing again in a minute.`);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 4000);
  }
}

/* ---------------- Facebook Page (bytes go direct — no host needed) ---------------- */

export async function publishFacebook(opts: {
  pageId: string;
  pageToken: string;
  message: string;
  imageUri?: string;
  videoUri?: string;
  attachments?: MediaAttachment[];
}): Promise<string> {
  const atts = toAttachments(opts.imageUri, opts.videoUri, opts.attachments);
  const videos = atts.filter((a) => a.kind === 'video');
  const images = atts.filter((a) => a.kind === 'image');
  if (videos.length) {
    // Facebook video posts take a single video
    const form = new FormData();
    form.append('source', { uri: videos[0].uri, name: 'sosial.mp4', type: 'video/mp4' } as any);
    form.append('description', opts.message);
    form.append('access_token', opts.pageToken);
    const j = await postFormJson(graph(`/${opts.pageId}/videos`), form);
    if (j.error || !j.id) throw new Error(gerr(j, 'Facebook video upload failed.'));
    return String(j.id);
  }
  if (images.length === 1) {
    const form = new FormData();
    form.append('source', { uri: images[0].uri, name: 'sosial.jpg', type: 'image/jpeg' } as any);
    form.append('caption', opts.message);
    form.append('access_token', opts.pageToken);
    const j = await postFormJson(graph(`/${opts.pageId}/photos`), form);
    if (j.error || (!j.id && !j.post_id)) throw new Error(gerr(j, 'Facebook photo upload failed.'));
    return String(j.post_id ?? j.id);
  }
  if (images.length > 1) {
    // multi-photo post: upload each unpublished, then attach (up to limit)
    const ids: string[] = [];
    for (const img of images.slice(0, ATTACH_LIMITS.facebook.images)) {
      const form = new FormData();
      form.append('source', { uri: img.uri, name: 'sosial.jpg', type: 'image/jpeg' } as any);
      form.append('published', 'false');
      form.append('access_token', opts.pageToken);
      const j = await postFormJson(graph(`/${opts.pageId}/photos`), form);
      if (j.error || !j.id) throw new Error(gerr(j, 'Facebook photo upload failed.'));
      ids.push(String(j.id));
    }
    const r = await fetch(graph(`/${opts.pageId}/feed`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: opts.message,
        attached_media: ids.map((id) => ({ media_fbid: id })),
        access_token: opts.pageToken,
      }),
    });
    const j = await gjson(r);
    if (j.error || !j.id) throw new Error(gerr(j, 'Facebook post failed.'));
    return String(j.id);
  }
  // text-only fallback
  const r = await fetch(graph(`/${opts.pageId}/feed`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: opts.message, access_token: opts.pageToken }),
  });
  const j = await gjson(r);
  if (j.error || !j.id) throw new Error(gerr(j, 'Facebook post failed.'));
  return String(j.id);
}

/* ---------------- Facebook Page (video goes direct — no host needed) ---------------- */

export async function publishFacebookReel(opts: {
  pageId: string;
  pageToken: string;
  message: string;
  videoUri?: string;
  attachments?: MediaAttachment[];
}): Promise<string> {
  const atts = toAttachments(undefined, opts.videoUri, opts.attachments);
  const video = atts.find((a) => a.kind === 'video');
  if (!video) throw new Error('Facebook Reels need a video.');
  // Reels need the same 3-phase resumable flow as stories — a plain
  // video_url POST fails with "(#100) upload_phase is required". Bytes go
  // direct, so no public host is needed.
  const { videoId, upRaw } = await fbUploadSession(opts.pageId, opts.pageToken, video.uri, 'video_reels', 'Facebook Reel');
  const fin = await fetch(
    graph(`/${opts.pageId}/video_reels?upload_phase=finish&video_id=${encodeURIComponent(videoId)}&description=${encodeURIComponent(opts.message)}&access_token=${encodeURIComponent(opts.pageToken)}`),
    { method: 'POST' },
  );
  const fj: any = await gjson(fin);
  if (!fin.ok || fj?.error) throw new Error(gerr(fj, 'Facebook Reel failed.'));
  await waitFbVideo(opts.pageToken, videoId, 'Facebook Reel', upRaw);
  return String(fj.post_id ?? fj.id ?? videoId);
}

export async function publishFacebookStory(opts: {
  pageId: string;
  pageToken: string;
  imageUri?: string;
  videoUri?: string;
  attachments?: MediaAttachment[];
}): Promise<string> {
  const atts = toAttachments(opts.imageUri, opts.videoUri, opts.attachments);
  const video = atts.find((a) => a.kind === 'video');
  if (video) return publishFacebookVideoStory(opts.pageId, opts.pageToken, video.uri);
  const image = atts.find((a) => a.kind === 'image');
  if (!image) throw new Error('Facebook stories need a photo or video.');
  const mediaUrl = image.uri.startsWith('http') ? image.uri : await uploadPublic(image.uri, 'image');
  const r = await fetch(graph(`/${opts.pageId}/photo_stories`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: mediaUrl, access_token: opts.pageToken }),
  });
  const j = await gjson(r);
  if (j.error || !j.id) throw new Error(gerr(j, 'Facebook story failed.'));
  return String(j.id);
}

/**
 * Raw-byte POST over XMLHttpRequest — expo/fetch mangles binary bodies and
 * custom upload headers (the same reason TikTok/Media uploads use XHR).
 */
function xhrBytes(url: string, headers: Record<string, string>, body: any, timeoutMs = 180000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) {
      try {
        xhr.setRequestHeader(k, v);
      } catch {}
    }
    xhr.timeout = timeoutMs;
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText ?? '' });
    xhr.onerror = () => reject(new Error('Network request failed — check your connection.'));
    xhr.ontimeout = () => reject(new Error('Facebook story upload timed out — try again.'));
    xhr.send(body);
  });
}

/**
 * Read a local file as a Blob via XHR (native Networking). Sending a Blob is
 * the one binary body React Native serializes correctly — a raw typed array
 * falls through to String(data) and corrupts the upload. Also yields the true
 * byte size, unlike a base64 length estimate.
 */
function xhrBlob(url: string, timeoutMs = 180000): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';
    xhr.timeout = timeoutMs;
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('Could not read the video file — re-attach it and try again.'));
    xhr.ontimeout = () => reject(new Error('Reading the video file timed out — try again.'));
    xhr.send();
  });
}

/**
 * Resumable upload session shared by video stories + reels — init
 * (upload_phase=start) returns a video id + rupload URL, bytes (or a
 * file_url header for remote files) go to rupload. A plain video_url POST
 * fails with "(#100) upload_phase is required".
 */
async function fbUploadSession(
  pageId: string,
  pageToken: string,
  uri: string,
  edge: 'video_stories' | 'video_reels',
  failLabel: string,
): Promise<{ videoId: string; upRaw: string }> {
  const remote = uri.startsWith('http');
  // 1. init — query-string params like every other working Meta call in this
  // file (this edge rejects JSON bodies with #100)
  const init = await fetch(graph(`/${pageId}/${edge}?upload_phase=start&access_token=${encodeURIComponent(pageToken)}`), {
    method: 'POST',
  });
  const ij: any = await gjson(init);
  const videoId = String(ij?.video_id ?? ij?.id ?? '');
  const uploadUrl = String(ij?.upload_url ?? '');
  if (!init.ok || ij?.error || !videoId || !uploadUrl) {
    throw new Error(gerr(ij, `${failLabel} upload init failed.`));
  }
  // 2. bytes — rupload authenticates with an OAuth header (the init call's
  // query token doesn't carry over), plus offset/file_size.
  const auth = { Authorization: `OAuth ${pageToken}` };
  let upRaw = '';
  if (remote) {
    const up = await xhrBytes(uploadUrl, { ...auth, file_url: uri }, null);
    let uj: any = {};
    try {
      uj = JSON.parse(up.text);
    } catch {}
    if (up.status < 200 || up.status >= 300 || uj?.error || uj?.success === false) {
      throw new Error(rawErr(uj, up, `${failLabel} upload failed.`));
    }
    upRaw = `rupload HTTP ${up.status}: ${(up.text ?? '').replace(/\s+/g, ' ').slice(0, 160)}`;
  } else {
    const blob = await xhrBlob(uri);
    const size = Number(blob?.size ?? 0);
    if (size <= 0) throw new Error('Could not read that video file — re-attach it and try again.');
    const up = await xhrBytes(
      uploadUrl,
      { ...auth, offset: '0', file_size: String(size), 'Content-Type': 'application/octet-stream' },
      blob,
    );
    let pj: any = {};
    try {
      pj = JSON.parse(up.text);
    } catch {}
    if (up.status < 200 || up.status >= 300 || pj?.error || pj?.success === false) {
      throw new Error(rawErr(pj, up, `${failLabel} upload failed.`));
    }
    upRaw = `rupload HTTP ${up.status}: ${(up.text ?? '').replace(/\s+/g, ' ').slice(0, 160)}`;
  }
  return { videoId, upRaw };
}

/**
 * Facebook processes video asynchronously — a story/reel stays invisible
 * until status flips to ready. Wait (bounded) and surface failures instead
 * of reporting a false success off a bare {success:true}.
 */
async function waitFbVideo(pageToken: string, videoId: string, failLabel: string, upRaw: string): Promise<void> {
  const start = Date.now();
  let delay = 1500;
  let statusRaw = '';
  for (;;) {
    let code = '';
    let detail = '';
    try {
      const r = await fetch(graph(`/${videoId}?fields=status&access_token=${encodeURIComponent(pageToken)}`));
      const txt = await r.text().catch(() => '');
      statusRaw = txt.replace(/\s+/g, ' ').slice(0, 220);
      const j: any = JSON.parse(txt || '{}');
      code = String(j?.status?.video_status ?? '');
      // processing failures live nested under processing_phase.errors (code
      // 1363040 = aspect ratio) — not top-level.
      const procErrs = j?.status?.processing_phase?.errors;
      detail = String(procErrs?.[0]?.message ?? j?.status?.errors?.[0]?.message ?? j?.error?.message ?? '');
    } catch {}
    if (code === 'ready') return;
    if (code === 'error') {
      if (/aspect ratio/i.test(detail)) {
        throw new Error(
          `${failLabel} needs a 9:16-ish video — this one is outside the allowed aspect range, so the processor rejected it. Fit it to 9:16 (1080×1920) and retry.`,
        );
      }
      const bits = [`${failLabel} rejected during processing${detail ? `: ${detail}` : '.'}`];
      if (upRaw) bits.push(`[${upRaw}]`);
      if (statusRaw) bits.push(`[status: ${statusRaw}]`);
      throw new Error(bits.join(' '));
    }
    if (Date.now() - start >= 60000) return; // still processing — it will appear shortly
    await sleep(delay);
    delay = Math.min(delay * 1.5, 5000);
  }
}

async function publishFacebookVideoStory(pageId: string, pageToken: string, uri: string): Promise<string> {
  const { videoId, upRaw } = await fbUploadSession(pageId, pageToken, uri, 'video_stories', 'Facebook story');
  // 3. finish → publishes
  const fin = await fetch(graph(`/${pageId}/video_stories?video_id=${encodeURIComponent(videoId)}&upload_phase=finish&access_token=${encodeURIComponent(pageToken)}`), {
    method: 'POST',
  });
  const fj: any = await gjson(fin);
  if (!fin.ok || fj?.error) throw new Error(gerr(fj, 'Facebook story publish failed.'));
  // 4. wait for processing so "success" means visible
  await waitFbVideo(pageToken, videoId, 'Facebook story', upRaw);
  return String(fj.post_id ?? fj.id ?? videoId);
}

/* ---------------- Instagram Business Login API (graph.instagram.com) ---------------- */

/**
 * Instagram rejects photos outside 4:5–1.91:1 ("aspect ratio not supported").
 * Center-crop local files into range (JPEG). GIFs are left alone to protect
 * animation; failures fall back to the original so the real error surfaces.
 */
async function fitIgPhoto(uri: string): Promise<{ uri: string; cleanup: string[] }> {
  const keep = { uri, cleanup: [] as string[] };
  try {
    const lower = uri.toLowerCase().split('?')[0];
    if (lower.endsWith('.gif')) return keep;
    const probe: any = await manipulateAsync(uri, []);
    const w = Number(probe.width) || 0;
    const h = Number(probe.height) || 0;
    if (!w || !h) return keep;
    const aspect = w / h;
    let crop: { originX: number; originY: number; width: number; height: number } | null = null;
    if (aspect < 0.8) {
      const nh = Math.floor(w / 0.8);
      crop = { originX: 0, originY: Math.floor((h - nh) / 2), width: w, height: nh };
    } else if (aspect > 1.91) {
      const nw = Math.floor(h * 1.91);
      crop = { originX: Math.floor((w - nw) / 2), originY: 0, width: nw, height: h };
    }
    if (!crop) return keep;
    const out: any = await manipulateAsync(uri, [{ crop }], { compress: 0.92, format: SaveFormat.JPEG });
    return { uri: String(out.uri), cleanup: [String(out.uri)] };
  } catch {
    return keep;
  }
}

export async function publishInstagram(opts: {
  igId: string;
  igToken: string;
  caption: string;
  imageUri?: string;
  videoUri?: string;
  attachments?: MediaAttachment[];
}): Promise<string> {
  const atts = toAttachments(opts.imageUri, opts.videoUri, opts.attachments);
  const videos = atts.filter((a) => a.kind === 'video');
  const images = atts.filter((a) => a.kind === 'image');
  if (!atts.length) throw new Error('Instagram needs a photo or video — text-only is not allowed by their API.');
  const tok = encodeURIComponent(opts.igToken);
  if (videos.length) {
    // reels take a single video
    const mediaUrl = videos[0].uri.startsWith('http') ? videos[0].uri : await uploadPublic(videos[0].uri, 'video');
    const c = await fetch(
      `${IG_GRAPH}/${opts.igId}/media?media_type=REELS&video_url=${encodeURIComponent(mediaUrl)}&caption=${encodeURIComponent(opts.caption)}&share_to_feed=true&access_token=${tok}`,
      { method: 'POST' },
    );
    const cj: any = await gjson(c);
    if (cj.error || !cj.id) throw new Error(gerr(cj, 'Instagram reel container failed.'));
    // reels transcode async — poll until ready, then publish
    await waitIgContainer(String(cj.id), tok, 'video', 60000);
    const p = await fetch(`${IG_GRAPH}/${opts.igId}/media_publish?creation_id=${encodeURIComponent(String(cj.id))}&access_token=${tok}`, { method: 'POST' });
    const pj: any = await gjson(p);
    if (pj.error || !pj.id) throw new Error(gerr(pj, 'Instagram publish failed.'));
    return String(pj.id);
  }
  const urls: string[] = [];
  const cleanups: string[] = [];
  try {
  for (const img of images.slice(0, ATTACH_LIMITS.instagram.images)) {
    let uri = img.uri;
    if (!uri.startsWith('http')) {
      const f = await fitIgPhoto(uri);
      cleanups.push(...f.cleanup);
      uri = f.uri;
    }
    urls.push(uri.startsWith('http') ? uri : await uploadPublic(uri, 'image'));
  }
  if (urls.length === 1) {
    const c = await fetch(
      `${IG_GRAPH}/${opts.igId}/media?image_url=${encodeURIComponent(urls[0])}&caption=${encodeURIComponent(opts.caption)}&access_token=${tok}`,
      { method: 'POST' },
    );
    const cj: any = await gjson(c);
    if (cj.error || !cj.id) throw new Error(gerr(cj, 'Instagram container failed. Image URLs must be public JPEG/PNG.'));
    await waitIgContainer(String(cj.id), tok, 'photo', 20000);
    const p = await fetch(`${IG_GRAPH}/${opts.igId}/media_publish?creation_id=${encodeURIComponent(String(cj.id))}&access_token=${tok}`, { method: 'POST' });
    const pj: any = await gjson(p);
    if (pj.error || !pj.id) throw new Error(gerr(pj, 'Instagram publish failed.'));
    return String(pj.id);
  }
  // carousel: one child container per photo, then a carousel parent
  const children: string[] = [];
  for (const u of urls) {
    const c = await fetch(
      `${IG_GRAPH}/${opts.igId}/media?image_url=${encodeURIComponent(u)}&is_carousel_item=true&access_token=${tok}`,
      { method: 'POST' },
    );
    const cj: any = await gjson(c);
    if (cj.error || !cj.id) throw new Error(gerr(cj, 'Instagram carousel item failed.'));
    children.push(String(cj.id));
  }
  // children transcode independently — wait for all in parallel, not one at a time
  await Promise.all(children.map((id) => waitIgContainer(id, tok, 'photo', 20000)));
  const c = await fetch(
    `${IG_GRAPH}/${opts.igId}/media?media_type=CAROUSEL&children=${children.map(encodeURIComponent).join(',')}&caption=${encodeURIComponent(opts.caption)}&access_token=${tok}`,
    { method: 'POST' },
  );
  const cj: any = await gjson(c);
  if (cj.error || !cj.id) throw new Error(gerr(cj, 'Instagram carousel failed.'));
  await waitIgContainer(String(cj.id), tok, 'carousel', 30000);
  const p = await fetch(`${IG_GRAPH}/${opts.igId}/media_publish?creation_id=${encodeURIComponent(String(cj.id))}&access_token=${tok}`, { method: 'POST' });
  const pj: any = await gjson(p);
  if (pj.error || !pj.id) throw new Error(gerr(pj, 'Instagram publish failed.'));
  return String(pj.id);
  } finally {
    for (const t of cleanups) {
      try { await FileSystem.deleteAsync(t, { idempotent: true }); } catch {}
    }
  }
}


export async function publishInstagramStory(opts: {
  igId: string;
  igToken: string;
  caption: string;
  imageUri?: string;
  videoUri?: string;
  attachments?: MediaAttachment[];
}): Promise<string> {
  const atts = toAttachments(opts.imageUri, opts.videoUri, opts.attachments);
  if (!atts.length) throw new Error('Instagram stories need a photo or video.');
  const tok = encodeURIComponent(opts.igToken);
  const first = atts[0];
  const mediaUrl = first.uri.startsWith('http') ? first.uri : await uploadPublic(first.uri, first.kind);
  const field = first.kind === 'video' ? 'video_url' : 'image_url';
  const c = await fetch(
    `${IG_GRAPH}/${opts.igId}/media?media_type=STORIES&${field}=${encodeURIComponent(mediaUrl)}&caption=${encodeURIComponent(opts.caption)}&access_token=${tok}`,
    { method: 'POST' },
  );
  const cj: any = await gjson(c);
  if (cj.error || !cj.id) throw new Error(gerr(cj, 'Instagram story container failed.'));
  // video stories transcode for a while — 2 min beats failing at 30s
  await waitIgContainer(String(cj.id), tok, 'story', 120000);
  const p = await fetch(`${IG_GRAPH}/${opts.igId}/media_publish?creation_id=${encodeURIComponent(String(cj.id))}&access_token=${tok}`, { method: 'POST' });
  const pj: any = await gjson(p);
  if (pj.error || !pj.id) throw new Error(gerr(pj, 'Instagram publish failed.'));
  return String(pj.id);
}

/* ---------------- Threads (URL-only media) ---------------- */

export async function publishThreads(opts: {
  threadsId: string;
  token: string;
  text: string;
  imageUri?: string;
  videoUri?: string;
  attachments?: MediaAttachment[];
  ghost?: boolean;
  /** community/topic pill — 1–50 chars, no periods or ampersands (API rule) */
  topicTag?: string;
}): Promise<string> {
  const tok = encodeURIComponent(opts.token);
  const atts = toAttachments(opts.imageUri, opts.videoUri, opts.attachments);
  // Threads caps text at 500 chars — over-length posts fail opaquely server-side
  const text = opts.text.length > 500 ? opts.text.slice(0, 499) + '…' : opts.text;
  // Threads takes a single attachment — first item wins
  const first = atts[0];
  const kind = !first ? 'TEXT' : first.kind === 'video' ? 'VIDEO' : 'IMAGE';
  let mediaUrl = '';
  if (first) {
    mediaUrl = first.uri.startsWith('http') ? first.uri : await uploadPublic(first.uri, first.kind);
  }
  const tag = (opts.topicTag ?? '').replace(/^[#\s]+/, '').replace(/[.&]/g, '').trim().slice(0, 50);
  const params =
    `media_type=${kind}&text=${encodeURIComponent(text)}` +
    (kind === 'IMAGE' ? `&image_url=${encodeURIComponent(mediaUrl)}` : '') +
    (kind === 'VIDEO' ? `&video_url=${encodeURIComponent(mediaUrl)}` : '') +
    (opts.ghost ? `&is_ghost_post=true` : '') +
    (tag ? `&topic_tag=${encodeURIComponent(tag)}` : '') +
    `&access_token=${tok}`;
  const c = await fetch(`${THREADS_API}/v1.0/${opts.threadsId}/threads?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.token}` },
  });
  const cj: any = await gjson(c);
  if (cj.error || !cj.id) throw new Error(gerr(cj, 'Threads container failed.'));
  const p = await fetch(`${THREADS_API}/v1.0/${opts.threadsId}/threads_publish?creation_id=${encodeURIComponent(String(cj.id))}&access_token=${tok}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.token}` },
  });
  const pj: any = await gjson(p);
  if (pj.error || !pj.id) throw new Error(gerr(pj, 'Threads publish failed.'));
  return String(pj.id);
}

/** Resolve a pasted Threads URL (or numeric media id) to a media id the API accepts. */
function threadsMediaId(source: string): string {
  const s = (source ?? '').trim();
  if (!s) throw new Error('Paste the Threads post URL or ID first.');
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/(?:threads\.net\/[^/]+\/post\/)([A-Za-z0-9_-]+)\/?$/) || s.match(/(?:threads\.net\/[^/]+)([A-Za-z0-9_-]+)\/?$/);
  if (m) return m[1];
  throw new Error('Could not read that Threads URL — paste the full post link or numeric ID.');
}

export async function publishThreadsRepost(opts: { token: string; source: string }): Promise<string> {
  const sourceId = threadsMediaId(opts.source);
  const r = await fetch(
    `${THREADS_API}/v1.0/${encodeURIComponent(sourceId)}/repost?media_type=TEXT&text=&access_token=${encodeURIComponent(opts.token)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${opts.token}` } },
  );
  const j: any = await gjson(r);
  if (j.error || !j.id) throw new Error(gerr(j, 'Threads repost failed — paste the numeric post ID from the Graph API, or verify the URL.'));
  return String(j.id);
}

export async function publishThreadsQuote(opts: { threadsId: string; token: string; text: string; source: string }): Promise<string> {
  const sourceId = threadsMediaId(opts.source);
  const tok = encodeURIComponent(opts.token);
  const c = await fetch(
    `${THREADS_API}/v1.0/${opts.threadsId}/threads?media_type=TEXT&text=${encodeURIComponent(opts.text)}&quote_post_id=${encodeURIComponent(sourceId)}&access_token=${tok}`,
    { method: 'POST', headers: { Authorization: `Bearer ${opts.token}` } },
  );
  const cj: any = await gjson(c);
  if (cj.error || !cj.id) throw new Error(gerr(cj, 'Threads quote container failed.'));
  const p = await fetch(
    `${THREADS_API}/v1.0/${opts.threadsId}/threads_publish?creation_id=${encodeURIComponent(String(cj.id))}&access_token=${tok}`,
    { method: 'POST', headers: { Authorization: `Bearer ${opts.token}` } },
  );
  const pj: any = await gjson(p);
  if (pj.error || !pj.id) throw new Error(gerr(pj, 'Threads publish failed.'));
  return String(pj.id);
}

