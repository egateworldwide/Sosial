/**
 * Job dispatch by kind. Handlers are stubs in this scaffold — each one gets
 * its real implementation (ported publisher adapters, refresh logic,
 * analytics snapshots) in the next slice. A stub throws, which routes the
 * job to backoff/dead-letter via complete_job — never a silent success.
 */
import type { Job } from './db';
import { info } from './logger';

function notPorted(kind: string): Error {
  return new Error(`job kind '${kind}' not ported yet — see apps/worker/README.md`);
}

async function handlePublishTarget(job: Job): Promise<void> {
  const targetId = job.payload?.post_target_id;
  info(`publish_target ${targetId} (job ${job.id})`);
  throw notPorted('publish_target');
}

async function handleRefreshToken(job: Job): Promise<void> {
  info(`refresh_token channel ${job.payload?.channel_id} (job ${job.id})`);
  throw notPorted('refresh_token');
}

async function handleSnapshotAnalytics(job: Job): Promise<void> {
  info(`snapshot_analytics channel ${job.payload?.channel_id} (job ${job.id})`);
  throw notPorted('snapshot_analytics');
}

async function handleCleanupMedia(job: Job): Promise<void> {
  info(`cleanup_media (job ${job.id})`);
  throw notPorted('cleanup_media');
}

async function handleSendInvite(job: Job): Promise<void> {
  info(`send_invite ${job.payload?.invite_id} (job ${job.id})`);
  throw notPorted('send_invite');
}

export async function dispatch(job: Job): Promise<void> {
  switch (job.kind) {
    case 'publish_target': return handlePublishTarget(job);
    case 'refresh_token': return handleRefreshToken(job);
    case 'snapshot_analytics': return handleSnapshotAnalytics(job);
    case 'cleanup_media': return handleCleanupMedia(job);
    case 'send_invite': return handleSendInvite(job);
    default: throw new Error(`unknown job kind '${String((job as any)?.kind)}' (job ${job.id})`);
  }
}
