-- P3 · Content pipeline: media, posts, per-channel targets, approvals, jobs
--
-- Scope: server-side replacement for ManagedPost (quickpost_managed_posts_v1)
-- + attachments + remoteIds + the client publish sweep. The device stops
-- auto-publishing: pg_cron enqueues due targets every minute, the worker
-- consumes job_queue with SKIP LOCKED (worker code lands with the Railway
-- service; this migration is the contract it programs against).
--
-- Channel-grant enforcement (who may publish where) happens in the worker/API
-- at publish time, not in RLS — RLS below governs workspace data access.
-- Prerequisite: pg_cron enabled (Dashboard → Database → Extensions, or the
-- CREATE EXTENSION below on self-hosted) before pushing, or this fails loudly.

create extension if not exists "pg_cron";

-- --------------------------------------------------------------- tables ---
-- Binary metadata; bytes live in the Storage bucket, referenced by path.
create table media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  uploaded_by uuid references profiles (id),
  storage_path text not null,
  kind text not null check (kind in ('image', 'video')),
  mime_type text,
  byte_size bigint,
  width integer,
  height integer,
  duration_ms integer,
  checksum text,
  status text not null default 'uploading'
    check (status in ('uploading', 'ready', 'failed')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index media_assets_workspace_idx on media_assets (workspace_id);

-- The post itself (title/body/schedule/state). client_id carries the old local
-- uid('post') so the one-time device migration uploads idempotently.
create table posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  created_by uuid references profiles (id),
  client_id text unique,
  title text not null default '',
  body text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'approval', 'queued', 'publishing', 'sent', 'partial', 'failed')),
  scheduled_at timestamptz,
  timezone text,
  source_design_project_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index posts_workspace_idx on posts (workspace_id);
create index posts_schedule_idx on posts (status, scheduled_at);

-- Ordered media links (replaces attachments[] order).
create table post_media (
  post_id uuid not null references posts (id) on delete cascade,
  media_id uuid not null references media_assets (id) on delete cascade,
  position integer not null default 0,
  primary key (post_id, media_id)
);

-- One row per (post, connected account): format, per-channel options,
-- publish state, provider remote id for analytics. unique(post, channel)
-- is the double-post guard — the worker upserts results against it.
create table post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  channel_id uuid not null references connected_channels (id) on delete cascade,
  provider provider_key not null,
  format text,
  caption text,
  -- threadsTopic / ttPrivacy / ytPrivacy / sourceUrl live here
  options jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'needs_approval', 'queued', 'publishing', 'sent', 'failed', 'skipped')),
  scheduled_at timestamptz,
  remote_id text,
  remote_url text,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, channel_id)
);
create index post_targets_due_idx on post_targets (status, scheduled_at);
create index post_targets_post_idx on post_targets (post_id);

-- Approval workflow for Team (PostStatus='approval' today).
create table approvals (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  requested_by uuid references profiles (id),
  decided_by uuid references profiles (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'changes_requested')),
  comment text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index approvals_post_idx on approvals (post_id);

-- Service-role only. Worker polls with FOR UPDATE SKIP LOCKED.
create table job_queue (
  id bigserial primary key,
  kind text not null
    check (kind in ('publish_target', 'refresh_token', 'snapshot_analytics', 'cleanup_media', 'send_invite')),
  payload jsonb not null default '{}',
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_queue_poll_idx on job_queue (status, run_at);

-- -------------------------------------------------------------- helpers ---
drop trigger if exists trg_posts_touch on posts;
create trigger trg_posts_touch
  before update on posts
  for each row execute function touch_updated_at();

drop trigger if exists trg_post_targets_touch on post_targets;
create trigger trg_post_targets_touch
  before update on post_targets
  for each row execute function touch_updated_at();

drop trigger if exists trg_job_queue_touch on job_queue;
create trigger trg_job_queue_touch
  before update on job_queue
  for each row execute function touch_updated_at();

-- Minutely enqueue: due queued targets become publish_target jobs.
-- Idempotent via idempotency_key — safe to run every minute.
create or replace function enqueue_due_posts()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
begin
  insert into job_queue (kind, payload, run_at, idempotency_key)
  select 'publish_target',
         jsonb_build_object('post_target_id', pt.id),
         now(),
         'publish_target:' || pt.id::text
  from post_targets pt
  join posts p on p.id = pt.post_id
  where pt.status = 'queued'
    and (pt.scheduled_at is null or pt.scheduled_at <= now())
    and (p.scheduled_at is null or p.scheduled_at <= now())
    -- draft/approval/failed posts never auto-fire; sent/partial allow retries
    and p.status in ('queued', 'publishing', 'partial', 'sent')
  on conflict (idempotency_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Re-running schedule() with the same name upserts — push-safe.
select cron.schedule('sosial-enqueue-due', '* * * * *', 'select public.enqueue_due_posts()');

-- ------------------------------------------------------------------ RLS ---
alter table media_assets enable row level security;
alter table posts enable row level security;
alter table post_media enable row level security;
alter table post_targets enable row level security;
alter table approvals enable row level security;
alter table job_queue enable row level security;

-- posts: members read + submit; edit/delete by creator or owner/admin
create policy "posts_member_read" on posts for select to authenticated
  using (is_workspace_member(workspace_id));
create policy "posts_member_create" on posts for insert to authenticated
  with check (is_workspace_member(workspace_id));
create policy "posts_creator_admin_write" on posts for update to authenticated
  using (created_by = auth.uid() or workspace_role(workspace_id) in ('owner', 'admin'))
  with check (created_by = auth.uid() or workspace_role(workspace_id) in ('owner', 'admin'));
create policy "posts_creator_admin_delete" on posts for delete to authenticated
  using (created_by = auth.uid() or workspace_role(workspace_id) in ('owner', 'admin'));

-- targets + media links: same shape, scoped through the parent post
create policy "targets_member_read" on post_targets for select to authenticated
  using (exists (select 1 from posts p where p.id = post_targets.post_id and is_workspace_member(p.workspace_id)));
create policy "targets_member_create" on post_targets for insert to authenticated
  with check (exists (select 1 from posts p where p.id = post_targets.post_id and is_workspace_member(p.workspace_id)));
create policy "targets_creator_admin_write" on post_targets for all to authenticated
  using (exists (
    select 1 from posts p
    where p.id = post_targets.post_id
      and (p.created_by = auth.uid() or workspace_role(p.workspace_id) in ('owner', 'admin'))
  ))
  with check (exists (
    select 1 from posts p
    where p.id = post_targets.post_id
      and (p.created_by = auth.uid() or workspace_role(p.workspace_id) in ('owner', 'admin'))
  ));

create policy "post_media_member_read" on post_media for select to authenticated
  using (exists (select 1 from posts p where p.id = post_media.post_id and is_workspace_member(p.workspace_id)));
create policy "post_media_member_write" on post_media for all to authenticated
  using (exists (select 1 from posts p where p.id = post_media.post_id and is_workspace_member(p.workspace_id)))
  with check (exists (select 1 from posts p where p.id = post_media.post_id and is_workspace_member(p.workspace_id)));

-- media: members read + upload; delete by uploader or owner/admin
create policy "media_member_read" on media_assets for select to authenticated
  using (is_workspace_member(workspace_id));
create policy "media_member_create" on media_assets for insert to authenticated
  with check (is_workspace_member(workspace_id));
create policy "media_uploader_admin_delete" on media_assets for delete to authenticated
  using (uploaded_by = auth.uid() or workspace_role(workspace_id) in ('owner', 'admin'));

-- approvals: members read + request; only owner/admin decide
create policy "approvals_member_read" on approvals for select to authenticated
  using (is_workspace_member(workspace_id));
create policy "approvals_member_create" on approvals for insert to authenticated
  with check (is_workspace_member(workspace_id));
create policy "approvals_owner_admin_decide" on approvals for update to authenticated
  using (workspace_role(workspace_id) in ('owner', 'admin'))
  with check (workspace_role(workspace_id) in ('owner', 'admin'));

-- job_queue: NO policies — service_role (worker) only, by design.

-- --------------------------------------------------------------- grants ---
grant select, insert, update, delete
  on posts, post_targets, post_media, media_assets, approvals
  to authenticated;
-- job_queue: no grants to authenticated (service_role bypasses RLS).
