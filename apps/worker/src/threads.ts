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

export async function publishThreadsTarget(bundle: Bundle): Promise<{ remoteId: string; remoteUrl: string }> {
  const b = bundle as Bundle;
  const threadsId = b.channel.external_id;
  if (!threadsId) throw new Error('Threads channel missing user ID — re-enable cloud publishing.');
  if (!b.secrets.access_secret_id) throw new Error('Threads token missing — re-enable cloud publishing.');
  const token = await readSecret(b.secrets.access_secret_id);
  if (!token) throw new Error('Threads session expired — toggle cloud publishing off and on in Connect to refresh.');
  const tok = encodeURIComponent(token);

  const text = (b.target.caption ?? b.post.body ?? '').trim();
  const first = (b.media ?? [])
    .filter((m) => m.kind === 'image' || m.kind === 'video')
    .sort((a, z) => a.position - z.position)[0];
  const kind = !first ? 'TEXT' : first.kind === 'video' ? 'VIDEO' : 'IMAGE';
  const finalText = text.length > 500 ? text.slice(0, 499) + '…' : text;
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
  const params =
    `media_type=${kind}&text=${encodeURIComponent(finalText)}` +
    (kind === 'IMAGE' ? `&image_url=${encodeURIComponent(mediaUrl)}` : '') +
    (kind === 'VIDEO' ? `&video_url=${encodeURIComponent(mediaUrl)}` : '') +
    (tag ? `&topic_tag=${encodeURIComponent(tag)}` : '') +
    `&access_token=${tok}`;
  info(`threads target ${b.target.id}: ${kind}${tag ? ` #${tag}` : ''}`);

  const c = await fetch(`${THREADS_API}/v1.0/${threadsId}/threads?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
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
    `${THREADS_API}/v1.0/${threadsId}/threads_publish?creation_id=${encodeURIComponent(creationId)}&access_token=${tok}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  );
  const pj: any = await p.json().catch(() => ({}));
  if (p.status === 401) throw new Error('Threads session expired — toggle cloud publishing off and on in Connect to refresh.');
  if (pj.error || !pj.id) throw new Error(gerr(pj, 'Threads publish failed', `publish:${creationId}`));

  const remoteId = String(pj.id);
  return { remoteId, remoteUrl: `https://www.threads.net/post/${remoteId}` };
}
