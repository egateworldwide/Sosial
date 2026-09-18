/**
 * Bluesky publish adapter (Wave A). Ports src/utils/bskyPublish.ts +
 * bskyAuth.ts session logic to the worker: Vault-backed session with
 * proactive refresh, sharp image ladder (same dims/quals as the app),
 * link facets, createRecord. Returns the post URI.
 */
import sharp from 'sharp';
import { readSecret, updateSecret } from './db';
import { storageSign, storageDownload } from './rest';
import { info } from './logger';

const BSKY_MAX_IMAGES = 4;
const BSKY_MAX_TEXT = 300;
const BSKY_BLOB_CAP = 1000000;
/** Dedicated video service (not the PDS) + bounded processing poll. */
const BSKY_VIDEO_HOST = 'https://video.bsky.app';
const VIDEO_POLL_MS = 5 * 60 * 1000;

interface Bundle {
  target: { id: string; provider: string; caption: string | null; options: any; status: string };
  post: { id: string; title: string; body: string };
  media: { storage_path: string; kind: string; mime_type: string | null; position: number }[];
  channel: { id: string; external_id: string; instance_url: string | null; metadata: any };
  secrets: { access_secret_id: string | null; refresh_secret_id: string | null; expires_at: string | null };
}

interface Session {
  token: string;
  did: string;
  pdsHost: string;
}

/** Bluesky reply targets need both the strong-ref uri AND cid (per spec). */
interface BskyRef { uri: string; cid: string }
interface BskyReply { root: BskyRef; parent: BskyRef }

function bskyErr(j: any, fallback: string): string {
  const m = j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (/blobtoolarge/i.test(base)) return 'Photo over Bluesky’s 1 MB limit.';
  return base;
}

function fitText(t: string): string {
  const s = (t ?? '').trim();
  const chars = [...s];
  if (chars.length <= BSKY_MAX_TEXT) return s;
  return chars.slice(0, BSKY_MAX_TEXT - 1).join('') + '…';
}

function linkFacets(text: string): any[] {
  const out: any[] = [];
  const re = /https?:\/\/[^\s<>()]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const url = m[0].replace(/[.,!?;:)\]]+$/, '');
    if (!url) continue;
    const start = Buffer.byteLength(text.slice(0, m.index));
    out.push({
      index: { byteStart: start, byteEnd: start + Buffer.byteLength(url) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }
  return out;
}

async function xrpc(pdsHost: string, method: string, token: string, body: any, contentType: string): Promise<any> {
  const r = await fetch(`${pdsHost}/xrpc/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body,
  });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, json: j };
}

/** Live session, refreshing proactively (10-min margin, mirrors the app). */
async function ensureSession(b: Bundle, force = false): Promise<Session> {
  const pdsHost = b.channel.instance_url || 'https://bsky.social';
  const did = b.channel.external_id;
  if (!did) throw new Error('Bluesky channel missing DID — re-enable cloud publishing.');
  const fresh =
    !force &&
    b.secrets.expires_at &&
    Date.parse(b.secrets.expires_at) > Date.now() + 600000;
  if (fresh && b.secrets.access_secret_id) {
    const access = await readSecret(b.secrets.access_secret_id);
    if (access) return { token: access, did, pdsHost };
  }
  if (!b.secrets.refresh_secret_id) {
    throw new Error('Bluesky session expired — toggle cloud publishing off and on in Connect to refresh.');
  }
  const refresh = await readSecret(b.secrets.refresh_secret_id);
  if (!refresh) throw new Error('Bluesky session expired — toggle cloud publishing off and on in Connect to refresh.');
  const r = await xrpc(pdsHost, 'com.atproto.server.refreshSession', refresh, '', 'application/json');
  if (!r.ok || !r.json?.accessJwt) {
    throw new Error('Bluesky session expired — toggle cloud publishing off and on in Connect to refresh.');
  }
  const newAccess = String(r.json.accessJwt);
  const newRefresh = String(r.json.refreshJwt || refresh);
  // Rotate in place — secret ids stay stable, worker + app keep working.
  if (b.secrets.access_secret_id) await updateSecret(b.secrets.access_secret_id, newAccess);
  await updateSecret(b.secrets.refresh_secret_id, newRefresh);
  await restPatchByChannel(b.channel.id, {
    expires_at: new Date(Date.now() + 110 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  return { token: newAccess, did: String(r.json.did || did), pdsHost };
}

async function restPatchByChannel(channelId: string, body: Record<string, any>): Promise<void> {
  // channel_tokens is keyed by channel_id (not id) — small dedicated PATCH.
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
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`patch channel_tokens (${r.status}): ${t.slice(0, 200)}`);
  }
}

function mimeFor(path: string, declared: string | null): string {
  if (declared) return declared;
  const u = path.toLowerCase().split('?')[0];
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

/** Same ladder as the app: dims × quals, GIFs pass through or fail. */
async function prepareImage(buf: Buffer, mime: string): Promise<{ buf: Buffer; mime: string }> {
  if (mime === 'image/gif') {
    if (buf.length <= BSKY_BLOB_CAP) return { buf, mime };
    throw new Error('GIF over 1 MB isn’t accepted by Bluesky.');
  }
  if (buf.length <= BSKY_BLOB_CAP && (mime === 'image/png' || mime === 'image/jpeg')) {
    return { buf, mime };
  }
  const dims = [2000, 2000, 1600, 1280];
  const quals = [90, 75, 60, 45];
  const meta = await sharp(buf).metadata().catch(() => ({} as any));
  const longest = Math.max(meta.width || 0, meta.height || 0, 1);
  for (let i = 0; i < quals.length; i++) {
    const scale = Math.min(1, dims[i] / longest);
    let pipeline = sharp(buf).rotate();
    if (scale < 1) {
      pipeline = pipeline.resize(Math.max(1, Math.round((meta.width || 0) * scale)), Math.max(1, Math.round((meta.height || 0) * scale)), {
        fit: 'inside',
      });
    }
    const out = await pipeline.jpeg({ quality: quals[i] }).toBuffer();
    if (out.length <= BSKY_BLOB_CAP) return { buf: out, mime: 'image/jpeg' };
  }
  throw new Error('Photo won’t squeeze under Bluesky’s 1 MB limit.');
}

async function publishWith(
  sess: Session,
  imageBuffers: { buf: Buffer; mime: string }[],
  text: string,
  replyTo?: BskyReply,
): Promise<BskyRef> {
  if (!text && imageBuffers.length === 0) {
    throw new Error('Nothing to publish — empty text and no images.');
  }
  const images: any[] = [];
  for (let i = 0; i < imageBuffers.length; i++) {
    const { buf, mime } = imageBuffers[i];
    const r = await xrpc(sess.pdsHost, 'com.atproto.repo.uploadBlob', sess.token, buf, mime);
    if (r.status === 401) throw new Error('__EXPIRED__');
    if (!r.ok || !r.json?.blob) throw new Error(`Photo ${i + 1}: ${bskyErr(r.json, 'image upload failed')}`);
    images.push({ alt: text.slice(0, 200) || 'Image', image: r.json.blob });
  }
  const record: Record<string, any> = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
  };
  const facets = text ? linkFacets(text) : [];
  if (facets.length) record.facets = facets;
  if (images.length) record.embed = { $type: 'app.bsky.embed.images', images };
  if (replyTo) {
    record.reply = {
      root: { uri: replyTo.root.uri, cid: replyTo.root.cid },
      parent: { uri: replyTo.parent.uri, cid: replyTo.parent.cid },
    };
  }
  const r = await xrpc(sess.pdsHost, 'com.atproto.repo.createRecord', sess.token, JSON.stringify({
    repo: sess.did,
    collection: 'app.bsky.feed.post',
    record,
  }), 'application/json');
  if (r.status === 401) throw new Error('__EXPIRED__');
  if (!r.ok || !r.json?.uri) throw new Error(bskyErr(r.json, 'Bluesky post failed'));
  return { uri: String(r.json.uri), cid: String(r.json.cid ?? '') };
}

/**
 * Video path: upload to the dedicated video service, poll the processing
 * job to COMPLETED, embed the blob. Auth is a SERVICE token
 * (getServiceAuth, aud = own PDS, 30 min) — the session accessJwt is NOT
 * accepted by the video service. already_exists responses still carry a
 * usable blob. Size is already capped at 25 MB by the storage downloader;
 * duration/aspect rejections surface from the service.
 */
async function getServiceToken(pdsHost: string, accessToken: string): Promise<string> {
  const host = pdsHost.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const exp = Math.floor(Date.now() / 1000) + 1800;
  const url =
    `${pdsHost}/xrpc/com.atproto.server.getServiceAuth` +
    `?aud=${encodeURIComponent(`did:web:${host}`)}` +
    `&lxm=${encodeURIComponent('com.atproto.repo.uploadBlob')}` +
    `&exp=${exp}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('__EXPIRED__');
  if (!r.ok || !j?.token) throw new Error(`Bluesky video auth failed (${r.status})`);
  return String(j.token);
}

async function uploadVideoBlob(sess: Session, buf: Buffer, mime: string): Promise<any> {
  const svc = await getServiceToken(sess.pdsHost, sess.token);
  const up = await fetch(
    `${BSKY_VIDEO_HOST}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(sess.did)}&name=${encodeURIComponent('sosial.mp4')}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${svc}`,
        'Content-Type': mime,
        'Content-Length': String(buf.length),
      },
      // Fresh ArrayBuffer view — satisfies BodyInit across @types/node versions.
      body: Uint8Array.from(buf),
    },
  );
  const uj: any = await up.json().catch(() => ({}));
  if (up.status === 401) throw new Error('__EXPIRED__');
  if (!up.ok || !uj?.jobId) throw new Error(bskyErr(uj, 'Bluesky video upload failed'));
  const jobId = String(uj.jobId);
  const start = Date.now();
  for (;;) {
    const s = await fetch(
      `${BSKY_VIDEO_HOST}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`,
      { headers: { Authorization: `Bearer ${svc}` } },
    );
    const sj: any = await s.json().catch(() => ({}));
    if (s.status === 401) throw new Error('__EXPIRED__');
    // already_exists (and any other response) carrying a blob is usable.
    if (sj?.jobStatus?.blob) return sj.jobStatus.blob;
    const state = String(sj?.jobStatus?.state ?? '');
    if (state === 'JOB_STATE_FAILED') {
      throw new Error(`Bluesky rejected the video — ${String(sj?.jobStatus?.message ?? 'processing failed')}`);
    }
    if (Date.now() - start > VIDEO_POLL_MS) {
      throw new Error('Bluesky is still processing the video — retry in a few minutes.');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function publishVideoWith(
  sess: Session,
  video: { storage_path: string; mime_type: string | null },
  text: string,
  replyTo?: BskyReply,
): Promise<BskyRef> {
  let raw: Buffer;
  try {
    raw = await storageDownload(await storageSign('post-media', video.storage_path));
  } catch (e: any) {
    throw new Error(`Video download failed — ${e?.message ?? 'storage error'}`);
  }
  const mime = mimeFor(video.storage_path, video.mime_type);
  if (!/^video\//.test(mime)) throw new Error(`Unsupported video type ${mime} — use MP4 or MOV.`);
  const blob = await uploadVideoBlob(sess, raw, mime);
  const record: Record<string, any> = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    embed: { $type: 'app.bsky.embed.video', video: blob },
  };
  const facets = text ? linkFacets(text) : [];
  if (facets.length) record.facets = facets;
  if (replyTo) {
    record.reply = {
      root: { uri: replyTo.root.uri, cid: replyTo.root.cid },
      parent: { uri: replyTo.parent.uri, cid: replyTo.parent.cid },
    };
  }
  const r = await xrpc(sess.pdsHost, 'com.atproto.repo.createRecord', sess.token, JSON.stringify({
    repo: sess.did,
    collection: 'app.bsky.feed.post',
    record,
  }), 'application/json');
  if (r.status === 401) throw new Error('__EXPIRED__');
  if (!r.ok || !r.json?.uri) throw new Error(bskyErr(r.json, 'Bluesky video post failed'));
  return { uri: String(r.json.uri), cid: String(r.json.cid ?? '') };
}

/** Full target publish: session → media → post. Returns the post URI. */
export async function publishBlueskyTarget(bundle: Bundle): Promise<string> {
  const b = bundle as Bundle;
  const videos = (b.media ?? [])
    .filter((m) => m.kind === 'video')
    .sort((a, z) => a.position - z.position);
  if (videos.length > 1) {
    throw new Error('Bluesky takes one video per post — split extras into their own post.');
  }
  const imgs = (b.media ?? [])
    .filter((m) => m.kind === 'image')
    .sort((a, z) => a.position - z.position)
    .slice(0, BSKY_MAX_IMAGES);
  if (videos.length > 0 && imgs.length > 0) {
    throw new Error('Bluesky can’t mix photos and video in one post — send one or the other.');
  }
  info(`bluesky target ${b.target.id}: ${imgs.length} image(s)`);
  const prepared: { buf: Buffer; mime: string }[] = [];
  for (let i = 0; i < imgs.length; i++) {
    const m = imgs[i];
    let raw: Buffer;
    try {
      raw = await storageDownload(await storageSign('post-media', m.storage_path));
    } catch (e: any) {
      throw new Error(`Photo ${i + 1}: download failed — ${e?.message ?? 'storage error'}`);
    }
    try {
      prepared.push(await prepareImage(raw, mimeFor(m.storage_path, m.mime_type)));
    } catch (e: any) {
      throw new Error(`Photo ${i + 1}: ${e?.message ?? 'too big'}`);
    }
  }
  const attemptOne = async (opts: {
    text: string;
    images: { buf: Buffer; mime: string }[];
    video?: { storage_path: string; mime_type: string | null };
    replyTo?: BskyReply;
  }): Promise<BskyRef> => {
    const run = async (force: boolean): Promise<BskyRef> => {
      const sess = await ensureSession(b, force);
      try {
        if (opts.video) return await publishVideoWith(sess, opts.video, opts.text, opts.replyTo);
        return await publishWith(sess, opts.images, opts.text, opts.replyTo);
      } catch (e: any) {
        if (String(e?.message ?? '') === '__EXPIRED__' && !force) {
          const sess2 = await ensureSession(b, true);
          if (opts.video) return await publishVideoWith(sess2, opts.video, opts.text, opts.replyTo);
          return await publishWith(sess2, opts.images, opts.text, opts.replyTo);
        }
        if (String(e?.message ?? '') === '__EXPIRED__') {
          throw new Error('Bluesky session expired — toggle cloud publishing off and on in Connect to refresh.');
        }
        throw e;
      }
    };
    return run(false);
  };

  // Thread chain: head carries the media (one video OR up to four images),
  // replies are text-only and reference the head as root (AT-proto spec).
  const segments = ((b.target.options?.thread as string[] | undefined) ?? [])
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  if (segments.length > 1) {
    info(`bluesky target ${b.target.id}: THREAD ${segments.length}`);
    let root: BskyRef | null = null;
    let parent: BskyRef | null = null;
    let head = '';
    for (let i = 0; i < segments.length; i++) {
      const ref = await attemptOne({
        text: fitText(segments[i]),
        images: i === 0 ? prepared : [],
        video: i === 0 ? videos[0] : undefined,
        replyTo: i > 0 && root && parent ? { root, parent } : undefined,
      });
      if (i === 0) { root = ref; head = ref.uri; }
      parent = ref;
    }
    return head;
  }
  const ref = await attemptOne({
    text: fitText(b.target.caption ?? b.post.body ?? ''),
    images: prepared,
    video: videos[0],
  });
  return ref.uri;
}

/** Public post URL from an at:// URI. */
export function blueskyPostUrl(uri: string, did: string): string {
  const rkey = uri.split('/').pop() ?? '';
  return `https://bsky.app/profile/${did}/post/${rkey}`;
}
