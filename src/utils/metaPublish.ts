import { graph, THREADS_API, IG_GRAPH } from './metaConfig';

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
}): Promise<string> {
  if (opts.videoUri) {
    const form = new FormData();
    form.append('source', { uri: opts.videoUri, name: 'sosial.mp4', type: 'video/mp4' } as any);
    form.append('description', opts.message);
    form.append('access_token', opts.pageToken);
    const r = await fetch(graph(`/${opts.pageId}/videos`), { method: 'POST', body: form });
    const j = await gjson(r);
    if (j.error || !j.id) throw new Error(gerr(j, 'Facebook video upload failed.'));
    return String(j.id);
  }
  if (opts.imageUri) {
    const form = new FormData();
    form.append('source', { uri: opts.imageUri, name: 'sosial.jpg', type: 'image/jpeg' } as any);
    form.append('caption', opts.message);
    form.append('access_token', opts.pageToken);
    const r = await fetch(graph(`/${opts.pageId}/photos`), { method: 'POST', body: form });
    const j = await gjson(r);
    if (j.error || (!j.id && !j.post_id)) throw new Error(gerr(j, 'Facebook photo upload failed.'));
    return String(j.post_id ?? j.id);
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
}): Promise<string> {
  const kind = opts.videoUri ? 'video' : opts.imageUri ? 'image' : null;
  if (!kind) throw new Error('Instagram needs a photo or video — text-only is not allowed by their API.');
  const local = (opts.videoUri ?? opts.imageUri) as string;
  const mediaUrl = local.startsWith('http') ? local : await uploadPublic(local, kind);
  const tok = encodeURIComponent(opts.igToken);
  if (kind === 'video') {
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
  const c = await fetch(
    `${IG_GRAPH}/${opts.igId}/media?image_url=${encodeURIComponent(mediaUrl)}&caption=${encodeURIComponent(opts.caption)}&access_token=${tok}`,
    { method: 'POST' },
  );
  const cj: any = await gjson(c);
  if (cj.error || !cj.id) throw new Error(gerr(cj, 'Instagram container failed. Image URLs must be public JPEG/PNG.'));
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
}): Promise<string> {
  const tok = encodeURIComponent(opts.token);
  const kind = opts.videoUri ? 'VIDEO' : opts.imageUri ? 'IMAGE' : 'TEXT';
  let mediaUrl = '';
  if (opts.videoUri || opts.imageUri) {
    const local = (opts.videoUri ?? opts.imageUri) as string;
    mediaUrl = local.startsWith('http') ? local : await uploadPublic(local, opts.videoUri ? 'video' : 'image');
  }
  const params =
    `media_type=${kind}&text=${encodeURIComponent(opts.text)}` +
    (kind === 'IMAGE' ? `&image_url=${encodeURIComponent(mediaUrl)}` : '') +
    (kind === 'VIDEO' ? `&video_url=${encodeURIComponent(mediaUrl)}` : '') +
    `&access_token=${tok}`;
  const c = await fetch(`${THREADS_API}/${opts.threadsId}/threads?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.token}` },
  });
  const cj: any = await gjson(c);
  if (cj.error || !cj.id) throw new Error(gerr(cj, 'Threads container failed.'));
  const p = await fetch(`${THREADS_API}/${opts.threadsId}/threads_publish?creation_id=${encodeURIComponent(String(cj.id))}&access_token=${tok}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.token}` },
  });
  const pj: any = await gjson(p);
  if (pj.error || !pj.id) throw new Error(gerr(pj, 'Threads publish failed.'));
  return String(pj.id);
}
