import * as FileSystem from 'expo-file-system/legacy';
import { supabase, currentSession } from './supabase';
import type { ManagedPost } from './managed';

/**
 * App → cloud write path (post-Wave-A slice). Every local save/delete
 * mirrors to Supabase best-effort: the device is source of truth, the cloud
 * is a follower. Never throws — callers fire-and-forget after local write.
 *
 * Identity: posts.client_id = local ManagedPost.id (P3 unique key), so
 * re-saves upsert instead of duplicating. Media uses deterministic storage
 * paths (<workspace>/<client_id>/<index>.<ext>) with storage upsert:true.
 */

const B64ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64ToBytes(b64: string): Uint8Array {
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

function extFor(uri: string, kind: string): string {
  const u = uri.toLowerCase().split('?')[0];
  const m = u.match(/\.([a-z0-9]{2,4})$/);
  if (m) return m[1];
  return kind === 'video' ? 'mp4' : 'jpg';
}

function mimeFor(ext: string, kind: string): string {
  if (kind === 'video') {
    if (ext === 'mov') return 'video/quicktime';
    return 'video/mp4';
  }
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function deviceTimezone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz ? tz : undefined;
  } catch {
    return undefined;
  }
}

type CloudStatus = 'draft' | 'approval' | 'queued' | 'publishing' | 'sent' | 'partial' | 'failed';

function mapStatus(p: ManagedPost): CloudStatus {
  if (p.status === 'sent') return 'sent';
  if (p.status === 'approval') return 'approval';
  if (p.status === 'queued' || p.scheduledAt) return 'queued';
  return 'draft';
}

/** Mirror one local post (idempotent by client_id). Resolves when done. */
export async function pushPostToCloud(post: ManagedPost): Promise<void> {
  const session = await currentSession().catch(() => null);
  if (!session) {
    console.log('[cloud] skip push — signed out');
    return; // signed out: local-only, syncs on next save after sign-in
  }
  const sb = supabase();
  const wsId = session.workspace.id;
  const userId = session.user.id;
  const status = mapStatus(post);
  const scheduledIso =
    typeof post.scheduledAt === 'number' && post.scheduledAt > 0
      ? new Date(post.scheduledAt).toISOString()
      : null;

  // Post row (upsert on client_id — the P3 idempotency key).
  const { data: prow, error: pErr } = await sb
    .from('posts')
    .upsert(
      {
        workspace_id: wsId,
        created_by: userId,
        client_id: post.id,
        title: post.title ?? '',
        body: post.body ?? '',
        status,
        scheduled_at: scheduledIso,
        timezone: deviceTimezone(),
      },
      { onConflict: 'client_id' },
    )
    .select('id')
    .single();
  if (pErr || !prow) throw new Error('cloud post upsert failed');
  const postId = String((prow as any).id);

  // Cloud channels for this workspace (provider → first connected row).
  const { data: chans, error: chansErr } = await sb
    .from('connected_channels')
    .select('id, provider')
    .eq('workspace_id', wsId)
    .eq('status', 'connected');
  if (chansErr) console.log('[cloud] channels lookup failed:', chansErr.message);
  const byProvider = new Map<string, string>();
  for (const c of (chans ?? []) as any[]) {
    if (!byProvider.has(String(c.provider))) byProvider.set(String(c.provider), String(c.id));
  }

  // Targets: one per platform that is BOTH selected AND cloud-connected.
  // Platforms with no cloud row stay local-only (correct — nothing to publish with).
  let made = 0;
  for (const platform of post.platforms ?? []) {
    const channelId = byProvider.get(platform);
    if (!channelId) continue;
    const options: Record<string, unknown> = {};
    if (post.threadsTopic) options.threadsTopic = post.threadsTopic;
    if (post.ttPrivacy) options.ttPrivacy = post.ttPrivacy;
    if (post.ytPrivacy) options.ytPrivacy = post.ytPrivacy;
    if (post.sourceUrl) options.sourceUrl = post.sourceUrl;
    const format = (post.platformTypes as any)?.[platform];
    const { error: tErr } = await sb.from('post_targets').upsert(
      {
        post_id: postId,
        channel_id: channelId,
        provider: platform,
        format: typeof format === 'string' ? format : null,
        caption: post.body ?? '',
        options,
        status,
        scheduled_at: scheduledIso,
      },
      { onConflict: 'post_id,channel_id' },
    );
    if (tErr) throw new Error(`cloud target upsert failed (${platform})`);
    made += 1;
  }
  console.log(`[cloud] pushed ${post.id}: ${made} target(s) for [${(post.platforms ?? []).join(',')}]`);

  // Media: deterministic paths, storage upsert, fresh post_media links.
  const atts = [
    ...(post.attachments ?? []),
    ...(post.imageUri ? [{ uri: post.imageUri, kind: 'image' as const }] : []),
    ...(post.videoUri ? [{ uri: post.videoUri, kind: 'video' as const }] : []),
  ].slice(0, 10);
  // Replace links wholesale so re-saves can't leave stale order/rows.
  await sb.from('post_media').delete().eq('post_id', postId);
  let position = 0;
  for (const a of atts) {
    if (!a?.uri || position >= 10) continue;
    const kind = a.kind === 'video' ? 'video' : 'image';
    const ext = extFor(a.uri, kind);
    const mime = mimeFor(ext, kind);
    const path = `${wsId}/${post.id}/${position}.${ext}`;
    const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
    const bytes = b64ToBytes(b64);
    if (!bytes.length) continue;
    const blob = new Blob([Uint8Array.from(bytes)], { type: mime });
    const { error: upErr } = await sb.storage.from('post-media').upload(path, blob, {
      contentType: mime,
      upsert: true,
    });
    if (upErr) throw new Error('cloud media upload failed');
    let mediaId: string | null = null;
    const { data: existing } = await sb
      .from('media_assets')
      .select('id')
      .eq('workspace_id', wsId)
      .eq('storage_path', path)
      .maybeSingle();
    if (existing) {
      mediaId = String((existing as any).id);
    } else {
      const { data: ins, error: mErr } = await sb
        .from('media_assets')
        .insert({
          workspace_id: wsId,
          uploaded_by: userId,
          storage_path: path,
          kind,
          mime_type: mime,
          byte_size: bytes.length,
          status: 'ready',
        })
        .select('id')
        .single();
      if (mErr || !ins) throw new Error('cloud media row failed');
      mediaId = String((ins as any).id);
    }
    const { error: linkErr } = await sb
      .from('post_media')
      .insert({ post_id: postId, media_id: mediaId, position });
    if (linkErr) throw new Error('cloud media link failed');
    position += 1;
  }
}

/** Delete the cloud mirror (cascade clears targets + links; bytes fall to the worker janitor). */
export async function deleteCloudPost(clientId: string): Promise<void> {
  const session = await currentSession().catch(() => null);
  if (!session) return;
  const sb = supabase();
  const { data: prow } = await sb.from('posts').select('id').eq('client_id', clientId).maybeSingle();
  const id = (prow as any)?.id;
  if (!id) return;
  const { error } = await sb.from('posts').delete().eq('id', id);
  if (error) throw new Error('cloud post delete failed');
}
