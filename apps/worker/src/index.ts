/**
 * Main loop: claim → dispatch → complete, forever.
 * Empty queue → short idle sleep. Errors → longer sleep, loop never dies
 * (Railway restarts on crash; the loop surviving transient outages matters
 * more than exiting loudly).
 */
import { env, required } from './env';
import { initDb, claimJob, completeJob } from './db';
import { dispatch } from './dispatch';
import { info, warn, err } from './logger';

declare const process: any;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  initDb();
  // Fail fast when pointed at the wrong project — service key is per-project.
  required('WORKER_SERVICE_ROLE_KEY');
  const workerId = `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const idleMs = Number(env('WORKER_IDLE_MS', '5000')) || 5000;
  const errorMs = Number(env('WORKER_ERROR_MS', '15000')) || 15000;
  let stopped = false;
  try {
    process?.on?.('SIGTERM', () => { stopped = true; });
    process?.on?.('SIGINT', () => { stopped = true; });
  } catch { /* non-Node runtimes: loop runs until killed */ }

  info(`worker ${workerId} up (idle ${idleMs}ms, error backoff ${errorMs}ms)`);
  while (!stopped) {
    try {
      const job = await claimJob(workerId);
      if (!job) {
        await sleep(idleMs);
        continue;
      }
      info(`claimed job ${job.id} kind=${job.kind} attempt=${job.attempts}/${job.max_attempts}`);
      try {
        await dispatch(job);
        await completeJob(job.id, true);
        info(`job ${job.id} done`);
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? 'job failed');
        warn(`job ${job.id} failed: ${msg}`);
        await completeJob(job.id, false, msg);
      }
    } catch (e: any) {
      err(`loop error: ${String(e?.message ?? e)}`);
      await sleep(errorMs);
    }
  }
  info(`worker ${workerId} stopping`);
}

main().catch((e) => {
  err(`fatal: ${String(e?.message ?? e)}`);
  try { process?.exit?.(1); } catch { /* noop */ }
});
