import 'react-native-url-polyfill/auto';
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

/**
 * Supabase client (staging) — the cloud backend for auth + workspace data.
 *
 * - Session lives in SecureStore (never AsyncStorage): only the Supabase
 *   session token is on-device; provider OAuth tokens stay server-side (P2).
 * - Values come from `.env` (EXPO_PUBLIC_SUPABASE_*). If unset, every helper
 *   throws a friendly "not configured" error and the Account UI shows setup
 *   state instead of crashing.
 */

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function isSupabaseConfigured(): boolean {
  return URL.length > 0 && ANON.length > 0;
}

/** Base URL for hand-built Storage calls (signed-URL uploads). */
export function supabaseUrl(): string {
  supabase(); // throws the friendly error when unconfigured
  return URL;
}

const SecureSession = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Cloud backend not configured — add EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY to .env and restart Expo.');
  }
  if (!client) {
    client = createClient(URL, ANON, {
      auth: {
        storage: SecureSession as any,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

function friendly(e: any, fallback: string): Error {
  const m = String(e?.message ?? '');
  if (/fetch|network|failed/i.test(m)) return new Error('Could not reach the cloud backend — check your connection.');
  if (/invalid login|invalid_credentials/i.test(m)) return new Error('Wrong email or password.');
  if (/already registered|already exists|duplicate/i.test(m)) return new Error('That email already has an account — sign in instead.');
  if (/email not confirmed/i.test(m)) return new Error('Confirm your email first — check your inbox for the link.');
  return new Error(m || fallback);
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
}

/** Workspace for this user (created on first login). Null when logged out. */
export async function myWorkspace(userId: string, email: string): Promise<WorkspaceInfo | null> {
  const sb = supabase();
  // status='active' mirrors the Edge Functions' membership gate — a stale
  // invited/removed row must never look like a workspace (that phantom is
  // exactly what 403s cloud calls while the app looks signed in).
  const { data: mem, error: memErr } = await sb
    .from('workspace_members')
    .select('role, workspaces!inner(id, name)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (memErr) throw friendly(memErr, 'Could not load your workspace.');
  if (mem?.workspaces) {
    const w = mem.workspaces as any;
    return { id: String(w.id), name: String(w.name ?? 'My team'), role: mem.role as WorkspaceInfo['role'] };
  }
  // First login: bootstrap workspace + owner membership (RLS allows both:
  // workspaces_owner_create + the owner-bootstrapping members policy).
  const { data: ws, error: wsErr } = await sb
    .from('workspaces')
    .insert({ name: 'My team', owner_id: userId })
    .select('id, name')
    .single();
  if (wsErr || !ws) throw friendly(wsErr, 'Could not create your workspace.');
  const { error: mErr } = await sb.from('workspace_members').insert({
    workspace_id: ws.id,
    user_id: userId,
    email,
    role: 'owner',
    status: 'active',
    all_channels: true,
  });
  if (mErr) throw friendly(mErr, 'Could not join your workspace.');
  return { id: String(ws.id), name: String(ws.name ?? 'My team'), role: 'owner' };
}

export async function currentSession(): Promise<{ user: User; session: Session; workspace: WorkspaceInfo } | null> {
  const sb = supabase();
  const { data, error } = await sb.auth.getSession();
  if (error) throw friendly(error, 'Could not restore your session.');
  if (!data.session?.user) return null;
  const workspace = await myWorkspace(data.session.user.id, data.session.user.email ?? '');
  if (!workspace) return null;
  return { user: data.session.user, session: data.session, workspace };
}

export async function signUpEmail(email: string, password: string): Promise<{ needsConfirm: boolean; email: string }> {
  const sb = supabase();
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
  if (error) throw friendly(error, 'Sign-up failed.');
  if (!data.session) return { needsConfirm: true, email: email.trim() };
  await myWorkspace(data.session.user.id, data.session.user.email ?? email.trim());
  return { needsConfirm: false, email: email.trim() };
}

export async function signInEmail(email: string, password: string): Promise<WorkspaceInfo> {
  const sb = supabase();
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session) throw friendly(error, 'Sign-in failed.');
  const ws = await myWorkspace(data.session.user.id, data.session.user.email ?? email.trim());
  if (!ws) throw new Error('Signed in, but no workspace — try again.');
  return ws;
}

export async function signOutCloud(): Promise<void> {
  try {
    await supabase().auth.signOut();
  } catch {
    // local session is already gone from SecureStore's perspective on next
    // launch; a failed server sign-out must not trap the user signed in.
  }
  client = null;
}

export function onCloudAuthChange(cb: (user: User | null) => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((_ev, session) => cb(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}

/* ---------------- Profile sync (local Account <-> cloud) ---------------- */

export interface CloudProfile {
  email: string;
  team: string;
  notifPosts: boolean;
  notifComments: boolean;
  notifWeekly: boolean;
}

/** Cloud wins: called after sign-in so reinstalls restore identity. Null when logged out. */
export async function pullProfileFromCloud(): Promise<CloudProfile | null> {
  const sb = supabase();
  const { data } = await sb.auth.getUser();
  const user = data?.user;
  if (!user) return null;
  const [profRes, workspace] = await Promise.all([
    sb.from('profiles').select('notif_posts, notif_comments, notif_weekly').eq('id', user.id).maybeSingle(),
    myWorkspace(user.id, user.email ?? ''),
  ]);
  if (!workspace) return null;
  const p = (profRes?.data ?? {}) as any;
  return {
    email: user.email ?? '',
    team: workspace.name,
    notifPosts: p.notif_posts ?? true,
    notifComments: p.notif_comments ?? true,
    notifWeekly: p.notif_weekly ?? false,
  };
}

/**
 * Best-effort push after any local profile edit. Never throws, never blocks
 * the UI — local already saved by the caller. No-ops when logged out.
 * NOTE: login-email changes are deferred (auth.updateUser confirmation flow);
 * only team name + notification prefs sync upward for now.
 */
export async function pushProfileToCloud(patch: {
  team?: string;
  notifPosts?: boolean;
  notifComments?: boolean;
  notifWeekly?: boolean;
}): Promise<void> {
  try {
    const sb = supabase();
    const { data } = await sb.auth.getUser();
    const user = data?.user;
    if (!user) return;
    if (patch.team !== undefined) {
      const ws = await myWorkspace(user.id, user.email ?? '');
      if (ws?.id) {
        const { error } = await sb.from('workspaces').update({ name: patch.team }).eq('id', ws.id);
        if (error) throw error;
      }
    }
    const notif: Record<string, boolean> = {};
    if (patch.notifPosts !== undefined) notif.notif_posts = patch.notifPosts;
    if (patch.notifComments !== undefined) notif.notif_comments = patch.notifComments;
    if (patch.notifWeekly !== undefined) notif.notif_weekly = patch.notifWeekly;
    if (Object.keys(notif).length > 0) {
      const { error } = await sb.from('profiles').update(notif).eq('id', user.id);
      if (error) throw error;
    }
  } catch {
    // best-effort only
  }
}

/* ---------------- Google (Supabase Auth provider) ---------------- */

/**
 * Deep-link target for OAuth return (`sosial://…` standalone, `exp://…` in
 * Expo Go). Kept for future OAuth providers; Google uses the Expo proxy flow
 * in AccountScreen instead, so Expo Go works on any network with no
 * allowlist chasing.
 */
export function oauthRedirect(): string {
  return Linking.createURL('auth/callback');
}

/**
 * Turn a Google session into a workspace-backed sign-in. Shared tail for all
 * Google entry points (browser OAuth today, native one-tap later).
 */
async function finishGoogleSession(): Promise<WorkspaceInfo> {
  const sb = supabase();
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session) throw friendly(error, 'Could not finish Google sign-in.');
  const ws = await myWorkspace(data.session.user.id, data.session.user.email ?? '');
  if (!ws) throw new Error('Signed in, but no workspace — try again.');
  return ws;
}

/**
 * Google sign-in through Supabase Auth (browser OAuth).
 * Works in dev/standalone builds where the sosial:// scheme returns to the
 * app. Does NOT work in Expo Go (Google Web clients only accept https
 * redirects, and Go can only receive exp://) — the UI gates it there.
 * No Google IDs in code — the Google Cloud client lives in the Supabase
 * dashboard provider config.
 */
export async function signInWithGoogle(): Promise<WorkspaceInfo> {
  const sb = supabase();
  const redirectTo = oauthRedirect();
  // Visible in the Metro terminal AND in failure messages — the exact string
  // Supabase must have allowlisted, otherwise it falls back to the Site URL
  // website and the browser never comes back to the app.
  console.log('[oauth] Google redirectTo =', redirectTo);
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw friendly(error, 'Could not start Google sign-in.');
  let res: WebBrowser.WebBrowserAuthSessionResult;
  try {
    res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  } catch {
    throw new Error('Could not open the browser for Google sign-in.');
  }
  if (res.type !== 'success') {
    throw new Error(
      `Google sign-in did not come back to the app (${res.type}). ` +
        `If Google left you on a website, Supabase doesn't recognise this return address — ` +
        `allowlist it under Auth → URL Configuration → Redirect URLs: ${redirectTo}`,
    );
  }
  // Supabase redirects to redirectTo with ?code=… — parse it directly so we
  // don't depend on URL-constructor typings in RN.
  const cm = /[?&]code=([^&#]+)/.exec(res.url);
  const code = cm ? decodeURIComponent(cm[1]) : null;
  if (!code) {
    throw new Error(`Google did not return here correctly. Allowlist this redirect in Supabase → Auth → URL Configuration: ${redirectTo}`);
  }
  const { error: exErr } = await sb.auth.exchangeCodeForSession(code);
  if (exErr) throw friendly(exErr, 'Could not finish Google sign-in.');
  return finishGoogleSession();
}

/* ---------------- Channel token bridge (Edge Functions) ---------------- */

async function callChannelFunction(name: string, body: Record<string, unknown>): Promise<any> {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) throw new Error('Sign in to Sosial Cloud first (Account tab).');
  let res: Response;
  try {
    res = await fetch(`${URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON,
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the cloud backend — check your connection.');
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = String(json?.error ?? '');
    if (res.status === 401) throw new Error('Your cloud session expired — sign in again (Account tab).');
    if (res.status === 403) throw new Error('You are not a member of this workspace.');
    throw new Error(m || 'Cloud request failed — try again.');
  }
  return json;
}

/** Mirror one channel's device credentials into Vault. Returns the channel id. */
export async function importChannelToken(body: Record<string, unknown>): Promise<string> {
  const json = await callChannelFunction('import-channel-token', body);
  if (!json?.channel_id) throw new Error('Cloud did not register the channel — try again.');
  return String(json.channel_id);
}

/** Remove one channel's cloud copy (Vault secrets included). Idempotent.
 * Without external_id, removes ALL rows of that provider in the workspace
 * (cleanup when device tokens are already gone). */
export async function removeChannelToken(body: {
  workspace_id: string;
  provider: string;
  external_id?: string;
}): Promise<void> {
  await callChannelFunction('remove-channel-token', body);
}
