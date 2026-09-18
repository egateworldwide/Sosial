import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { X_CLIENT_ID, X_AUTH_ENDPOINT, X_TOKEN_ENDPOINT, X_API, X_SCOPES } from './xConfig';
import { BRIDGE_URL, appReturnUrl, openAuth } from './metaAuth';
import { loadMetaState, saveMetaState } from './metaStore';

/** X nests errors three different ways — normalize to a human string.
 *  The machine code (invalid_grant etc.) is appended so failures are debuggable. */
function xerr(j: any, fallback: string): string {
  const m =
    j?.error_description ||
    j?.detail ||
    j?.errors?.[0]?.message ||
    j?.error?.message;
  const code =
    (typeof j?.error === 'string' ? j.error : undefined) ?? j?.error?.code ?? j?.code;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  const withCode =
    typeof code === 'string' && code.length > 0 && !base.includes(code) ? `${base} (${code})` : base;
  if (/client_id|callback|redirect_uri/i.test(withCode)) {
    return `${withCode} — check the Client ID in xConfig.ts and the Callback URI in the X portal.`;
  }
  return withCode;
}

function qs(p: Record<string, string>): string {
  return Object.entries(p)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

const b64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const VERIFIER_KEY = 'sosial_x_verifier_v1';

/** 64 random chars straight from X's allowed alphabet (43–128 required). */
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
async function newVerifier(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(64);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += VERIFIER_ALPHABET[bytes[i] % VERIFIER_ALPHABET.length];
  return out;
}

async function challengeFor(verifier: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return b64url(b64);
}

/* ---------------- Login (same bridge page as Meta/TikTok) ---------------- */

export async function loginX(): Promise<boolean> {
  const verifier = await newVerifier();
  const challenge = await challengeFor(verifier);
  // the verifier must survive an Expo Go reload mid-login — the code is
  // useless without it, so persist alongside the pending channel
  try {
    await AsyncStorage.setItem(VERIFIER_KEY, verifier);
  } catch {}
  const url =
    `${X_AUTH_ENDPOINT}?response_type=code` +
    `&client_id=${encodeURIComponent(X_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(BRIDGE_URL)}` +
    `&scope=${encodeURIComponent(X_SCOPES.join(' '))}` +
    `&state=${encodeURIComponent(appReturnUrl())}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256`;
  const ok = await openAuth(url, 'x');
  if (!ok) {
    try {
      await AsyncStorage.removeItem(VERIFIER_KEY);
    } catch {}
  }
  return ok;
}

export interface XTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** code + stored verifier -> 2h access token + rotating refresh token. */
export async function exchangeXCode(code: string): Promise<XTokens> {
  let verifier = '';
  try {
    verifier = (await AsyncStorage.getItem(VERIFIER_KEY)) ?? '';
  } catch {}
  if (!verifier) throw new Error('X login was interrupted — try connecting again.');
  const r = await fetch(X_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({
      client_id: X_CLIENT_ID,
      code,
      grant_type: 'authorization_code',
      redirect_uri: BRIDGE_URL,
      code_verifier: verifier,
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  try {
    await AsyncStorage.removeItem(VERIFIER_KEY);
  } catch {}
  if (!j.access_token) throw new Error(xerr(j, 'X login exchange failed.'));
  return {
    accessToken: j.access_token as string,
    refreshToken: (j.refresh_token as string) ?? '',
    expiresAt: Date.now() + Number(j.expires_in ?? 7200) * 1000,
  };
}

/** Silent mint — X rotates the refresh token on every use, so both tokens
 *  are persisted in the single write below (the old refresh dies instantly). */
export async function refreshXToken(refreshToken: string): Promise<XTokens> {
  const r = await fetch(X_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({
      client_id: X_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(xerr(j, 'X session expired — reconnect X.'));
  return {
    accessToken: j.access_token as string,
    refreshToken: (j.refresh_token as string) || refreshToken,
    expiresAt: Date.now() + Number(j.expires_in ?? 7200) * 1000,
  };
}

/**
 * The single entry every X call uses. Returns a live access token,
 * refreshing 10 min before expiry. Throws a reconnect message when the
 * refresh token itself is dead.
 */
export async function getValidXToken(): Promise<string> {
  const m = await loadMetaState();
  if (m.xAccessToken && m.xExpiresAt && m.xExpiresAt > Date.now() + 600000) {
    return m.xAccessToken;
  }
  if (!m.xRefreshToken) throw new Error('X not connected');
  try {
    const t = await refreshXToken(m.xRefreshToken);
    await saveMetaState({
      xAccessToken: t.accessToken,
      xRefreshToken: t.refreshToken,
      xExpiresAt: t.expiresAt,
    });
    return t.accessToken;
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (/invalid_grant|invalid_request|expired/i.test(msg)) {
      await saveMetaState({ xAccessToken: undefined, xRefreshToken: undefined, xExpiresAt: undefined });
      throw new Error('X session expired — reconnect X.');
    }
    throw e;
  }
}

export async function fetchXProfile(token: string): Promise<{ id: string; name?: string }> {
  const r = await fetch(`${X_API}/users/me?user.fields=id,name,username`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j: any = await r.json().catch(() => ({}));
  const u = j?.data;
  if (!u?.id) throw new Error(xerr(j, 'Could not read your X profile.'));
  return { id: String(u.id), name: u.username ? `@${u.username}` : undefined };
}

/** Full login: code -> tokens -> profile, all saved to the vault. */
export async function completeXLogin(code: string): Promise<{ name?: string }> {
  const t = await exchangeXCode(code);
  let name: string | undefined;
  let id = '';
  try {
    const prof = await fetchXProfile(t.accessToken);
    id = prof.id;
    name = prof.name;
  } catch {}
  await saveMetaState({
    xAccessToken: t.accessToken,
    xRefreshToken: t.refreshToken || undefined,
    xExpiresAt: t.expiresAt,
    xUserId: id || undefined,
    xName: name,
  });
  return { name };
}
