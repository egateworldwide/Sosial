import * as FileSystem from 'expo-file-system/legacy';
import { LI_API, LI_VERSION, LI_MAX_IMAGES, LI_MAX_TEXT, LI_MAX_BYTES } from './liConfig';
import { getValidLi, liAuthorUrn } from './liAuth';
import { loadMetaState } from './metaStore';
import { b64ToBytes } from './bskyPublish';

const vH = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': LI_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
});

/** LinkedIn publish errors look like { message, status }. */
function lpubErr(j: any, status: number, fallback: string): string {
  const m = typeof j?.message === 'string' && j.message ? j.message : fallback;
  if (status === 401) return 'LinkedIn session expired — reconnect LinkedIn.';
  if (status === 403) return `${m} — check the “Share on LinkedIn” product is added in the portal (posting as a Page also needs the Marketing Developer Platform product).`;
  if (status === 429) return 'LinkedIn rate limit hit — wait and retry.';
  if (status === 422) return m;
  return `${m} (${status})`;
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
  if (chars.length <= LI_MAX_TEXT) return s;
  return chars.slice(0, LI_MAX_TEXT - 1).join('') + '…';
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
 * One image, 3 steps: initializeUpload → PUT raw bytes to the signed URL
 * (no auth header — the URL is the auth) → urn:li:image:… for the post.
 */
async function uploadLiImage(
  token: string,
  personUrn: string,
  uri: string,
  mime: string,
  tag: string,
): Promise<string> {
  if ((await fileSize(uri)) > LI_MAX_BYTES) {
    throw new Error(`${tag}: over LinkedIn’s 10 MB limit.`);
  }
  const init = await fetch(`${LI_API}/rest/images?action=initializeUpload`, {
    method: 'POST',
    headers: { ...vH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ initializeUploadRequest: { owner: personUrn } }),
  });
  const ij: any = await init.json().catch(() => ({}));
  const uploadUrl = String(ij?.value?.uploadUrl ?? '');
  const urn = String(ij?.value?.image ?? '');
  if (!init.ok || !uploadUrl || !urn) {
    throw new Error(`${tag}: ${lpubErr(ij, init.status, 'LinkedIn upload init failed.')}`);
  }
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: b64ToBytes(b64) as any,
  });
  if (!put.ok) throw new Error(`${tag}: bytes rejected (${put.status}).`);
  return urn;
}

/**
 * Post to LinkedIn: text (≤3000) + up to 9 photos.
 * Author is the picked Company Page when one is set, else the member.
 * Image upload owner must match the author, or LinkedIn 403s the post.
 * Returns the post URN (from the x-restli-id response header).
 */
export async function publishLinkedIn(opts: { text: string; imageUris?: string[] }): Promise<string> {
  const { token, personUrn } = await getValidLi();
  const m = await loadMetaState();
  const author = liAuthorUrn({ liOrgId: m.liOrgId, liPersonUrn: personUrn });
  if (!author) throw new Error('LinkedIn not connected');
  const text = fitText(opts.text);
  const uris = (opts.imageUris ?? []).filter(Boolean).slice(0, LI_MAX_IMAGES);
  if (!text && uris.length === 0) {
    throw new Error('Write something or attach a photo — LinkedIn needs one of them.');
  }
  const alt = text.slice(0, 200) || 'Image';
  const urns: string[] = [];
  for (let i = 0; i < uris.length; i++) {
    try {
      urns.push(await uploadLiImage(token, author, uris[i], mimeFor(uris[i]), `Photo ${i + 1}/${uris.length}`));
    } catch (e: any) {
      throw new Error(e?.message ?? 'upload failed');
    }
  }
  const body: Record<string, any> = {
    author,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (urns.length === 1) {
    body.content = { media: { id: urns[0], altText: alt } };
  } else if (urns.length > 1) {
    body.content = { multiImage: { images: urns.map((id) => ({ id, altText: alt })) } };
  }
  const r = await fetch(`${LI_API}/rest/posts`, {
    method: 'POST',
    headers: { ...vH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status !== 201) {
    const j: any = await r.json().catch(() => ({}));
    throw new Error(lpubErr(j, r.status, 'LinkedIn post failed.'));
  }
  return r.headers.get('x-restli-id') ?? 'linkedin-post';
}
