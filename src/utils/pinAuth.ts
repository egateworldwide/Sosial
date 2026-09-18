import { PIN_CLIENT_ID, PIN_CLIENT_SECRET, PIN_AUTH_ENDPOINT, PIN_TOKEN_ENDPOINT, PIN_API, PIN_SCOPES } from './pinConfig';
import { BRIDGE_URL, appReturnUrl, openAuth } from './metaAuth';
import { loadMetaState, saveMetaState } from './metaStore';

/* ---------------- Login (same bridge page as the other OAuth channels) ---------------- */

export async function loginPinterest(): Promise<boolean> {
  const url =
    `${PIN_AUTH_ENDPOINT}?response_type=code` +
    `&client_id=${encodeURIComponent(PIN_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(BRIDGE_URL)}` +
    `&scope=${encodeURIComponent(PIN_SCOPES.join(','))}` +
    `&state=${encodeURIComponent(appReturnUrl())}`;
  return openAuth(url, 'pinterest');
}

/* ---------------- Token exchange (HTTP Basic, not body creds) ---------------- */

/** App ID + secret are ASCII-safe, so a tiny encoder beats pulling a lib. */
function b64(s: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i);
    const b = i + 1 < s.length ? s.charCodeAt(i + 1) : NaN;
    const c = i + 2 < s.length ? s.charCodeAt(i + 2) : NaN;
    const n = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
    out +=
      chars[(n >> 18) & 63] +
      chars[(n >> 12) & 63] +
      (isNaN(b) ? '=' : chars[(n >> 6) & 63]) +
      (isNaN(c) ? '=' : chars[n & 63]);
  }
  return out;
}

function perr(j: any, fallback: string): string {
  const m =
    j?.error_description ||
    (typeof j?.error === 'string' ? j.error : j?.error?.message) ||
    j?.message;
  return typeof m === 'string' && m.length > 0 ? m : fallback;
}

function qs(p: Record<string, string>): string {
  return Object.entries(p)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

interface PinTokens {
  access: string;
  refresh: string;
  /** epoch ms */
  expiresAt: number;
}

async function tokenRequest(body: Record<string, string>): Promise<PinTokens> {
  const r = await fetch(PIN_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${b64(`${PIN_CLIENT_ID}:${PIN_CLIENT_SECRET}`)}`,
    },
    body: qs(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.access_token) {
    throw new Error(perr(j, 'Pinterest login exchange failed — check the App ID/secret and redirect URI.'));
  }
  return {
    access: String(j.access_token),
    refresh: String(j.refresh_token ?? ''),
    expiresAt: Date.now() + (Number(j.expires_in) || 2592000) * 1000,
  };
}

export async function exchangePinCode(code: string): Promise<PinTokens> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: BRIDGE_URL,
  });
}

export async function refreshPinToken(refreshToken: string): Promise<PinTokens> {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: PIN_SCOPES.join(','),
  });
}

/** Single entry every Pinterest call uses — refreshes up to a day before expiry. */
export async function getValidPin(force = false): Promise<{ token: string }> {
  const m = await loadMetaState();
  if (!m.pinAccessToken) throw new Error('Pinterest not connected');
  if (!force && m.pinExpiresAt && Date.now() < m.pinExpiresAt - 24 * 3600 * 1000) {
    return { token: m.pinAccessToken };
  }
  if (!m.pinRefreshToken) {
    if (!m.pinExpiresAt || Date.now() >= m.pinExpiresAt) throw new Error('Pinterest session expired — reconnect Pinterest.');
    return { token: m.pinAccessToken };
  }
  const t = await refreshPinToken(m.pinRefreshToken);
  await saveMetaState({
    pinAccessToken: t.access,
    pinRefreshToken: t.refresh || undefined,
    pinExpiresAt: t.expiresAt,
  });
  return { token: t.access };
}

export async function fetchPinProfile(token: string): Promise<{ username?: string }> {
  const r = await fetch(`${PIN_API}/user_account`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.username) throw new Error(perr(j, 'Could not read your Pinterest profile.'));
  return { username: String(j.username) };
}

/** Full login: exchange the code, read the profile, save tokens. Board comes later. */
export async function completePinLogin(code: string): Promise<{ name?: string }> {
  const t = await exchangePinCode(code);
  await saveMetaState({
    pinAccessToken: t.access,
    pinRefreshToken: t.refresh || undefined,
    pinExpiresAt: t.expiresAt,
  });
  let name: string | undefined;
  try {
    const prof = await fetchPinProfile(t.access);
    name = prof.username ? `@${prof.username}` : undefined;
  } catch {}
  await saveMetaState({ pinUsername: name });
  return { name };
}
