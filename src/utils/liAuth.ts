import { LI_CLIENT_ID, LI_CLIENT_SECRET, LI_AUTH_ENDPOINT, LI_TOKEN_ENDPOINT, LI_API, LI_SCOPES, LI_VERSION } from './liConfig';
import { BRIDGE_URL, appReturnUrl, openAuth } from './metaAuth';
import { loadMetaState, saveMetaState } from './metaStore';

/** LinkedIn errors look like { error, error_description } or { message, status }. */
function lerr(j: any, fallback: string): string {
  const m = j?.error_description || (typeof j?.error === 'string' ? j.error : undefined) || j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (/redirect_uri|client_id|unauthorized/i.test(base)) {
    return `${base} — check the Client ID/Secret in liConfig.ts and the redirect URL in the LinkedIn portal.`;
  }
  return base;
}

function qs(p: Record<string, string>): string {
  return Object.entries(p)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/* ---------------- Login (same bridge page as the other OAuth channels) ---------------- */

export async function loginLinkedIn(): Promise<boolean> {
  const url =
    `${LI_AUTH_ENDPOINT}?response_type=code` +
    `&client_id=${encodeURIComponent(LI_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(BRIDGE_URL)}` +
    `&scope=${encodeURIComponent(LI_SCOPES.join(' '))}` +
    `&state=${encodeURIComponent(appReturnUrl())}`;
  return openAuth(url, 'linkedin');
}

export interface LiTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** code -> ~60-day access token (+ refresh token when issued). */
export async function exchangeLiCode(code: string): Promise<LiTokens> {
  const r = await fetch(LI_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({
      grant_type: 'authorization_code',
      code,
      client_id: LI_CLIENT_ID,
      client_secret: LI_CLIENT_SECRET,
      redirect_uri: BRIDGE_URL,
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(lerr(j, 'LinkedIn login exchange failed.'));
  return {
    accessToken: j.access_token as string,
    refreshToken: (j.refresh_token as string) ?? '',
    expiresAt: Date.now() + Number(j.expires_in ?? 5184000) * 1000,
  };
}

/** Silent mint — LinkedIn rotates the refresh token on use. */
export async function refreshLiToken(refreshToken: string): Promise<LiTokens> {
  const r = await fetch(LI_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: LI_CLIENT_ID,
      client_secret: LI_CLIENT_SECRET,
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(lerr(j, 'LinkedIn session expired — reconnect LinkedIn.'));
  return {
    accessToken: j.access_token as string,
    refreshToken: (j.refresh_token as string) || refreshToken,
    expiresAt: Date.now() + Number(j.expires_in ?? 5184000) * 1000,
  };
}

/**
 * The single entry every LinkedIn call uses. Returns a live access token plus
 * the member URN, refreshing 10 min before expiry.
 */
export async function getValidLi(): Promise<{ token: string; personUrn: string }> {
  const m = await loadMetaState();
  if (!m.liPersonUrn) throw new Error('LinkedIn not connected');
  if (m.liAccessToken && m.liExpiresAt && m.liExpiresAt > Date.now() + 600000) {
    return { token: m.liAccessToken, personUrn: m.liPersonUrn };
  }
  if (!m.liRefreshToken) throw new Error('LinkedIn session expired — reconnect LinkedIn.');
  try {
    const t = await refreshLiToken(m.liRefreshToken);
    await saveMetaState({
      liAccessToken: t.accessToken,
      liRefreshToken: t.refreshToken,
      liExpiresAt: t.expiresAt,
    });
    return { token: t.accessToken, personUrn: m.liPersonUrn };
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (/invalid_grant|invalid_request|expired|unauthorized/i.test(msg)) {
      await saveMetaState({ liAccessToken: undefined, liRefreshToken: undefined, liExpiresAt: undefined });
      throw new Error('LinkedIn session expired — reconnect LinkedIn.');
    }
    throw e;
  }
}

/** OpenID userinfo → person URN + display name. */
export async function fetchLiProfile(token: string): Promise<{ urn: string; name?: string }> {
  const r = await fetch(`${LI_API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.sub) throw new Error(lerr(j, 'Could not read your LinkedIn profile.'));
  const given = String(j.given_name ?? '');
  const family = String(j.family_name ?? '');
  const full = `${given} ${family}`.trim();
  return { urn: `urn:li:person:${j.sub}`, name: full ? `@${full}` : undefined };
}

/** Full login: code -> tokens -> profile, all saved to the vault. */
export async function completeLiLogin(code: string): Promise<{ name?: string }> {
  const t = await exchangeLiCode(code);
  const prof = await fetchLiProfile(t.accessToken);
  await saveMetaState({
    liAccessToken: t.accessToken,
    liRefreshToken: t.refreshToken || undefined,
    liExpiresAt: t.expiresAt,
    liPersonUrn: prof.urn,
    liName: prof.name,
  });
  return { name: prof.name };
}

/* ---------------- Company Pages you admin ---------------- */

export interface LiOrg {
  /** numeric org id, e.g. '12345' */
  id: string;
  name: string;
  /** urn:li:organization:{id} — the author value for org posts */
  urn: string;
}

function liHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': LI_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

/**
 * Company Pages the member administers, via organizational entity ACLs.
 * Needs r_organization_social (Marketing Developer Platform product) — without
 * it LinkedIn 403s and callers fall back to member-only with an honest note.
 */
export async function fetchLiOrgs(token: string): Promise<LiOrg[]> {
  const r = await fetch(
    `${LI_API}/rest/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50`,
    { headers: liHeaders(token) },
  );
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof j?.message === 'string' && j.message ? j.message : 'Could not list your Company Pages.';
    if (r.status === 401) throw new Error('LinkedIn session expired — reconnect LinkedIn.');
    if (r.status === 403) {
      throw new Error('LinkedIn blocked the Page list — add the “Marketing Developer Platform” product in the portal and reconnect.');
    }
    throw new Error(msg);
  }
  const targets: string[] = (Array.isArray(j?.elements) ? j.elements : [])
    .map((e: any) => String(e?.organizationalTarget ?? ''))
    .filter((u: string) => u.startsWith('urn:li:organization:'));
  const ids = [...new Set(targets.map((u) => u.split(':').pop() ?? ''))].filter(Boolean).slice(0, 20);
  const orgs = await Promise.all(
    ids.map(async (id) => {
      try {
        const or = await fetch(`${LI_API}/rest/organizations/${id}`, { headers: liHeaders(token) });
        const oj: any = await or.json().catch(() => ({}));
        const name = String(oj?.localizedName ?? oj?.vanityName ?? `Page ${id}`);
        return { id, name, urn: `urn:li:organization:${id}` };
      } catch {
        return { id, name: `Page ${id}`, urn: `urn:li:organization:${id}` };
      }
    }),
  );
  return orgs;
}

/** Pick a Company Page to post/analyze as (pass null for "just me"). */
export async function pickLiOrg(org: LiOrg | null): Promise<void> {
  await saveMetaState({
    liOrgId: org?.id,
    liOrgName: org?.name,
  });
}

/** My admin orgs with a fresh token — what the Connect picker calls. */
export async function listMyLiOrgs(): Promise<LiOrg[]> {
  const { token } = await getValidLi();
  return fetchLiOrgs(token);
}

/** Post author: picked org URN, else the member URN. */
export function liAuthorUrn(m: { liOrgId?: string; liPersonUrn?: string }): string {
  if (m.liOrgId) return `urn:li:organization:${m.liOrgId}`;
  return m.liPersonUrn ?? '';
}
