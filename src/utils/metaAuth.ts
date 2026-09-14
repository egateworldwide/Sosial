import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import {
  META_APP_ID, META_APP_SECRET, THREADS_APP_ID, THREADS_APP_SECRET, graph,
  FB_AUTH_ENDPOINT, FB_SCOPES,
  THREADS_AUTH_ENDPOINT, THREADS_SCOPES, THREADS_API,
} from './metaConfig';
import { saveMetaState } from './metaStore';

// Expo Go can't receive custom schemes back from Meta, so it goes through
// the Expo proxy (real https — the only thing Meta's URI field accepts).
// Standalone builds use the app scheme directly.
const PROXY_URL = 'https://auth.expo.io/@naqibhusainii/zap';

export const redirectUri = () =>
  Constants.appOwnership === 'expo'
    ? PROXY_URL
    : AuthSession.makeRedirectUri({ scheme: 'zap', path: 'redirect' });

function errMsg(j: any, fallback: string): string {
  const m = j?.error?.message || j?.error_description;
  return typeof m === 'string' && m.length > 0 ? m : fallback;
}

/* ---------------- Facebook / Instagram (shared login) ---------------- */

export function useFacebookAuth() {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: META_APP_ID,
      scopes: FB_SCOPES,
      redirectUri: redirectUri(),
      responseType: AuthSession.ResponseType.Code,
    },
    { authorizationEndpoint: FB_AUTH_ENDPOINT },
  );
  return { request, response, promptAsync };
}

/** code -> short token -> 60-day token. Throws a human message on failure. */
export async function exchangeFacebookCode(code: string): Promise<string> {
  const redir = redirectUri();
  const q1 = `client_id=${encodeURIComponent(META_APP_ID)}&redirect_uri=${encodeURIComponent(redir)}&client_secret=${encodeURIComponent(META_APP_SECRET)}&code=${encodeURIComponent(code)}`;
  const r1 = await fetch(graph(`/oauth/access_token?${q1}`));
  const j1: any = await r1.json().catch(() => ({}));
  if (!j1.access_token) throw new Error(errMsg(j1, 'Facebook login exchange failed.'));
  const q2 = `grant_type=fb_exchange_token&client_id=${encodeURIComponent(META_APP_ID)}&client_secret=${encodeURIComponent(META_APP_SECRET)}&fb_exchange_token=${encodeURIComponent(j1.access_token)}`;
  const r2 = await fetch(graph(`/oauth/access_token?${q2}`));
  const j2: any = await r2.json().catch(() => ({}));
  if (!j2.access_token) throw new Error(errMsg(j2, 'Could not get a long-lived token.'));
  return j2.access_token as string;
}

export interface FbPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

export async function fetchPages(userToken: string): Promise<FbPage[]> {
  const r = await fetch(
    graph(`/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`),
  );
  const j: any = await r.json().catch(() => ({}));
  if (j.error) throw new Error(errMsg(j, 'Could not list your Pages.'));
  return (j.data ?? []) as FbPage[];
}

export async function pickPage(p: FbPage): Promise<void> {
  await saveMetaState({
    pageId: p.id,
    pageName: p.name,
    pageToken: p.access_token,
    igId: p.instagram_business_account?.id,
    igName: p.instagram_business_account?.username
      ? `@${p.instagram_business_account.username}`
      : undefined,
  });
}

/* ---------------- Threads (separate OAuth) ---------------- */

export function useThreadsAuth() {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: THREADS_APP_ID,
      scopes: THREADS_SCOPES,
      redirectUri: redirectUri(),
      responseType: AuthSession.ResponseType.Code,
    },
    { authorizationEndpoint: THREADS_AUTH_ENDPOINT },
  );
  return { request, response, promptAsync };
}

/** code -> short token -> 60-day token, plus the Threads user id. */
export async function exchangeThreadsCode(code: string): Promise<{ token: string; userId: string }> {
  const redir = redirectUri();
  const body = (p: Record<string, string>) =>
    Object.entries(p)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  const r1 = await fetch(`${THREADS_API}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body({
      client_id: THREADS_APP_ID,
      client_secret: THREADS_APP_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redir,
    }),
  });
  const j1: any = await r1.json().catch(() => ({}));
  if (!j1.access_token) throw new Error(errMsg(j1, 'Threads login exchange failed.'));
  const r2 = await fetch(`${THREADS_API}/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body({
      grant_type: 'th_exchange_token',
      client_secret: THREADS_APP_SECRET,
      access_token: j1.access_token,
    }),
  });
  const j2: any = await r2.json().catch(() => ({}));
  if (!j2.access_token) throw new Error(errMsg(j2, 'Could not get a long-lived Threads token.'));
  return { token: j2.access_token as string, userId: String(j1.user_id ?? '') };
}

export async function fetchThreadsProfile(token: string): Promise<{ id: string; username?: string }> {
  const r = await fetch(`${THREADS_API}/me?fields=id,username&access_token=${encodeURIComponent(token)}`);
  const j: any = await r.json().catch(() => ({}));
  if (j.error) throw new Error(errMsg(j, 'Could not read your Threads profile.'));
  return { id: String(j.id), username: j.username ? `@${j.username}` : undefined };
}
