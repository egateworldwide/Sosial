/**
 * LinkedIn publish adapter. Ports publishLinkedIn from src/utils/liPublish.ts:
 * text (≤3000 chars) + up to 9 photos as a member post, or as the picked
 * Company Page when channel metadata carries liOrgId. Each image is a 3-step
 * dance (initializeUpload → PUT raw bytes → urn:li:image:…), then POST
 * /rest/posts returns 201 with the id in the x-restli-id header. Access token
 * (~60d) refreshes via the rotating refresh token, Vault-backed.
 */
import { readSecret, updateSecret } from './db';
import { storageSign, storageDownload } from './rest';
import { env } from './env';
import { info } from './logger';

const LI_API = 'https://api.linkedin.com';
const LI_TOKEN_ENDPOINT = 'https://www.linkedin.com/oauth/v2/accessToken';
const LI_VERSION = '202601';
const MAX_IMAGES = 9;
const MAX_TEXT = 3000;
const MAX_BYTES = 10 * 1024 * 1024; // LinkedIn rejects images over 10 MB

interface Bundle {
  target: { id: string; provider: string; caption: string | null; options: any; status: string };
  post: { id: string; title: string; body: string };
  media: { storage_path: string; kind: string; mime_type: string | null; position: number }[];
  channel: { id: string; external_id: string; instance_url: string | null; metadata: any };
  secrets: { access_secret_id: string | null; refresh_secret_id: string | null; expires_at: string | null };
}

const vH = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': LI_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
});

/** LinkedIn publish errors look like { message, status }. */
function lpubErr(j: any, status: number, fallback: string): string {
  const m = typeof j?.message === 'string' && j.message ? j.message : fallback;
  if (status === 401) return 'LinkedIn session expired — reconnect LinkedIn.';
  if (status === 403) {
    return `${m} — check the “Share on LinkedIn” product is added in the portal (posting as a Page also needs the Marketing Developer Platform product).`;
  }
  if (status === 429) return 'LinkedIn rate limit hit — the job will retry shortly.';
  if (status === 422) return m;
  return `${m} (${status})`;
}

/** Same LinkedIn OAuth client the app ships as EXPO_PUBLIC_LI_*. */
function clientCreds(): { id: string; secret: string } {
  const id = env('LI_CLIENT_ID');
  const secret = env('LI_CLIENT_SECRET');
  if (!id || !secret) {
    throw new Error('LinkedIn cloud publishing needs LI_CLIENT_ID + LI_CLIENT_SECRET on the worker (see apps/worker/.env.example).');
  }
  return { id, secret };
}

async function patchExpiry(channelId: string, expiresAt: Date): Promise<void> {
  const { required } = await import('./env');
  const base = required('WORKER_SUPABASE_URL').replace(/\/+$/, '');
  const k = required('WORKER_SERVICE_ROLE_KEY');
  const r = await fetch(`${base}/rest/v1/channel_tokens?channel_id=eq.${encodeURIComponent(channelId)}`, {
    method: 'PATCH',
    headers: {
      apikey: k,
      Authorization: `Bearer ${k}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ expires_at: expiresAt.toISOString(), updated_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`patch channel_tokens (${r.status}): ${t.slice(0, 200)}`);
  }
}

/** Valid access token, refreshing 10 min before expiry (Vault-backed). */
async function ensureToken(b: Bundle, force = false): Promise<string> {
  const fresh =
    !force && b.secrets.expires_at && Date.parse(b.secrets.expires_at) > Date.now() + 600000;
  if (fresh && b.secrets.access_secret_id) {
    const access = await readSecret(b.secrets.access_secret_id);
    if (access) return access;
  }
  if (!b.secrets.refresh_secret_id) {
    throw new Error('LinkedIn session expired — toggle cloud publishing off and on in Connect to refresh.');
  }
  const refresh = await readSecret(b.secrets.refresh_secret_id);
  if (!refresh) throw new Error('LinkedIn session expired — toggle cloud publishing off and on in Connect to refresh.');
  const { id, secret } = clientCreds();
  const r = await fetch(LI_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: id,
      client_secret: secret,
    }).toString(),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.access_token) {
    const msg = String(j?.error_description || j?.error || j?.message || 'LinkedIn session expired');
    if (/invalid_grant|invalid_request|expired|unauthorized/i.test(msg)) {
      throw new Error('LinkedIn session expired — reconnect LinkedIn.');
    }
    throw new Error(`${msg} — toggle cloud publishing off and on in Connect to refresh.`);
  }
  const newAccess = String(j.access_token);
  const newRefresh = String(j.refresh_token || refresh);
  if (b.secrets.access_secret_id) await updateSecret(b.secrets.access_secret_id, newAccess);
  await updateSecret(b.secrets.refresh_secret_id, newRefresh);
  await patchExpiry(b.channel.id, new Date(Date.now() + Number(j.expires_in ?? 5184000) * 1000));
  return newAccess;
}

function mimeFor(storagePath: string, stored: string | null): string {
  if (/^image\//.test(stored ?? '')) return String(stored);
  const u = String(storagePath ?? '').toLowerCase().split('?')[0];
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function fitText(t: string): string {
  const s = (t ?? '').trim();
  const chars = [...s];
  if (chars.length <= MAX_TEXT) return s;
  return chars.slice(0, MAX_TEXT - 1).join('') + '…';
}

/**
 * One image, 3 steps: initializeUpload → PUT raw bytes to the signed URL
 * (no auth header — the URL is the auth) → urn:li:image:… for the post.
 */
async function uploadImage(token: string, owner: string, buf: Buffer, mime: string, tag: string): Promise<string> {
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`${tag}: over LinkedIn’s 10 MB limit.`);
  }
  const init = await fetch(`${LI_API}/rest/images?action=initializeUpload`, {
    method: 'POST',
    headers: { ...vH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const ij: any = await init.json().catch(() => ({}));
  const uploadUrl = String(ij?.value?.uploadUrl ?? '');
  const urn = String(ij?.value?.image ?? '');
  if (!init.ok || !uploadUrl || !urn) {
    throw new Error(`${tag}: ${lpubErr(ij, init.status, 'LinkedIn upload init failed.')}`);
  }
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: new Uint8Array(buf) as unknown as BodyInit,
  });
  if (!put.ok) throw new Error(`${tag}: bytes rejected (${put.status}).`);
  return urn;
}

/** Full target publish. Post URN has no public permalink, so remoteUrl is ''. */
export async function publishLinkedInTarget(bundle: Bundle): Promise<{ remoteId: string; remoteUrl: string }> {
  const b = bundle as Bundle;
  const personUrn = String(b.channel.external_id ?? '').trim();
  const orgId = String(b.channel.metadata?.liOrgId ?? '').trim();
  // Post author: picked Company Page when one is set, else the member. Image
  // upload owner must match the author, or LinkedIn 403s the post.
  const author = orgId ? `urn:li:organization:${orgId}` : personUrn;
  if (!author) throw new Error('LinkedIn not connected — re-enable cloud publishing.');
  const token = await ensureToken(b);

  const text = fitText(b.target.caption ?? b.post.body ?? '');
  const images = (b.media ?? [])
    .filter((m) => m.kind === 'image')
    .sort((a, z) => a.position - z.position)
    .slice(0, MAX_IMAGES);
  if (!text && images.length === 0) {
    throw new Error('Write something or attach a photo — LinkedIn needs one of them.');
  }
  const alt = text.slice(0, 200) || 'Image';
  const urns: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const m = images[i];
    let raw: Buffer;
    try {
      raw = await storageDownload(await storageSign('post-media', m.storage_path));
    } catch (e: any) {
      throw new Error(`Photo ${i + 1}/${images.length}: download failed — ${e?.message ?? 'storage error'}`);
    }
    urns.push(await uploadImage(token, author, raw, mimeFor(m.storage_path, m.mime_type), `Photo ${i + 1}/${images.length}`));
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
  info(`linkedin target ${b.target.id}: ${urns.length ? `PHOTOS x${urns.length}` : 'TEXT'}${orgId ? ' (Page)' : ''}`);
  const r = await fetch(`${LI_API}/rest/posts`, {
    method: 'POST',
    headers: { ...vH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status !== 201) {
    const j: any = await r.json().catch(() => ({}));
    throw new Error(lpubErr(j, r.status, 'LinkedIn post failed.'));
  }
  return { remoteId: r.headers.get('x-restli-id') ?? 'linkedin-post', remoteUrl: '' };
}
