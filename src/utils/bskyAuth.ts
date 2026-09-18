import { BSKY_RESOLVE, BSKY_PLC } from './bskyConfig';
import { loadMetaState, saveMetaState } from './metaStore';

/** Bluesky nests errors as { error, message }. */
function berr(j: any, fallback: string): string {
  const m = j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (/invalid identifier|invalid password|account is takendown|deactivated/i.test(base)) {
    return 'Wrong handle or app password — mint a fresh one at bsky.app → Settings → App passwords.';
  }
  return base;
}

async function bjson(r: Response): Promise<any> {
  return r.json().catch(() => ({}));
}

/**
 * Bare handles ("alice") are only accepted by the resolver with the default
 * server suffix, so "alice" becomes "alice.bsky.social". Custom domains
 * (anything with a dot) and DIDs are left as typed.
 */
export function normalizeBskyHandle(identifier: string): string {
  const id = identifier.trim().replace(/^@/, '');
  if (!id) return id;
  if (id.startsWith('did:')) return id;
  if (id.includes('.')) return id;
  return `${id}.bsky.social`;
}

/**
 * Handle (or DID) → { did, pdsHost }. Most accounts resolve through the PLC
 * directory; did:web self-hosters fall back to their well-known document.
 */
export async function resolvePds(identifier: string): Promise<{ did: string; pdsHost: string }> {
  const id = normalizeBskyHandle(identifier);
  if (!id) throw new Error('Enter your Bluesky handle first.');
  let did = id;
  if (!did.startsWith('did:')) {
    const r = await fetch(`${BSKY_RESOLVE}?handle=${encodeURIComponent(id)}`);
    const j: any = await bjson(r);
    if (!j.did) throw new Error(berr(j, 'Could not find that Bluesky handle.'));
    did = String(j.did);
  }
  const pdsHost = await pdsForDid(did);
  return { did, pdsHost };
}

async function pdsForDid(did: string): Promise<string> {
  // did:plc → PLC directory
  if (did.startsWith('did:plc:')) {
    const r = await fetch(`${BSKY_PLC}/${encodeURIComponent(did)}`);
    const j: any = await bjson(r);
    const svc = (j?.service ?? []).find(
      (s: any) => s?.id === '#atproto_pds' || s?.type === 'AtprotoPersonalDataServer',
    );
    const endpoint = String(svc?.serviceEndpoint ?? '').replace(/\/+$/, '');
    if (endpoint) return endpoint;
  }
  // did:web:example.com → https://example.com/.well-known/did.json
  if (did.startsWith('did:web:')) {
    const host = did.slice(8).split(':')[0];
    try {
      const r = await fetch(`https://${host}/.well-known/did.json`);
      const j: any = await bjson(r);
      const svc = (j?.service ?? []).find(
        (s: any) => s?.id === '#atproto_pds' || s?.type === 'AtprotoPersonalDataServer',
      );
      const endpoint = String(svc?.serviceEndpoint ?? '').replace(/\/+$/, '');
      if (endpoint) return endpoint;
    } catch {}
  }
  throw new Error('Could not find that account’s server — is the handle right?');
}

export interface BskySession {
  accessJwt: string;
  refreshJwt: string;
  expiresAt: number;
  did: string;
  handle: string;
  pdsHost: string;
}

/** identifier + app password -> session on the user's own PDS. */
export async function createBskySession(identifier: string, password: string): Promise<BskySession> {
  if (!password) throw new Error('Paste the app password too.');
  const { did, pdsHost } = await resolvePds(identifier);
  const r = await fetch(`${pdsHost}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: did, password }),
  });
  const j: any = await bjson(r);
  if (!j.accessJwt) throw new Error(berr(j, 'Bluesky login failed.'));
  return {
    accessJwt: j.accessJwt as string,
    refreshJwt: (j.refreshJwt as string) ?? '',
    expiresAt: Date.now() + 110 * 60 * 1000, // access tokens live ~2h; refresh early
    did: String(j.did ?? did),
    handle: String(j.handle ?? identifier).replace(/^@/, ''),
    pdsHost,
  };
}

/** Silent mint with the long-lived refresh token. */
export async function refreshBskySession(refreshJwt: string, pdsHost: string): Promise<BskySession> {
  const r = await fetch(`${pdsHost}/xrpc/com.atproto.server.refreshSession`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${refreshJwt}` },
  });
  const j: any = await bjson(r);
  if (!j.accessJwt) throw new Error(berr(j, 'Bluesky session expired — reconnect Bluesky.'));
  const m = await loadMetaState();
  return {
    accessJwt: j.accessJwt as string,
    refreshJwt: (j.refreshJwt as string) || refreshJwt,
    expiresAt: Date.now() + 110 * 60 * 1000,
    did: String(j.did ?? m.bskyDid ?? ''),
    handle: String(j.handle ?? m.bskyHandle ?? ''),
    pdsHost,
  };
}

export interface BskyCreds {
  token: string;
  did: string;
  pdsHost: string;
}

/**
 * The single entry every Bluesky call uses. Returns a live access token plus
 * the account's DID + PDS host, refreshing 10 min before expiry.
 */
export async function getValidBsky(force = false): Promise<BskyCreds> {
  const m = await loadMetaState();
  if (!m.bskyDid || !m.bskyPdsHost) throw new Error('Bluesky not connected');
  const did = m.bskyDid;
  const pdsHost = m.bskyPdsHost;
  if (!force && m.bskyAccessJwt && m.bskyExpiresAt && m.bskyExpiresAt > Date.now() + 600000) {
    return { token: m.bskyAccessJwt, did, pdsHost };
  }
  if (!m.bskyRefreshJwt) throw new Error('Bluesky not connected');
  try {
    const s = await refreshBskySession(m.bskyRefreshJwt, pdsHost);
    await saveMetaState({
      bskyAccessJwt: s.accessJwt,
      bskyRefreshJwt: s.refreshJwt,
      bskyExpiresAt: s.expiresAt,
      bskyDid: s.did || did,
      bskyHandle: s.handle || m.bskyHandle,
      bskyPdsHost: pdsHost,
    });
    return { token: s.accessJwt, did: s.did || did, pdsHost };
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (/expired|invalid|unauthorized|bad request/i.test(msg)) {
      await saveMetaState({
        bskyAccessJwt: undefined, bskyRefreshJwt: undefined, bskyExpiresAt: undefined,
      });
      throw new Error('Bluesky session expired — reconnect Bluesky.');
    }
    throw e;
  }
}

/** Full login: handle + app password -> session, all saved to the vault. */
export async function completeBskyLogin(identifier: string, password: string): Promise<{ name?: string }> {
  const s = await createBskySession(identifier, password);
  const name = s.handle ? `@${s.handle}` : undefined;
  await saveMetaState({
    bskyAccessJwt: s.accessJwt,
    bskyRefreshJwt: s.refreshJwt || undefined,
    bskyExpiresAt: s.expiresAt,
    bskyDid: s.did,
    bskyHandle: s.handle,
    bskyName: name,
    bskyPdsHost: s.pdsHost,
  });
  return { name };
}
