-- P5 · Media Storage bucket + workspace-scoped object policies
--
-- Scope: the bytes behind P3's media_assets rows. Bucket is PRIVATE — the app
-- uploads via signed URLs / authenticated client, the worker reads with the
-- service key (bypasses RLS). Path convention (enforced by policy):
--   post-media/<workspace_id>/<asset_id>/<filename>
-- so workspace isolation holds even at the object layer.
--
-- Plan storage quotas (entitlements.storageBytes) are enforced in the app and
-- worker, not here — SQL has no notion of plan.

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------- path helper ---
-- First path segment must be the workspace uuid the caller belongs to.
create or replace function storage_workspace_id(obj_name text)
returns uuid
language plpgsql set search_path = public as $$
begin
  return split_part(obj_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

-- ----------------------------------------------------------------- policies ---
-- (storage.objects already has RLS enabled on hosted Supabase; these are
-- additive. Service_role bypasses all of them by design.)

drop policy if exists "media_obj_member_read" on storage.objects;
create policy "media_obj_member_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and is_workspace_member(storage_workspace_id(name))
  );

drop policy if exists "media_obj_member_insert" on storage.objects;
create policy "media_obj_member_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and is_workspace_member(storage_workspace_id(name))
  );

drop policy if exists "media_obj_uploader_admin_write" on storage.objects;
create policy "media_obj_uploader_admin_write" on storage.objects for update to authenticated
  using (
    bucket_id = 'post-media'
    and (
      workspace_role(storage_workspace_id(name)) in ('owner', 'admin')
      or owner = auth.uid()
    )
  )
  with check (
    bucket_id = 'post-media'
    and (
      workspace_role(storage_workspace_id(name)) in ('owner', 'admin')
      or owner = auth.uid()
    )
  );

drop policy if exists "media_obj_uploader_admin_delete" on storage.objects;
create policy "media_obj_uploader_admin_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-media'
    and (
      workspace_role(storage_workspace_id(name)) in ('owner', 'admin')
      or owner = auth.uid()
    )
  );

-- ------------------------------------------------------- expiry row sweeper ---
-- Deletes expired media_assets ROWS (past expires_at). Object bytes are swept
-- by the worker janitor (storage API), which lists the same prefix — row
-- deletion never orphans unreferenced bytes because the janitor keys off
-- storage_path, not row existence.
create or replace function purge_expired_media()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from media_assets
   where expires_at is not null and expires_at < now() and status <> 'ready';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function purge_expired_media() from public, anon, authenticated;
grant execute on function purge_expired_media() to service_role;
