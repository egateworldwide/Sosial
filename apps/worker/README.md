# sosial-worker

Long-running publish worker (Railway). Claims jobs from Supabase `job_queue`
via the `claim_job` / `complete_job` RPCs (see
`supabase/migrations/20260917000003_p3_worker_rpc.sql`) and runs them.

Dependency-free: plain Node 18+ `fetch`, no pg driver, no framework.
SKIP LOCKED lives in SQL so multiple replicas never double-claim.

## Run locally

```powershell
Copy-Item apps/worker/.env.example apps/worker/.env  # fill staging values
npm run build --prefix apps/worker   # or: npx tsc -p apps/worker
node apps/worker/dist/index.js
```

`npm run typecheck --prefix apps/worker` must stay clean.

## Contract (frozen by the P2/P3 migrations)

- `claim_job(worker_id)` → oldest due `queued` job as `running`, else null.
- `complete_job(job_id, ok, err)` → `done`, or requeue with exponential
  backoff (`dead` when attempts run out).
- `enqueue_due_posts()` (pg_cron, every minute) feeds `publish_target` jobs
  with `idempotency_key = 'publish_target:<target_id>'`.
- `unique(post_targets.post_id, channel_id)` is the double-post guard.

## Next slice (not this scaffold)

Port the publisher adapters (`metaPublish`, `tiktokPublish`, `xPublish`,
`bskyPublish`, `mastodonPublish`, `liPublish`, `ytPublish`, `pinPublish`) and
the `getValid*` refresh logic server-side, then implement each `dispatch`
handler. Stubs throw by design — a job must never complete without doing
its work.

## Deploy (Railway, when ready)

New service from `apps/worker`, start command `node dist/index.js`
(run `npm run build` first or as the build command), env:
`WORKER_SUPABASE_URL` + `WORKER_SERVICE_ROLE_KEY` from the **staging**
project. Service-role key never leaves the server.
