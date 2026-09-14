import * as WebBrowser from 'expo-web-browser';
import {
  META_APP_ID, META_APP_SECRET, graph,
  FB_AUTH_ENDPOINT, FB_SCOPES,
  IG_APP_ID, IG_APP_SECRET, IG_SCOPES, IG_AUTH_ENDPOINT, IG_TOKEN_ENDPOINT, IG_GRAPH,
  THREADS_APP_ID, THREADS_APP_SECRET, THREADS_AUTH_ENDPOINT, THREADS_SCOPES, THREADS_API,
} from './metaConfig';
import { saveMetaState } from './metaStore';

WebBrowser.maybeCompleteAuthSession();

// Meta rejects custom schemes (zap://…) as OAuth redirect URIs — every one
// of the three dashboards requires https. So we bounce through a tiny static
// bridge page (auth.html, hosted on GitHub Pages) which forwards ?code=…
// straight back into zap://redirect, where openAuthSessionAsync captures it.
// Add this exact URL as a Valid OAuth Redirect URI in all three Meta apps:
//   Facebook Login settings, Instagram app OAuth settings, Threads Redirect URIs.
export const BRIDGE_URL = 'https://egateworldwide.github.io/Zap/auth.html';
const RETURN_URL = 'zap://redirect';

export const redirectUri = () => BRIDGE_URL;

function errMsg(j: any, fallback: string): string {
  const m = j?.error?.message || j?.error_description;
  return typeof m === 'string' && m.length > 0 ? m : fallback;
}

/** zap://redirect?code=… → code. Throws the provider's error when denied. */
function parseCode(returnUrl: string): string {
  const afterQ = returnUrl.split('?')[1] ?? '';
  const query = afterQ.split('#')[0];
  const parts = query.split('&');
  let code: string | null = null;
  let err: string | null = null;
  for (const p of parts) {
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

async function loginWithCode(authUrl: string): Promise<string> {
  const res = await WebBrowser.openAuthSessionAsync(authUrl, RETURN_URL);
  if (res.type !== 'success' || !('url' in res) || !res.url) {
    throw new Error('Login was cancelled.');
  }
  return parseCode(res.url);
}

/* ---------------- Facebook ---------------- */

export async function loginFacebook(): Promise<string> {
  const url =
    `${FB_AUTH_ENDPOINT}?client_id=${encodeURIComponent(META_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(BRIDGE_URL)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(FB_SCOPES.join(','))}`;
  return loginWithCode(url);
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
  // FB only — Instagram connects through its own login, never inherit its id here
  await saveMetaState({
    pageId: p.id,
    pageName: p.name,
    pageToken: p.access_token,
    igId: undefined,
    igName: undefined,
    igToken: undefined,
  });
}

/* ---------------- Instagram Business Login (own OAuth, own app) ---------------- */

export async function loginInstagram(): Promise<string> {
  const url =
    `${IG_AUTH_ENDPOINT}?client_id=${encodeURIComponent(IG_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(BRIDGE_URL)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(IG_SCOPES.join(','))}`;
  return loginWithCode(url);
}

/** code -> 1h token -> 60d token, plus the scoped IG user id. */
export async function exchangeInstagramCode(code: string): Promise<{ token: string; userId: string }> {
  const redir = redirectUri();
  const body = (p: Record<string, string>) =>
    Object.entries(p)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  const r1 = await fetch(IG_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body({
      client_id: IG_APP_ID,
      client_secret: IG_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redir,
      code,
    }),
  });
  const j1: any = await r1.json().catch(() => ({}));
  const shortToken: string | undefined =
    j1?.data?.[0]?.access_token ?? j1.access_token;
  const userId: string = String(j1?.data?.[0]?.user_id ?? j1.user_id ?? '');
  if (!shortToken) throw new Error(errMsg(j1?.data?.[0] ?? j1, 'Instagram login exchange failed.'));
  const q = `grant_type=ig_exchange_token&client_secret=${encodeURIComponent(IG_APP_SECRET)}&access_token=${encodeURIComponent(shortToken)}`;
  const r2 = await fetch(`${IG_GRAPH}/access_token?${q}`);
  const j2: any = await r2.json().catch(() => ({}));
  if (!j2.access_token) throw new Error(errMsg(j2, 'Could not get a long-lived Instagram token.'));
  return { token: j2.access_token as string, userId };
}

export async function fetchInstagramProfile(token: string): Promise<{ id: string; username?: string }> {
  const r = await fetch(`${IG_GRAPH}/me?fields=id,username&access_token=${encodeURIComponent(token)}`);
  const j: any = await r.json().catch(() => ({}));
  if (j.error) throw new Error(errMsg(j, 'Could not read your Instagram profile.'));
  return { id: String(j.id), username: j.username ? `@${j.username}` : undefined };
}

/* ---------------- Threads (separate OAuth) ---------------- */

export async function loginThreads(): Promise<string> {
  const url =
    `${THREADS_AUTH_ENDPOINT}?client_id=${encodeURIComponent(THREADS_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(BRIDGE_URL)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(THREADS_SCOPES.join(','))}`;
  return loginWithCode(url);
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
