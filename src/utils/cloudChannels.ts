import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadMetaState, type MetaState } from './metaStore';
import { getValidYt } from './ytAuth';
import { currentSession, importChannelToken, removeChannelToken } from './supabase';

/**
 * Cloud publishing opt-in (Phase 1 → 2 bridge).
 *
 * Each connected channel can be mirrored into Vault via the
 * import-channel-token Edge Function. Device tokens stay put — the cloud copy
 * is independent, per-channel, and revocable. Local flags record which
 * channels the user enabled; the server is source of truth for nothing here.
 */

const KEY = 'sosial_cloud_channels_v1';

export type CloudChannelKey =
  | 'facebook' | 'instagram' | 'threads' | 'tiktok' | 'x'
  | 'bluesky' | 'linkedin' | 'mastodon' | 'pinterest' | 'youtube';

export async function loadCloudChannels(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function setCloudChannel(key: string, on: boolean): Promise<string[]> {
  const cur = await loadCloudChannels();
  const next = on ? [...new Set([...cur, key])] : cur.filter((k) => k !== key);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return next;
}

const iso = (ms?: number): string | undefined =>
  typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : undefined;

export interface ImportPayload {
  provider: string;
  external_id: string;
  display_name?: string;
  handle?: string;
  instance_url?: string;
  scopes?: string[];
  metadata?: Record<string, string>;
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: string;
  refresh_expires_at?: string;
}

async function fetchYtChannelId(token: string): Promise<string | null> {
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j: any = await r.json().catch(() => ({}));
    const id = j?.items?.[0]?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * Build the import body from device state. Null = nothing importable
 * (channel not connected, or a required id is missing) — caller alerts.
 */
export async function buildImportPayload(
  key: CloudChannelKey,
  m: MetaState,
): Promise<ImportPayload | null> {
  switch (key) {
    case 'facebook':
      if (!m.pageId || !m.pageToken) return null;
      return { provider: 'facebook', external_id: m.pageId, display_name: m.pageName, access_token: m.pageToken };
    case 'instagram':
      if (!m.igId || !m.igToken) return null;
      return { provider: 'instagram', external_id: m.igId, display_name: m.igName, access_token: m.igToken };
    case 'threads':
      if (!m.threadsId || !m.threadsToken) return null;
      return { provider: 'threads', external_id: m.threadsId, display_name: m.threadsName, access_token: m.threadsToken };
    case 'tiktok':
      if (!m.ttOpenId || (!m.ttAccessToken && !m.ttRefreshToken)) return null;
      return {
        provider: 'tiktok', external_id: m.ttOpenId, display_name: m.ttName,
        access_token: m.ttAccessToken ?? m.ttRefreshToken ?? '',
        refresh_token: m.ttRefreshToken, expires_at: iso(m.ttExpiresAt),
      };
    case 'x':
      if (!m.xUserId || (!m.xAccessToken && !m.xRefreshToken)) return null;
      return {
        provider: 'x', external_id: m.xUserId, display_name: m.xName,
        access_token: m.xAccessToken ?? m.xRefreshToken ?? '',
        refresh_token: m.xRefreshToken, expires_at: iso(m.xExpiresAt),
      };
    case 'bluesky': {
      // Session tokens only — the app password itself is never stored on
      // device. When the refresh JWT dies, the user re-enables to refresh.
      if (!m.bskyDid || (!m.bskyAccessJwt && !m.bskyRefreshJwt)) return null;
      return {
        provider: 'bluesky', external_id: m.bskyDid, handle: m.bskyHandle, display_name: m.bskyName,
        instance_url: m.bskyPdsHost,
        access_token: m.bskyAccessJwt ?? m.bskyRefreshJwt ?? '',
        refresh_token: m.bskyRefreshJwt, expires_at: iso(m.bskyExpiresAt),
      };
    }
    case 'linkedin': {
      if (!m.liPersonUrn || (!m.liAccessToken && !m.liRefreshToken)) return null;
      const metadata: Record<string, string> = {};
      if (m.liOrgId) metadata.liOrgId = m.liOrgId;
      if (m.liOrgName) metadata.liOrgName = m.liOrgName;
      return {
        provider: 'linkedin', external_id: m.liPersonUrn, display_name: m.liName,
        access_token: m.liAccessToken ?? m.liRefreshToken ?? '',
        refresh_token: m.liRefreshToken, expires_at: iso(m.liExpiresAt), metadata,
      };
    }
    case 'mastodon':
      if (!m.mastodonAccountId || !m.mastodonAccessToken || !m.mastodonInstance) return null;
      return {
        provider: 'mastodon', external_id: m.mastodonAccountId, display_name: m.mastodonName,
        instance_url: m.mastodonInstance, access_token: m.mastodonAccessToken,
      };
    case 'pinterest': {
      if (!m.pinUsername || !m.pinAccessToken) return null;
      const metadata: Record<string, string> = {};
      if (m.pinBoardId) metadata.pinBoardId = m.pinBoardId;
      if (m.pinBoardName) metadata.pinBoardName = m.pinBoardName;
      return {
        provider: 'pinterest', external_id: m.pinUsername, display_name: m.pinUsername,
        access_token: m.pinAccessToken, refresh_token: m.pinRefreshToken,
        expires_at: iso(m.pinExpiresAt), metadata,
      };
    }
    case 'youtube': {
      if (!m.ytAccessToken && !m.ytRefreshToken) return null;
      let token = m.ytAccessToken;
      try {
        ({ token } = await getValidYt());
      } catch {
        return null;
      }
      const channelId = await fetchYtChannelId(token);
      if (!channelId) return null;
      return {
        provider: 'youtube', external_id: channelId, display_name: m.ytChannelName,
        access_token: token, refresh_token: m.ytRefreshToken,
        expires_at: iso(m.ytExpiresAt),
      };
    }
    default:
      return null;
  }
}

/**
 * Enable cloud publishing for one channel. Throws friendly errors for the UI:
 * not signed in, nothing to import, or the function's message.
 */
export async function enableCloudChannel(key: CloudChannelKey): Promise<void> {
  const session = await currentSession();
  if (!session) throw new Error('Sign in to Sosial Cloud first (Account tab) — cloud publishing needs your workspace.');
  const meta = await loadMetaState();
  const payload = await buildImportPayload(key, meta);
  if (!payload) throw new Error('Reconnect this channel first — there are no credentials on this device to send.');
  await importChannelToken({ workspace_id: session.workspace.id, ...payload });
  await setCloudChannel(key, true);
}

/**
 * Disable cloud publishing: best-effort server removal, guaranteed local
 * flag clear. Never throws — the toggle must always move. Pass the
 * pre-clear snapshot when called from a disconnect handler (avoids a
 * load-vs-clear race on SecureStore).
 */
export async function disableCloudChannel(key: CloudChannelKey, snapshot?: MetaState): Promise<void> {
  try {
    const session = await currentSession();
    const meta = snapshot ?? (await loadMetaState());
    const payload = session ? await buildImportPayload(key, meta) : null;
    if (session && payload) {
      await removeChannelToken({
        workspace_id: session.workspace.id,
        provider: payload.provider,
        external_id: payload.external_id,
      });
    }
  } catch {
    // server cleanup is best-effort; the flag still clears below
  }
  await setCloudChannel(key, false);
}
