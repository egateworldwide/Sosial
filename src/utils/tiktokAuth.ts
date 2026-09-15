import * as WebBrowser from 'expo-web-browser';
import {
  TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_AUTH_ENDPOINT, TT_TOKEN_ENDPOINT,
  TT_API, TT_SCOPES,
} from './tiktokConfig';
import { BRIDGE_URL } from './metaAuth';
import { loadMetaState, saveMetaState } from './metaStore';

const RETURN_URL = 'sosial://redirect';

/** TikTok nests errors as { error: { code, message } } with code 'ok' on success. */
function terr(j: any, fallback: string): string {
  const code = j?.error?.code;
  if (!code || code === 'ok') return fallback;
  const m = j?.error?.message;
  return typeof m === 'string' && m.length > 0 ? `${m} (${code})` : `${fallback} (${code})`;
}

function qs(p: Record<string, string>): string {
  return Object.entries(p)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** sosial://redirect?code=… → code. Throws the provider's error when denied. */
function parseCode(returnUrl: string): string {
  const afterQ = returnUrl.split('?')[1] ?? '';
  const query = afterQ.split('#')[0];
  let code: string | null = null;
  let err: string | null = null;
  for (const p of query.split('&')) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    const v = decodeURIComponent(p.slice(eq + 1).replace(/\+/g, ' '));
    if (k === 'code') code = v;
    if (k === 'error_description') err = v;
    else if (k === 'error' && !err) err = v;
  }
  if (code) return code;
  throw new Error(err || 'Login was cancelled.');
}

/* ---------------- Login (same bridge page as Meta — it forwards ?code=) ---------------- */

export async function loginTikTok(): Promise<string> {
  const url =
    `${TT_AUTH_ENDPOINT}?client_key=${encodeURIComponent(TT_CLIENT_KEY)}` +
    `&scope=${encodeURIComponent(TT_SCOPES.join(','))}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(BRIDGE_URL)}` +
    `&state=sosial_${Date.now().toString(36)}`;
  const res = await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
  if (res.type !== 'success' || !('url' in res) || !res.url) {
    throw new Error('Login was cancelled.');
  }
  return parseCode(res.url);
}

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  openId: string;
}

/** code -> 24h access token + 1-year refresh token. */
export async function exchangeTikTokCode(code: string): Promise<TikTokTokens> {
  const r = await fetch(TT_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({
      client_key: TT_CLIENT_KEY,
      client_secret: TT_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: BRIDGE_URL,
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(terr(j, 'TikTok login exchange failed.'));
  return {
    accessToken: j.access_token as string,
    refreshToken: j.refresh_token as string,
    expiresAt: Date.now() + Number(j.expires_in ?? 86400) * 1000,
    openId: String(j.open_id ?? ''),
  };
}

/** Silent mint — no user interaction. Handles rotation (new refresh may differ). */
export async function refreshTikTokToken(refreshToken: string): Promise<TikTokTokens> {
  const r = await fetch(TT_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({
      client_key: TT_CLIENT_KEY,
      client_secret: TT_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(terr(j, 'TikTok session expired — reconnect TikTok.'));
  return {
    accessToken: j.access_token as string,
    refreshToken: (j.refresh_token as string) || refreshToken,
    expiresAt: Date.now() + Number(j.expires_in ?? 86400) * 1000,
    openId: String(j.open_id ?? ''),
  };
}

/**
 * The single entry every TikTok call uses. Returns a live access token,
 * refreshing 10 min before expiry. Throws a reconnect message when the
 * refresh token itself is dead (invalid_grant).
 */
export async function getValidToken(): Promise<string> {
  const m = await loadMetaState();
  if (m.ttAccessToken && m.ttExpiresAt && m.ttExpiresAt > Date.now() + 600000) {
    return m.ttAccessToken;
  }
  if (!m.ttRefreshToken) throw new Error('TikTok not connected');
  try {
    const t = await refreshTikTokToken(m.ttRefreshToken);
    await saveMetaState({
      ttAccessToken: t.accessToken,
      ttRefreshToken: t.refreshToken,
      ttExpiresAt: t.expiresAt,
      ttOpenId: t.openId || m.ttOpenId,
    });
    return t.accessToken;
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (/invalid_grant|invalid_request/i.test(msg)) {
      await saveMetaState({
        ttAccessToken: undefined, ttRefreshToken: undefined, ttExpiresAt: undefined,
      });
      throw new Error('TikTok session expired — reconnect TikTok.');
    }
    throw e;
  }
}

export async function fetchTikTokProfile(token: string): Promise<{ openId: string; name?: string }> {
  const r = await fetch(`${TT_API}/v2/user/info/?fields=open_id,display_name,avatar_url`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j: any = await r.json().catch(() => ({}));
  const u = j?.data?.user;
  if (!u?.open_id) throw new Error(terr(j, 'Could not read your TikTok profile.'));
  return { openId: String(u.open_id), name: u.display_name ? `@${u.display_name}` : undefined };
}

export interface CreatorInfo {
  nickname?: string;
  privacyOptions: string[];
  maxDurationSec?: number;
}

/** Who you're posting as + which privacy levels TikTok will accept from you. */
export async function fetchCreatorInfo(token: string): Promise<CreatorInfo> {
  const r = await fetch(`${TT_API}/v2/post/publish/creator_info/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: '{}',
  });
  const j: any = await r.json().catch(() => ({}));
  const d = j?.data;
  if (!d || j?.error?.code !== 'ok') throw new Error(terr(j, 'Could not read your TikTok creator info.'));
  return {
    nickname: d.creator_nickname ? `@${d.creator_nickname}` : undefined,
    privacyOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options.map(String) : [],
    maxDurationSec: typeof d.max_video_post_duration_sec === 'number' ? d.max_video_post_duration_sec : undefined,
  };
}

/** Full login: code -> tokens -> profile, all saved to the vault. */
export async function completeTikTokLogin(code: string): Promise<{ name?: string }> {
  const t = await exchangeTikTokCode(code);
  let name: string | undefined;
  let openId = t.openId;
  try {
    const prof = await fetchTikTokProfile(t.accessToken);
    openId = prof.openId || openId;
    name = prof.name;
  } catch {}
  if (!name) {
    try {
      const ci = await fetchCreatorInfo(t.accessToken);
      name = ci.nickname;
    } catch {}
  }
  await saveMetaState({
    ttAccessToken: t.accessToken,
    ttRefreshToken: t.refreshToken,
    ttExpiresAt: t.expiresAt,
    ttOpenId: openId || undefined,
    ttName: name,
  });
  return { name };
}
