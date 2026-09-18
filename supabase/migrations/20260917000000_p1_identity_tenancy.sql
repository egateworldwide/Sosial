-- P1 · Identity + tenancy (profiles, workspaces, members, grants, invites)
--
-- Scope: auth identity, workspace tenancy, server RBAC foundation.
-- Tokens/channels land in P2, posts/jobs in P3.
--
-- Conventions:
--  * every tenant table carries workspace_id -> uniform RLS boundary
--  * is_workspace_member() / workspace_role() are SECURITY DEFINER so RLS
--    policies never recurse
--  * member_channel_grants are PROVIDER-level in P1. P2 adds per-account
--    grants (member_account_grants -> connected_channels) for multi-account
--    workspaces. Resolution rule: all_channels OR provider grant OR account
--    grant. all_channels=true (today's ['all']) bypasses grant checks.

-- pgcrypto for gen_random_uuid (present on Supabase; harmless if already on)
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums ---
create type provider_key as enum (
  'facebook', 'instagram', 'threads', 'tiktok', 'x',
  'bluesky', 'linkedin', 'mastodon', 'pinterest', 'youtube'
);

create type team_role as enum ('owner', 'admin', 'member');

create type member_status as enum ('invited', 'active', 'removed');

-- --------------------------------------------------------------- tables ---
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  notif_posts boolean not null default true,
  notif_comments boolean not null default true,
  notif_weekly boolean not null default false,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My team',
  owner_id uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid references profiles (id) on delete cascade,
  email text not null,
  role team_role not null default 'member',
  status member_status not null default 'invited',
  all_channels boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create table member_channel_grants (
  member_id uuid not null references workspace_members (id) on delete cascade,
  provider provider_key not null,
  primary key (member_id, provider)
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  email text not null,
  role team_role not null default 'member',
  all_channels boolean not null default false,
  token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null default now() + interval '7 days',
  invited_by uuid references profiles (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_workspace_idx on invites (workspace_id);
create index invites_token_idx on invites (token);

-- -------------------------------------------------------------- helpers ---
create or replace function is_workspace_member(w_id uuid)
returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = w_id and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function workspace_role(w_id uuid)
returns team_role
language sql security definer set search_path = public stable as $$
  select role from workspace_members
  where workspace_id = w_id and user_id = auth.uid() and status = 'active'
  limit 1;
$$;

-- auto-create a profile row on signup (service-side; bypasses RLS)
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------------ RLS ---
alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table member_channel_grants enable row level security;
alter table invites enable row level security;

-- profiles: self full access; teammates can read each other (team UI needs names)
create policy "profiles_self_all" on profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_teammates_read" on profiles for select to authenticated
  using (exists (
    select 1 from workspace_members m1
    join workspace_members m2 on m1.workspace_id = m2.workspace_id
    where m1.user_id = auth.uid() and m1.status = 'active'
      and m2.user_id = profiles.id and m2.status = 'active'
  ));

-- workspaces: members read; owner creates; owner/admin renames; owner deletes
create policy "workspaces_member_read" on workspaces for select to authenticated
  using (owner_id = auth.uid() or is_workspace_member(id));
create policy "workspaces_owner_create" on workspaces for insert to authenticated
  with check (owner_id = auth.uid());
create policy "workspaces_owner_admin_update" on workspaces for update to authenticated
  using (owner_id = auth.uid() or workspace_role(id) in ('owner', 'admin'))
  with check (owner_id = auth.uid() or workspace_role(id) in ('owner', 'admin'));
create policy "workspaces_owner_delete" on workspaces for delete to authenticated
  using (owner_id = auth.uid());

-- members: members read; owner/admin manage.
-- The workspace owner bootstraps the first (owner) row, so creation also
-- allows the workspace owner before any membership exists.
create policy "members_member_read" on workspace_members for select to authenticated
  using (is_workspace_member(workspace_id));
create policy "members_owner_admin_write" on workspace_members for all to authenticated
  using (
    workspace_role(workspace_id) in ('owner', 'admin')
    or workspace_id in (select id from workspaces where owner_id = auth.uid())
  )
  with check (
    workspace_role(workspace_id) in ('owner', 'admin')
    or workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

-- grants: visible to workspace members; managed by owner/admin
create policy "grants_member_read" on member_channel_grants for select to authenticated
  using (exists (
    select 1 from workspace_members m
    where m.id = member_channel_grants.member_id and is_workspace_member(m.workspace_id)
  ));
create policy "grants_owner_admin_write" on member_channel_grants for all to authenticated
  using (exists (
    select 1 from workspace_members m
    where m.id = member_channel_grants.member_id
      and (workspace_role(m.workspace_id) in ('owner', 'admin')
        or m.workspace_id in (select id from workspaces where owner_id = auth.uid()))
  ))
  with check (exists (
    select 1 from workspace_members m
    where m.id = member_channel_grants.member_id
      and (workspace_role(m.workspace_id) in ('owner', 'admin')
        or m.workspace_id in (select id from workspaces where owner_id = auth.uid()))
  ));

-- invites: members read; owner/admin manage
create policy "invites_member_read" on invites for select to authenticated
  using (is_workspace_member(workspace_id));
create policy "invites_owner_admin_write" on invites for all to authenticated
  using (
    workspace_role(workspace_id) in ('owner', 'admin')
    or workspace_id in (select id from workspaces where owner_id = auth.uid())
  )
  with check (
    workspace_role(workspace_id) in ('owner', 'admin')
    or workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

-- --------------------------------------------------------------- grants ---
grant select, insert, update, delete
  on profiles, workspaces, workspace_members, member_channel_grants, invites
  to authenticated;
