# Supabase backend

Migrations + setup for the Sosial cloud backend. Milestone A first.

## Projects

Two projects: `sosial-staging` and `sosial-prod`. Never point the mobile
`.env` at prod during development.

## Setup (one time per machine)

```powershell
npm i -g supabase
supabase login
cd C:\Users\user\Desktop\TikTokPost
supabase init      # generates supabase/config.toml (gitignored upstream template)
supabase link --project-ref <staging-ref>
```

## Apply migrations

```powershell
supabase db push          # staging
supabase db push --linked # after linking prod, promote the same files
```

Migrations are versioned and never edited after push — new change, new file.

## Files

- `migrations/20260917000000_p1_identity_tenancy.sql` — P1: enums
  (`provider_key`, `team_role`, `member_status`), `profiles`, `workspaces`,
  `workspace_members`, `member_channel_grants` (provider-level; per-account
  grants arrive in P2), `invites`, `is_workspace_member()` /
  `workspace_role()` helpers, `handle_new_user()` trigger, full RLS.
- `migrations/20260917000001_p2_channels_tokens.sql` — P2:
  `connected_channels` (multi-account native, IG/Threads parented to the FB
  Page), `channel_tokens` + `oauth_states` (**no RLS policies — service_role
  only**), `member_account_grants`, `touch_updated_at()` trigger.
- `migrations/20260917000002_p3_content_jobs.sql` — P3: `media_assets`,
  `posts` (+ `client_id` for the one-time device migration), `post_media`,
  `post_targets` (unique `(post_id, channel_id)` = double-post guard),
  `approvals`, `job_queue` (**no policies — service_role only**),
  `enqueue_due_posts()` + per-minute `pg_cron` schedule. Requires pg_cron
  enabled (Dashboard → Database → Extensions) before pushing, or the push
  fails loudly at the `cron.schedule` call.
- `migrations/20260917000003_p3_worker_rpc.sql` — P3b: `claim_job()` /
  `complete_job()` RPCs — the only queue access path for the Railway worker
  (no pg driver; SKIP LOCKED in SQL). Consumed by `apps/worker`.
- `migrations/20260917000004_p4_token_vault.sql` — P4: enables Vault +
  `vault_create/read/update/delete_secret()` helpers (**service_role only**,
  SECURITY DEFINER). Channel-token ciphertext lives here; clients only ever
  see secret ids.
- `migrations/20260917000005_p5_media_storage.sql` — P5: private
  `post-media` bucket, workspace-scoped `storage.objects` policies
  (`<workspace_id>/…` paths), `purge_expired_media()` row sweeper
  (service_role only; bytes swept by the worker janitor).
- `migrations/20260917000006_p6_service_role_grants.sql` — P6: `GRANT ALL`
  on all public tables/sequences to service_role + default privileges for
  future tables. Without this, Edge Functions and worker direct reads fail
  with "permission denied" (RLS bypass ≠ table privileges).
- `functions/import-channel-token` — opt-in device→Vault bridge (JWT auth,
  membership gate, metadata passthrough, IG/Threads parenting).
- `functions/remove-channel-token` — opt-out/disconnect cleanup (idempotent,
  deletes Vault secrets).

## RLS testing

Every table with `workspace_id` must deny anonymous access and cross-workspace
access. Test with two staging users in different workspaces:

```sql
-- as user A: must return rows; as user B (other workspace): must return none
select * from workspaces;
select * from workspace_members;
```

`channel_tokens` / `oauth_states` / `job_queue` (P2/P3) get **no policies at
all** — service_role only.

## Vault (needed for P2)

Enable Vault once per project (Dashboard → Database → Vault, or SQL):

```sql
create extension if not exists "supabase_vault" with schema "vault";
```

Token tables store Vault secret ids, never ciphertext the client can read.
