import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * OAuth survival kit. Expo Go reloads the project when the provider redirects
 * back to exp://…, which wipes React state and drops the pending promise. So we
 * persist which channel is mid-login and replay the return URL on next launch —
 * the Connect screen then finishes the exchange it never got to see.
 */
export type AuthChannel = 'facebook' | 'instagram' | 'threads' | 'tiktok' | 'x' | 'linkedin' | 'mastodon' | 'pinterest' | 'youtube';

export interface AuthResult {
  channel: AuthChannel;
  code?: string;
  error?: string;
  url: string;
}

const PENDING_KEY = 'sosial_pending_auth_v1';

let pendingMemory: AuthChannel | null = null;
let queue: AuthResult[] = [];
let listeners: ((r: AuthResult) => void)[] = [];

export async function setPendingAuth(ch: AuthChannel): Promise<void> {
  pendingMemory = ch;
  try {
    await AsyncStorage.setItem(PENDING_KEY, ch);
  } catch {}
}

export async function getPendingAuth(): Promise<AuthChannel | null> {
  if (pendingMemory) return pendingMemory;
  try {
    const v = await AsyncStorage.getItem(PENDING_KEY);
    return (v as AuthChannel) || null;
  } catch {
    return null;
  }
}

export async function clearPendingAuth(): Promise<void> {
  pendingMemory = null;
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {}
}

/** Pull ?code= / ?error= out of a redirect URL (query or hash). */
export function parseAuthReturn(url: string): { code?: string; error?: string } {
  const afterQ = url.split('?')[1] ?? '';
  const query = afterQ.split('#')[0];
  let code: string | undefined;
  let error: string | undefined;
  for (const p of query.split('&')) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    const v = decodeURIComponent(p.slice(eq + 1).replace(/\+/g, ' '));
    if (k === 'code') code = v;
    else if (k === 'error_description') error = v;
    else if (k === 'error' && !error) error = v;
  }
  return { code, error };
}

export function subscribeAuthResult(fn: (r: AuthResult) => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

/** Hand a result to whoever is listening now, or hold it until the screen mounts. */
export function publishAuthResult(r: AuthResult): void {
  if (listeners.length > 0) listeners.forEach((l) => l(r));
  else queue.push(r);
}

/** Called by an already-mounted screen to drain anything that arrived early. */
export function flushAuthResults(fn: (r: AuthResult) => void): void {
  const pending = queue;
  queue = [];
  pending.forEach(fn);
}

const DONE_KEY = 'sosial_auth_done_v1';

/** Codes already redeemed successfully — a replayed return URL (e.g. after an
 *  Expo Go reload) must never be exchanged twice; providers burn codes on
 *  first redeem and the duplicate always fails. */
export async function wasCodeDone(code: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DONE_KEY)) === code;
  } catch {
    return false;
  }
}

export async function markCodeDone(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DONE_KEY, code);
  } catch {}
}

/** Route a raw return URL through the pending channel. Returns the result it published. */
export async function handleAuthUrl(url: string): Promise<AuthResult | null> {
  if (!url) return null;
  if (!/[?&#](code|error)/.test(url)) return null;
  const channel = await getPendingAuth();
  if (!channel) return null;
  const { code, error } = parseAuthReturn(url);
  const result: AuthResult = { channel, code, error, url };
  publishAuthResult(result);
  return result;
}
