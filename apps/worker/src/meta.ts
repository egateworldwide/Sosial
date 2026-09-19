/** Server-side Facebook Page and Instagram Business publishing. */
import { readSecret } from './db';
import { storageDownload, storageSign } from './rest';

const FB_GRAPH = 'https://graph.facebook.com/v21.0';
const IG_GRAPH = 'https://graph.instagram.com';
const IG_WAIT_MS = 90_000;

interface Bundle {
  target: { id: string; provider: string; caption: string | null; options: any; format: string | null };
  post: { id: string; title: string; body: string };
  media: { storage_path: string; kind: string; mime_type: string | null; position: number }[];
  channel: { id: string; external_id: string; instance_url: string | null; metadata: any };
  secrets: { access_secret_id: string | null; refresh_secret_id: string | null; expires_at: string | null };
}

function errorText(j: any, fallback: string): string {
  return String(j?.error?.message || j?.message || fallback);
}

async function json(r: Response): Promise<any> {
  return r.json().catch(() => ({}));
}

async function token(b: Bundle): Promise<string> {
  if (!b.secrets.access_secret_id) throw new Error(`${b.target.provider} token missing — reconnect the channel.`);
  const value = await readSecret(b.secrets.access_secret_id);
  if (!value) throw new Error(`${b.target.provider} token unavailable — reconnect the channel.`);
  return value;
}

function media(b: Bundle, kind?: string) {
  return (b.media ?? [])
    .filter((m) => !kind || m.kind === kind)
    .sort((a, z) => a.position - z.position);
}

async function fbForm(path: string, accessToken: string, fields: Record<string, string>, file?: { name: string; mime: string; bytes: Buffer }): Promise<string> {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...fields, access_token: accessToken })) form.append(key, value);
  if (file) form.append('source', new Blob([new Uint8Array(file.bytes) as unknown as BlobPart], { type: file.mime }), file.name);
  const r = await fetch(`${FB_GRAPH}${path}`, { method: 'POST', body: form });
  const j = await json(r);
  if (!r.ok || j.error || (!j.id && !j.post_id)) throw new Error(errorText(j, 'Facebook publish failed.'));
  return String(j.post_id ?? j.id);
}

export async function publishFacebookTarget(bundle: Bundle): Promise<{ remoteId: string; remoteUrl: string }> {
  const b = bundle as Bundle;
  const tokenValue = await token(b);
  const pageId = b.channel.external_id;
  const caption = b.target.caption ?? b.post.body ?? '';
  const video = media(b, 'video')[0];
  if (video) {
    const bytes = await storageDownload(await storageSign('post-media', video.storage_path), 128 * 1024 * 1024);
    const id = await fbForm(`/${pageId}/videos`, tokenValue, { description: caption }, {
      name: 'sosial.mp4', mime: video.mime_type || 'video/mp4', bytes,
    });
    return { remoteId: id, remoteUrl: `https://www.facebook.com/${id}` };
  }
  const images = media(b, 'image');
  if (images.length === 1) {
    const image = images[0];
    const bytes = await storageDownload(await storageSign('post-media', image.storage_path));
    const id = await fbForm(`/${pageId}/photos`, tokenValue, { caption }, {
      name: 'sosial.jpg', mime: image.mime_type || 'image/jpeg', bytes,
    });
    return { remoteId: id, remoteUrl: `https://www.facebook.com/${id}` };
  }
  if (images.length > 1) {
    const ids: string[] = [];
    for (const image of images.slice(0, 10)) {
      const bytes = await storageDownload(await storageSign('post-media', image.storage_path));
      ids.push(await fbForm(`/${pageId}/photos`, tokenValue, { published: 'false' }, {
        name: 'sosial.jpg', mime: image.mime_type || 'image/jpeg', bytes,
      }));
    }
    const r = await fetch(`${FB_GRAPH}/${pageId}/feed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: caption, attached_media: ids.map((id) => ({ media_fbid: id })), access_token: tokenValue }),
    });
    const j = await json(r);
    if (!r.ok || j.error || !j.id) throw new Error(errorText(j, 'Facebook photo post failed.'));
    return { remoteId: String(j.id), remoteUrl: `https://www.facebook.com/${j.id}` };
  }
  const r = await fetch(`${FB_GRAPH}/${pageId}/feed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: caption, access_token: tokenValue }),
  });
  const j = await json(r);
  if (!r.ok || j.error || !j.id) throw new Error(errorText(j, 'Facebook post failed.'));
  return { remoteId: String(j.id), remoteUrl: `https://www.facebook.com/${j.id}` };
}

async function waitInstagram(id: string, accessToken: string): Promise<void> {
  const start = Date.now();
  let delay = 1500;
  for (;;) {
    const r = await fetch(`${IG_GRAPH}/${id}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`);
    const j = await json(r);
    const status = String(j?.status_code ?? '').toUpperCase();
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error('Instagram could not process the media.');
    if (Date.now() - start >= IG_WAIT_MS) throw new Error(`Instagram media is still processing (${status || 'unknown'}).`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 6000);
  }
}

async function igCreate(id: string, accessToken: string, params: Record<string, string>): Promise<string> {
  const query = new URLSearchParams({ ...params, access_token: accessToken });
  const r = await fetch(`${IG_GRAPH}/${id}/media?${query}`, { method: 'POST' });
  const j = await json(r);
  if (!r.ok || j.error || !j.id) throw new Error(errorText(j, 'Instagram container failed.'));
  return String(j.id);
}

export async function publishInstagramTarget(bundle: Bundle): Promise<{ remoteId: string; remoteUrl: string }> {
  const b = bundle as Bundle;
  const accessToken = await token(b);
  const igId = b.channel.external_id;
  const caption = b.target.caption ?? b.post.body ?? '';
  const videos = media(b, 'video');
  const images = media(b, 'image');
  if (String(b.target.format ?? '').toLowerCase() === 'story') {
    throw new Error('Instagram Stories are not supported by closed-app publishing yet. Use Feed or Reel.');
  }
  let creationId: string;
  if (videos.length) {
    const url = await storageSign('post-media', videos[0].storage_path, 3600);
    creationId = await igCreate(igId, accessToken, { media_type: 'REELS', video_url: url, caption, share_to_feed: 'true' });
  } else if (images.length === 1) {
    const url = await storageSign('post-media', images[0].storage_path, 3600);
    creationId = await igCreate(igId, accessToken, { image_url: url, caption });
  } else if (images.length > 1) {
    const children: string[] = [];
    for (const image of images.slice(0, 10)) {
      const url = await storageSign('post-media', image.storage_path, 3600);
      children.push(await igCreate(igId, accessToken, { image_url: url, is_carousel_item: 'true' }));
    }
    creationId = await igCreate(igId, accessToken, { media_type: 'CAROUSEL', children: children.join(','), caption });
  } else {
    throw new Error('Instagram needs a photo or video.');
  }
  await waitInstagram(creationId, accessToken);
  const r = await fetch(`${IG_GRAPH}/${igId}/media_publish?creation_id=${encodeURIComponent(creationId)}&access_token=${encodeURIComponent(accessToken)}`, { method: 'POST' });
  const j = await json(r);
  if (!r.ok || j.error || !j.id) throw new Error(errorText(j, 'Instagram publish failed.'));
  const remoteId = String(j.id);
  return { remoteId, remoteUrl: `https://www.instagram.com/p/${remoteId}/` };
}
