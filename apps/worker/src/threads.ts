/**
 * Threads publish adapter (Wave A). Ports publishThreads from
 * src/utils/metaPublish.ts: container → publish. Single attachment
 * (first wins), 500-char text cap, topic_tag from target options.
 * Media goes by signed Storage URL (Threads fetches it server-side).
 */
import { readSecret } from './db';
import { storageSign } from './rest';
import { info } from './logger';

const THREADS_API = 'https://graph.threads.net';

interface Bundle {
  target: { id: string; provider: string; caption: string | null; options: any; status: string };
  post: { id: string; title: string; body: string };
  media: { storage_path: string; kind: string; mime_type: string | null; position: number }[];
  channel: { id: string; external_id: string; instance_url: string | null; metadata: any };
  secrets: { access_secret_id: string | null; refresh_secret_id: string | null; expires_at: string | null };
}

function gerr(j: any, fallback: string, step: string): string {
  const e = j?.error;
  const m = typeof e?.message === 'string' && e.message ? e.message : fallback;
  const sub = e?.error_subcode ? ` subcode ${e.error_subcode}` : '';
  const code = e?.code ? ` (code ${e.code}${sub})` : sub;
  return `[${step}] ${m}${code}`;
}

const cap = (t: string, max: number): string => (t.length > max ? t.slice(0, max - 1) + '…' : t);

interface OnePost {
  threadsId: string;
  token: string;
  text: string;
  mediaUrl?: string;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO';
  topicTag?: string;
  replyToId?: string;
}

/** Container → wait FINISHED → publish. Returns the created post id. */
async function publishOne(a: OnePost): Promise<string> {
  const tok = encodeURIComponent(a.token);
  const params =
    `media_type=${a.kind}&text=${encodeURIComponent(a.text)}` +
    (a.kind === 'IMAGE' && a.mediaUrl ? `&image_url=${encodeURIComponent(a.mediaUrl)}` : '') +
    (a.kind === 'VIDEO' && a.mediaUrl ? `&video_url=${encodeURIComponent(a.mediaUrl)}` : '') +
    (a.topicTag ? `&topic_tag=${encodeURIComponent(a.topicTag)}` : '') +
    (a.replyToId ? `&reply_to_id=${encodeURIComponent(a.replyToId)}` : '') +
    `&access_token=${tok}`;

  const c = await fetch(`${THREADS_API}/v1.0/${a.threadsId}/threads?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.token}` },
  });
  const cj: any = await c.json().catch(() => ({}));
  if (c.status === 401) throw new Error('Threads session expired — toggle cloud publishing off and on in Connect to refresh.');
  if (cj.error || !cj.id) throw new Error(gerr(cj, 'Threads container failed', 'container'));
  const creationId = String(cj.id);

  // The container must reach FINISHED before publishing — firing
  // threads_publish immediately races Meta's backend (code 24, subcode
  // 4279009). Poll status, bounded.
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const start = Date.now();
  for (;;) {
    const s = await fetch(
      `${THREADS_API}/v1.0/${encodeURIComponent(creationId)}?fields=status&access_token=${tok}`,
    );
    const sj: any = await s.json().catch(() => ({}));
    const status = String(sj?.status ?? '').toUpperCase();
    if (status === 'FINISHED') break;
    if (status === 'ERROR') {
      throw new Error(gerr(sj, 'Threads container processing failed', `status:${creationId}`));
    }
    if (Date.now() - start > 90000) {
      throw new Error(`Threads container not ready after 90s (${status || 'unknown'}) — retry shortly.`);
    }
    await sleep(4000);
  }

  const p = await fetch(
    `${THREADS_API}/v1.0/${a.threadsId}/threads_publish?creation_id=${encodeURIComponent(creationId)}&access_token=${tok}`,
    { method: 'POST', headers: { Authorization: `Bearer ${a.token}` } },
  );
  const pj: any = await p.json().catch(() => ({}));
  if (p.status === 401) throw new Error('Threads session expired — toggle cloud publishing off and on in Connect to refresh.');
  if (pj.error || !pj.id) throw new Error(gerr(pj, 'Threads publish failed', `publish:${creationId}`));
  return String(pj.id);
}

export async function publishThreadsTarget(bundle: Bundle): Promise<{ remoteId: string; remoteUrl: string }> {
  const b = bundle as Bundle;
  const threadsId = b.channel.external_id;
  if (!threadsId) throw new Error('Threads channel missing user ID — re-enable cloud publishing.');
  if (!b.secrets.access_secret_id) throw new Error('Threads token missing — re-enable cloud publishing.');
  const token = await readSecret(b.secrets.access_secret_id);
  if (!token) throw new Error('Threads session expired — toggle cloud publishing off and on in Connect to refresh.');

  const text = (b.target.caption ?? b.post.body ?? '').trim();
  const first = (b.media ?? [])
    .filter((m) => m.kind === 'image' || m.kind === 'video')
    .sort((a, z) => a.position - z.position)[0];
  const kind = !first ? 'TEXT' : first.kind === 'video' ? 'VIDEO' : 'IMAGE';
  let mediaUrl = '';
  if (first) {
    // Threads pulls the file itself — signed URL works (bearer URL, 1h).
    mediaUrl = await storageSign('post-media', first.storage_path, 3600);
  }
  const tag = String(b.target.options?.threadsTopic ?? '')
    .replace(/^[#\s]+/, '')
    .replace(/[.&]/g, '')
    .trim()
    .slice(0, 50);

  // Manual/auto thread segments from the app. Head carries media + topic tag;
  // replies are text-only and chain via reply_to_id.
  const segments = ((b.target.options?.thread as string[] | undefined) ?? [])
    .map((s) => (s ?? '').trim())
    .filter(Boolean);

  let remoteId = '';
  if (segments.length > 1) {
    info(`threads target ${b.target.id}: THREAD ${segments.length}`);
    let parent: string | undefined;
    for (let i = 0; i < segments.length; i++) {
      const id = await publishOne({
        threadsId,
        token,
        text: cap(segments[i], 500),
        mediaUrl: i === 0 ? mediaUrl : undefined,
        kind: i === 0 ? kind : 'TEXT',
        topicTag: i === 0 ? tag || undefined : undefined,
        replyToId: parent,
      });
      if (i === 0) remoteId = id;
      parent = id;
    }
  } else {
    info(`threads target ${b.target.id}: ${kind}${tag ? ` #${tag}` : ''}`);
    remoteId = await publishOne({
      threadsId,
      token,
      text: cap(text, 500),
      mediaUrl,
      kind,
      topicTag: tag || undefined,
    });
  }
  return { remoteId, remoteUrl: `https://www.threads.net/post/${remoteId}` };
}
