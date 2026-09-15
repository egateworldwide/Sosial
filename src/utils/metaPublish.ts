import { graph, THREADS_API, IG_GRAPH } from './metaConfig';
import type { MediaAttachment } from './managed';

/** Per-platform attachment caps. Code enforces these; the composer shows them. */
export const MAX_ATTACHMENTS = 10;
export const ATTACH_LIMITS: Record<string, { images: number; videos: number }> = {
  facebook: { images: 10, videos: 1 },
  instagram: { images: 10, videos: 1 },
  threads: { images: 1, videos: 1 },
  tiktok: { images: 0, videos: 1 },
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
  return typeof m === 'string' && m.length > 0 ? m : fallback;
}

async function gjson(r: Response): Promise<any> {
  return r.json().catch(() => ({}));
}

/**
 * MVP public host for IG/Threads media (both demand a public URL — local
 * files can't go direct). Anonymous, files expire. If it ever rejects,
 * the error names it plainly; swap in your own storage when ready.
 */
export async function uploadPublic(uri: string, kind: 'image' | 'video'): Promise<string> {
  const form = new FormData();
  form.append('file', {
    uri,
    name: kind === 'video' ? 'sosial.mp4' : 'sosial.jpg',
    type: kind === 'video' ? 'video/mp4' : 'image/jpeg',
  } as any);
  const r = await fetch('https://0x0.st', { method: 'POST', body: form });
  const url = (await r.text()).trim();
  if (!r.ok || !url.startsWith('http')) throw new Error('Image host rejected the upload — try again, or post manually.');
  return url;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const r = await fetch(graph(`/${opts.pageId}/videos`), { method: 'POST', body: form });
    const j = await gjson(r);
    if (j.error || !j.id) throw new Error(gerr(j, 'Facebook video upload failed.'));
    return String(j.id);
  }
  if (images.length === 1) {
    const form = new FormData();
    form.append('source', { uri: images[0].uri, name: 'sosial.jpg', type: 'image/jpeg' } as any);
    form.append('caption', opts.message);
    form.append('access_token', opts.pageToken);
    const r = await fetch(graph(`/${opts.pageId}/photos`), { method: 'POST', body: form });
    const j = await gjson(r);
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
      const r = await fetch(graph(`/${opts.pageId}/photos`), { method: 'POST', body: form });
      const j = await gjson(r);
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
  const r = await fetch(graph(`/${opts.pageId}/feed`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: opts.message, access_token: opts.pageToken }),
  });
  const j = await gjson(r);
  if (j.error || !j.id) throw new Error(gerr(j, 'Facebook post failed.'));
  return String(j.id);
}

/* ---------------- Instagram Business Login API (graph.instagram.com) ---------------- */

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
    let status = '';
    for (let i = 0; i < 10; i++) {
      await sleep(8000);
      const s = await fetch(`${IG_GRAPH}/${cj.id}?fields=status_code&access_token=${tok}`);
      const sj: any = await gjson(s);
      status = String(sj.status_code ?? '');
      if (status === 'FINISHED') break;
      if (status === 'ERROR') throw new Error('Instagram failed to process the video.');
    }
    if (status !== 'FINISHED') throw new Error('Instagram is still processing the video — try publishing again in a minute.');
    const p = await fetch(`${IG_GRAPH}/${opts.igId}/media_publish?creation_id=${encodeURIComponent(String(cj.id))}&access_token=${tok}`, { method: 'POST' });
    const pj: any = await gjson(p);
    if (pj.error || !pj.id) throw new Error(gerr(pj, 'Instagram publish failed.'));
    return String(pj.id);
  }
  const urls: string[] = [];
  for (const img of images.slice(0, ATTACH_LIMITS.instagram.images)) {
    urls.push(img.uri.startsWith('http') ? img.uri : await uploadPublic(img.uri, 'image'));
  }
  if (urls.length === 1) {
    const c = await fetch(
      `${IG_GRAPH}/${opts.igId}/media?image_url=${encodeURIComponent(urls[0])}&caption=${encodeURIComponent(opts.caption)}&access_token=${tok}`,
      { method: 'POST' },
    );
    const cj: any = await gjson(c);
    if (cj.error || !cj.id) throw new Error(gerr(cj, 'Instagram container failed. Image URLs must be public JPEG/PNG.'));
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
  const c = await fetch(
    `${IG_GRAPH}/${opts.igId}/media?media_type=CAROUSEL&children=${children.map(encodeURIComponent).join(',')}&caption=${encodeURIComponent(opts.caption)}&access_token=${tok}`,
    { method: 'POST' },
  );
  const cj: any = await gjson(c);
  if (cj.error || !cj.id) throw new Error(gerr(cj, 'Instagram carousel failed.'));
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
}): Promise<string> {
  const tok = encodeURIComponent(opts.token);
  const atts = toAttachments(opts.imageUri, opts.videoUri, opts.attachments);
  // Threads takes a single attachment — first item wins
  const first = atts[0];
  const kind = !first ? 'TEXT' : first.kind === 'video' ? 'VIDEO' : 'IMAGE';
  let mediaUrl = '';
  if (first) {
    mediaUrl = first.uri.startsWith('http') ? first.uri : await uploadPublic(first.uri, first.kind);
  }
  const params =
    `media_type=${kind}&text=${encodeURIComponent(opts.text)}` +
    (kind === 'IMAGE' ? `&image_url=${encodeURIComponent(mediaUrl)}` : '') +
    (kind === 'VIDEO' ? `&video_url=${encodeURIComponent(mediaUrl)}` : '') +
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
