import * as SecureStore from 'expo-secure-store';

export interface MetaState {
  fbUserToken?: string;
  pageId?: string;
  pageName?: string;
  pageToken?: string;
  igToken?: string;
  igId?: string;
  igName?: string;
  threadsToken?: string;
  threadsId?: string;
  threadsName?: string;
  // TikTok — access token dies in 24h, so we keep the expiry + refresh token
  // and mint silently via getValidToken() in tiktokAuth.ts
  ttAccessToken?: string;
  ttRefreshToken?: string;
  ttExpiresAt?: number;
  ttOpenId?: string;
  ttName?: string;
  /** last audience that actually published — preferred over the Public default */
  ttLastPrivacy?: string;
  // Verified-domain upload endpoint for TikTok photo posts (TikTok rejects
  // anonymous hosts for photos via url_ownership_unverified).
  ttPhotoHost?: string;
  // X (OAuth 2.0 PKCE) — access token dies in 2h, so we keep the expiry +
  // rotating refresh token and mint silently via getValidXToken() in xAuth.ts
  xAccessToken?: string;
  xRefreshToken?: string;
  xExpiresAt?: number;
  xUserId?: string;
  xName?: string;
  // Bluesky (AT Protocol) — handle + app password, no OAuth. accessJwt lives
  // ~2h; the PDS host is per-account (resolved at login) and every call goes
  // there. Silent refresh via getValidBsky() in bskyAuth.ts.
  bskyAccessJwt?: string;
  bskyRefreshJwt?: string;
  bskyExpiresAt?: number;
  bskyDid?: string;
  bskyHandle?: string;
  bskyName?: string;
  bskyPdsHost?: string;
  // LinkedIn (OAuth 2.0 code flow) — ~60-day access token + rotating refresh.
  // Silent refresh via getValidLi() in liAuth.ts. Posts as the member by
  // default; liOrgId/liOrgName pick a Company Page you admin (org picker in
  // ConnectScreen) — publish + analytics then target the org instead.
  liAccessToken?: string;
  liRefreshToken?: string;
  liExpiresAt?: number;
  liPersonUrn?: string;
  liName?: string;
  liOrgId?: string;
  liOrgName?: string;
  // Mastodon (per-instance OAuth) — access token is long-lived and doesn't
  // expire, so there's no refresh dance; the instance is the account's server.
  mastodonAccessToken?: string;
  mastodonInstance?: string;
  mastodonAccountId?: string;
  mastodonName?: string;
  // Pinterest (OAuth 2.0 code flow, Basic-auth exchange) — ~30-day access
  // token + non-expiring refresh; silent refresh via getValidPin() in
  // pinAuth.ts. Pins must land on a board (pinBoardId, picked after connect).
  pinAccessToken?: string;
  pinRefreshToken?: string;
  pinExpiresAt?: number;
  pinUsername?: string;
  pinBoardId?: string;
  pinBoardName?: string;
  // YouTube (Google OAuth code flow) — 1-hour access token + refresh token.
  // Silent refresh via getValidYt() in ytAuth.ts. Video-only uploads.
  ytAccessToken?: string;
  ytRefreshToken?: string;
  ytExpiresAt?: number;
  ytChannelName?: string;
}

const KEY = 'zap_meta_v1';

export async function loadMetaState(): Promise<MetaState> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveMetaState(patch: Partial<MetaState>): Promise<MetaState> {
  const cur = await loadMetaState();
  const next = { ...cur, ...patch };
  // drop cleared keys entirely
  for (const k of Object.keys(next) as (keyof MetaState)[]) {
    if (next[k] === undefined) delete next[k];
  }
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export async function clearMetaState(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {}
}

/** Every channel with live credentials right now. */
export function connectedChannelIds(m: MetaState): string[] {
  const out: string[] = [];
  if (m.pageId && m.pageToken) out.push('facebook');
  if (m.igId && m.igToken) out.push('instagram');
  if (m.threadsId && m.threadsToken) out.push('threads');
  if (m.ttRefreshToken || m.ttAccessToken) out.push('tiktok');
  if (m.xUserId && (m.xAccessToken || m.xRefreshToken)) out.push('x');
  if (m.bskyDid && (m.bskyAccessJwt || m.bskyRefreshJwt)) out.push('bluesky');
  if (m.liPersonUrn && (m.liAccessToken || m.liRefreshToken)) out.push('linkedin');
  if (m.mastodonAccessToken && m.mastodonInstance) out.push('mastodon');
  if (m.pinAccessToken) out.push('pinterest');
  if (m.ytRefreshToken || m.ytAccessToken) out.push('youtube');
  return out;
}
