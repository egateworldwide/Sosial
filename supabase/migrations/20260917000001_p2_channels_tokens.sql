-- P2 · Connected channels, token vault refs, OAuth states, per-account grants
--
-- Scope: server-side replacement for MetaState (zap_meta_v1) + the OAuth
-- in-flight scratch keys (sosial_pending_auth_v1, sosial_x_verifier_v1,
-- sosial_mastodon_pending_v1). Multi-account per provider is native: one
-- connected_channels row per connected account (IG/Threads rows point at
-- their FB Page via parent_id; Bluesky rows carry the PDS in instance_url).
--
-- SECURITY: channel_tokens + oauth_states have RLS enabled with NO policies —
-- only service_role (Edge Functions + worker) can touch them. Tokens themselves
-- live in Supabase Vault; these tables store secret ids, never ciphertext the
-- client can read. (Enable Vault per supabase/README.md before P2 code runs.)

-- --------------------------------------------------------------- tables ---
create table connected_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  connected_by uuid references profiles (id),
  provider provider_key not null,
  -- provider-side account id: pageId / igId / ttOpenId / xUserId / bskyDid /
  -- liPersonUrn or urn:li:organization:{id} / mastodonAccountId / pinUsername /
  -- yt channel id. Together with provider: the dedupe key per workspace.
  external_id text not null,
  display_name text,
  handle text,
  -- mastodon instance / bsky PDS host / anything provider-specific addressing
  instance_url text,
  -- IG + Threads rows point at their FB Page row; null otherwise
  parent_id uuid references connected_channels (id) on delete set null,
  scopes text[] not null default '{}',
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'revoked', 'error')),
  last_error text,
  -- non-secret extras: pinBoardId/pinBoardName, ttLastPrivacy, ytPrivacy
  -- defaults, liOrg selection mirror — never tokens
  metadata jsonb not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);
create index connected_channels_workspace_idx on connected_channels (workspace_id);

-- Service-role only. One row per channel; secret ids point at vault.secrets.
create table channel_tokens (
  channel_id uuid primary key references connected_channels (id) on delete cascade,
  access_token_secret_id uuid,
  refresh_token_secret_id uuid,
  token_type text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  scopes text[] not null default '{}',
  rotation_counter integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Service-role only. Replaces the device OAuth scratch keys (pending channel,
-- X PKCE verifier, Mastodon per-instance client creds) + CSRF state.
create table oauth_states (
  state text primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid references profiles (id) on delete cascade,
  provider provider_key not null,
  code_verifier_secret_id uuid,
  redirect_target text,
  -- e.g. { instance, clientId, clientSecretSecretId } for Mastodon
  pending jsonb not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz
);
create index oauth_states_expires_idx on oauth_states (expires_at);

-- Per-account member grants (P1 has provider-level member_channel_grants).
-- Resolution rule: all_channels OR provider grant OR account grant.
create table member_account_grants (
  member_id uuid not null references workspace_members (id) on delete cascade,
  channel_id uuid not null references connected_channels (id) on delete cascade,
  primary key (member_id, channel_id)
);

-- -------------------------------------------------------------- helpers ---
create or replace function touch_updated_at()
returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_connected_channels_touch on connected_channels;
create trigger trg_connected_channels_touch
  before update on connected_channels
  for each row execute function touch_updated_at();

drop trigger if exists trg_channel_tokens_touch on channel_tokens;
create trigger trg_channel_tokens_touch
  before update on channel_tokens
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------------ RLS ---
alter table connected_channels enable row level security;
alter table channel_tokens enable row level security;
alter table oauth_states enable row level security;
alter table member_account_grants enable row level security;

-- channels: members read; owner/admin manage (same shape as P1 members policy)
create policy "channels_member_read" on connected_channels for select to authenticated
  using (is_workspace_member(workspace_id));
create policy "channels_owner_admin_write" on connected_channels for all to authenticated
  using (
    workspace_role(workspace_id) in ('owner', 'admin')
    or workspace_id in (select id from workspaces where owner_id = auth.uid())
  )
  with check (
    workspace_role(workspace_id) in ('owner', 'admin')
    or workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

-- tokens + oauth states: NO policies — service_role only, by design.
-- (A table with RLS enabled and zero policies denies authenticated + anon.)

-- account grants: mirror the P1 provider-grant policies
create policy "acct_grants_member_read" on member_account_grants for select to authenticated
  using (exists (
    select 1 from workspace_members m
    where m.id = member_account_grants.member_id and is_workspace_member(m.workspace_id)
  ));
create policy "acct_grants_owner_admin_write" on member_account_grants for all to authenticated
  using (exists (
    select 1 from workspace_members m
    where m.id = member_account_grants.member_id
      and (workspace_role(m.workspace_id) in ('owner', 'admin')
        or m.workspace_id in (select id from workspaces where owner_id = auth.uid()))
  ))
  with check (exists (
    select 1 from workspace_members m
    where m.id = member_account_grants.member_id
      and (workspace_role(m.workspace_id) in ('owner', 'admin')
        or m.workspace_id in (select id from workspaces where owner_id = auth.uid()))
  ));

-- --------------------------------------------------------------- grants ---
grant select, insert, update, delete
  on connected_channels, member_account_grants
  to authenticated;
-- channel_tokens + oauth_states: no grants to authenticated (service_role bypasses RLS).
