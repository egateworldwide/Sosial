import AsyncStorage from '@react-native-async-storage/async-storage';
import { MASTODON_CLIENT_NAME, MASTODON_SCOPES, mastodonBase, normalizeInstance } from './mastodonConfig';
import { BRIDGE_URL, appReturnUrl, openAuth } from './metaAuth';
import { loadMetaState, saveMetaState } from './metaStore';

/**
 * Mastodon apps are registered per instance, and the client id/secret are
 * needed again at code-exchange time — possibly after an Expo Go reload wiped
 * React state — so they're parked in AsyncStorage next to the pending channel.
 */
const PENDING_KEY = 'sosial_mastodon_pending_v1';

interface Pending {
  instance: string;
  clientId: string;
  clientSecret: string;
}

function merr(j: any, fallback: string): string {
  const m =
    j?.error_description ||
    (typeof j?.error === 'string' ? j.error : j?.error?.message) ||
    j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  // Burned/replayed codes surface as invalid_grant — almost always a double
  // delivery of the same login, so say so instead of quoting server text.
  if (/invalid_grant|authorization grant/i.test(base)) {
    return 'That login link was already used — if Mastodon shows Connected below, you’re all set.';
  }
  return base;
}

function qs(p: Record<string, string>): string {
  return Object.entries(p)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function getPending(): Promise<Pending | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}

async function setPending(p: Pending): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {}
}

async function clearPending(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {}
}

/**
 * Register Sosial on the entered instance, then open that instance's consent
 * page through the shared bridge. Returns false when the user backs out.
 */
export async function loginMastodon(instanceInput: string): Promise<boolean> {
  const instance = normalizeInstance(instanceInput);
  const base = mastodonBase(instance);
  const r = await fetch(`${base}/api/v1/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: MASTODON_CLIENT_NAME,
      redirect_uris: BRIDGE_URL,
      scopes: MASTODON_SCOPES.join(' '),
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.client_id) {
    throw new Error(merr(j, 'Could not register on that server — check the address and try again.'));
  }
  await setPending({
    instance,
    clientId: String(j.client_id),
    clientSecret: String(j.client_secret ?? ''),
  });
  const url =
    `${base}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(String(j.client_id))}` +
    `&redirect_uri=${encodeURIComponent(BRIDGE_URL)}` +
    `&scope=${encodeURIComponent(MASTODON_SCOPES.join(' '))}` +
    `&state=${encodeURIComponent(appReturnUrl())}`;
  const ok = await openAuth(url, 'mastodon');
  if (!ok) await clearPending();
  return ok;
}

/** code -> long-lived access token (API-registered apps don't get refresh tokens). */
async function exchangeMastodonCode(code: string): Promise<{ token: string; instance: string }> {
  const pending = await getPending();
  if (!pending) throw new Error('Mastodon login was interrupted — try connecting again.');
  const r = await fetch(`${mastodonBase(pending.instance)}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({
      grant_type: 'authorization_code',
      code,
      client_id: pending.clientId,
      client_secret: pending.clientSecret,
      redirect_uri: BRIDGE_URL,
      scope: MASTODON_SCOPES.join(' '),
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.access_token) throw new Error(merr(j, 'Mastodon login exchange failed.'));
  return { token: String(j.access_token), instance: pending.instance };
}

export async function fetchMastodonProfile(instance: string, token: string): Promise<{ id: string; name?: string }> {
  const r = await fetch(`${mastodonBase(instance)}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.id) throw new Error(merr(j, 'Could not read your Mastodon profile.'));
  return { id: String(j.id), name: j.acct ? `@${j.acct}` : undefined };
}

/** Full login: exchange the code, read the profile, save instance + token. */
export async function completeMastodonLogin(code: string): Promise<{ name?: string }> {
  const { token, instance } = await exchangeMastodonCode(code);
  await clearPending();
  let name: string | undefined;
  let id = '';
  try {
    const prof = await fetchMastodonProfile(instance, token);
    id = prof.id;
    name = prof.name;
  } catch {}
  await saveMetaState({
    mastodonAccessToken: token,
    mastodonInstance: instance,
    mastodonAccountId: id || undefined,
    mastodonName: name,
  });
  return { name };
}

/** Mastodon tokens don't expire — the single entry every call uses. */
export async function getValidMastodon(): Promise<{ token: string; instance: string; accountId: string }> {
  const m = await loadMetaState();
  if (!m.mastodonAccessToken || !m.mastodonInstance) throw new Error('Mastodon not connected');
  return { token: m.mastodonAccessToken, instance: m.mastodonInstance, accountId: m.mastodonAccountId ?? '' };
}
