/**
 * Direct PostgREST + Storage access with the service_role key (P6 grants).
 * Used for worker-owned writes the RPCs don't cover: token rotation updates
 * and private-bucket media downloads.
 */
import { required } from './env';

function base(): string {
  return required('WORKER_SUPABASE_URL').replace(/\/+$/, '');
}

function key(): string {
  return required('WORKER_SERVICE_ROLE_KEY');
}

async function fail(r: globalThis.Response, what: string): Promise<never> {
  const t = await r.text().catch(() => '');
  throw new Error(`${what} (${r.status}): ${t.slice(0, 200)}`);
}

/** PATCH one row by primary key (service_role bypasses RLS; P6 granted DML). */
export async function restPatch(table: string, id: string | number, body: Record<string, any>): Promise<void> {
  const r = await fetch(`${base()}/rest/v1/${table}?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) await fail(r, `patch ${table}`);
}

/** Short-lived download URL for a private-bucket object. */
export async function storageSign(bucket: string, path: string, expiresIn = 300): Promise<string> {
  const r = await fetch(`${base()}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!r.ok) await fail(r, 'storage sign');
  const j: any = await r.json().catch(() => ({}));
  const signed = String(j?.signedURL ?? '');
  if (!signed) throw new Error('storage sign returned no URL');
  return `${base()}/storage/v1${signed}`;
}

/** Download bytes (cap 25 MB — publish adapters reject oversize earlier). */
export async function storageDownload(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) await fail(r, 'media download');
  const ab = await r.arrayBuffer();
  if (ab.byteLength > 25 * 1024 * 1024) throw new Error('media file over 25 MB');
  return Buffer.from(ab);
}
