-- P8 · Publish bundle + target terminal states (service_role only)
--
-- The worker needs everything for one target in a single round trip, and it
-- must record terminal state on post_targets (cron only enqueues 'queued'
-- targets, so without mark_target_sent a success would re-enqueue and
-- double-post). Plaintext tokens are NEVER included — the worker reads them
-- through the P4 vault_read_secret helper using the ids below.

create or replace function get_publish_bundle(target_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  out jsonb;
begin
  select jsonb_build_object(
    'target', jsonb_build_object(
      'id', pt.id, 'provider', pt.provider, 'caption', pt.caption,
      'options', pt.options, 'idempotency_key', pt.idempotency_key,
      'status', pt.status
    ),
    'post', jsonb_build_object(
      'id', p.id, 'title', p.title, 'body', p.body, 'workspace_id', p.workspace_id
    ),
    'media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'storage_path', ma.storage_path, 'kind', ma.kind,
          'mime_type', ma.mime_type, 'position', pm.position
        )
        order by pm.position
      )
      from post_media pm
      join media_assets ma on ma.id = pm.media_id
      where pm.post_id = p.id
    ), '[]'::jsonb),
    'channel', jsonb_build_object(
      'id', cc.id, 'provider', cc.provider, 'external_id', cc.external_id,
      'instance_url', cc.instance_url, 'metadata', cc.metadata
    ),
    'secrets', jsonb_build_object(
      'access_secret_id', ct.access_token_secret_id,
      'refresh_secret_id', ct.refresh_token_secret_id,
      'expires_at', ct.expires_at
    )
  )
  into out
  from post_targets pt
  join posts p on p.id = pt.post_id
  join connected_channels cc on cc.id = pt.channel_id
  left join channel_tokens ct on ct.channel_id = cc.id
  where pt.id = target_id;
  return out;
end $$;

create or replace function mark_target_sent(target_id uuid, remote_id text, remote_url text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update post_targets
  set status = 'sent', remote_id = mark_target_sent.remote_id,
      remote_url = mark_target_sent.remote_url,
      sent_at = now(), attempts = attempts + 1, last_error = null,
      updated_at = now()
  where id = target_id;
end $$;

create or replace function mark_target_failed(target_id uuid, err text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update post_targets
  set status = 'failed', last_error = err,
      attempts = attempts + 1, updated_at = now()
  where id = target_id;
end $$;

revoke all on function get_publish_bundle(uuid) from public, anon, authenticated;
revoke all on function mark_target_sent(uuid, text, text) from public, anon, authenticated;
revoke all on function mark_target_failed(uuid, text) from public, anon, authenticated;

grant execute on function get_publish_bundle(uuid) to service_role;
grant execute on function mark_target_sent(uuid, text, text) to service_role;
grant execute on function mark_target_failed(uuid, text) to service_role;
