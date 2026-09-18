/**
 * Supabase access over HTTPS (PostgREST + RPC) with the service_role key.
 * No pg driver — SKIP LOCKED lives inside the claim_job RPC, so this stays
 * a plain Node fetch client that Railway can run anywhere.
 */
import { required } from './env';

export interface Job {
  id: number;
  kind: 'publish_target' | 'refresh_token' | 'snapshot_analytics' | 'cleanup_media' | 'send_invite';
  payload: Record<string, any>;
  status: string;
  run_at: string;
  attempts: number;
  max_attempts: number;
}

let base = '';
let key = '';

export function initDb(): void {
  base = required('WORKER_SUPABASE_URL').replace(/\/+$/, '');
  key = required('WORKER_SERVICE_ROLE_KEY');
}

/** POST /rest/v1/rpc/{fn} with service_role auth. */
async function rpc<T>(fn: string, args: Record<string, any>): Promise<T> {
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`rpc ${fn} failed (${r.status}): ${t.slice(0, 200)}`);
  }
  return (await r.json().catch(() => null)) as T;
}

/** Oldest due queued job, marked running — null when the queue is empty. */
export function claimJob(workerId: string): Promise<Job | null> {
  return rpc<Job | null>('claim_job', { worker_id: workerId });
}

/** ok=true → done; else requeue with backoff, or dead when attempts run out. */
export function completeJob(jobId: number, ok: boolean, error?: string): Promise<void> {
  return rpc<void>('complete_job', { job_id: jobId, ok, err: error ?? null });
}
