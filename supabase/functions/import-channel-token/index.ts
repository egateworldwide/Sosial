// import-channel-token · device → Vault bridge (opt-in cloud publishing)
//
// Why this exists: channel_tokens has NO RLS policies (service_role only, by
// design) and Vault helpers are service_role-only. The app's anon key can
// never write tokens directly — it calls this function with the user's JWT,
// and the function enforces workspace membership before touching secrets.
//
// POST { workspace_id, provider, external_id, display_name?, handle?,
//        instance_url?, scopes?[], metadata?{}, access_token, refresh_token?,
//        token_type?, expires_at?, refresh_expires_at? }
// → 200 { channel_id } · 401 unauthenticated · 403 not a member · 400 bad body

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROVIDERS = new Set([
  "facebook", "instagram", "threads", "tiktok", "x",
  "bluesky", "linkedin", "mastodon", "pinterest", "youtube",
]);

function bad(msg: string, status = 400): Response {
  return Response.json({ error: msg }, { status });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return bad("POST only", 405);

  // Env fallbacks: newer projects inject SB_* instead of SUPABASE_*.
  const supaUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SB_PUBLISHABLE_KEY") ?? "";
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SECRET_KEY") ?? "";
  if (!supaUrl || !anonKey || !serviceKey) {
    return bad("Function misconfigured — missing Supabase env.", 500);
  }

  // Caller identity from their own JWT (never trust a body user_id).
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return bad("Sign in first.", 401);
  const userClient = createClient(supaUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: ud, error: uErr } = await userClient.auth.getUser();
  const user = ud?.user;
  if (uErr || !user) return bad("Sign in first.", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Body must be JSON.");
  }
  const workspace_id = body["workspace_id"];
  const provider = body["provider"];
  const external_id = body["external_id"];
  const access_token = body["access_token"];
  if (typeof workspace_id !== "string" || !workspace_id) return bad("workspace_id required.");
  if (typeof provider !== "string" || !PROVIDERS.has(provider)) return bad("Unknown provider.");
  if (typeof external_id !== "string" || !external_id) return bad("external_id required.");
  if (typeof access_token !== "string" || !access_token) return bad("access_token required.");
  const refresh_token = typeof body["refresh_token"] === "string" ? body["refresh_token"] : null;
  const metadata =
    body["metadata"] && typeof body["metadata"] === "object" && !Array.isArray(body["metadata"])
      ? (body["metadata"] as Record<string, unknown>)
      : {};

  const admin = createClient(supaUrl, serviceKey);

  // Membership gate: active member of THIS workspace (service client bypasses
  // RLS, so this check is the entire authorization — never skip it).
  const { data: mem } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!mem) return bad("Not a member of this workspace.", 403);

  // Re-import hygiene: clear canonical names FIRST (Vault enforces unique
  // names). By-name (not by previous row) so orphan secrets from any failed
  // removal can never collide. If creation fails after this, the channel is
  // left secret-less and a retry heals it.
  const tag = `ch/${workspace_id}/${provider}/${external_id}`;
  for (const n of [`${tag}/access`, `${tag}/refresh`]) {
    await admin.rpc("vault_delete_secret_by_name", { secret_name: n });
  }

  // Secrets (ids only ever stored, ciphertext never leaves Vault).
  const { data: accessId, error: aErr } = await admin.rpc("vault_create_secret", {
    secret: access_token,
    secret_name: `${tag}/access`,
    secret_description: "channel access token (Sosial cloud publishing)",
  });
  // TEMP DEBUG: raw Vault error surfaced until re-import is proven.
  if (aErr || !accessId) {
    return bad(`Could not store the access token [${aErr?.message ?? "no id returned"}].`, 500);
  }

  let refreshId: string | null = null;
  if (refresh_token) {
    const { data: rid, error: rErr } = await admin.rpc("vault_create_secret", {
      secret: refresh_token,
      secret_name: `${tag}/refresh`,
      secret_description: "channel refresh token (Sosial cloud publishing)",
    });
    if (rErr || !rid) {
      await admin.rpc("vault_delete_secret", { secret_id: accessId });
      return bad("Could not store the refresh token.", 500);
    }
    refreshId = rid as string;
  }

  // Channel row (idempotent per workspace+provider+account).
  const { data: ch, error: cErr } = await admin
    .from("connected_channels")
    .upsert(
      {
        workspace_id,
        connected_by: user.id,
        provider,
        external_id,
        display_name: typeof body["display_name"] === "string" ? body["display_name"] : null,
        handle: typeof body["handle"] === "string" ? body["handle"] : null,
        instance_url: typeof body["instance_url"] === "string" ? body["instance_url"] : null,
        scopes: Array.isArray(body["scopes"]) ? body["scopes"] : [],
        status: "connected",
        metadata: metadata as never,
      },
      { onConflict: "workspace_id,provider,external_id" },
    )
    .select("id")
    .single();
  if (cErr || !ch) {
    await admin.rpc("vault_delete_secret", { secret_id: accessId });
    if (refreshId) await admin.rpc("vault_delete_secret", { secret_id: refreshId });
    return bad("Could not register the channel.", 500);
  }

  // IG/Threads publish through the FB Page token server-side, so their rows
  // parent to the workspace's facebook row (single-Page v1).
  if ((provider === "instagram" || provider === "threads") && ch.id) {
    const { data: fb } = await admin
      .from("connected_channels")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("provider", "facebook")
      .eq("status", "connected")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fb?.id) {
      await admin.from("connected_channels").update({ parent_id: fb.id }).eq("id", ch.id);
    }
  }

  // Token row (replace on re-import = rotation without history buildup).
  const { error: tErr } = await admin.from("channel_tokens").upsert(
    {
      channel_id: ch.id,
      access_token_secret_id: accessId,
      refresh_token_secret_id: refreshId,
      token_type: typeof body["token_type"] === "string" ? body["token_type"] : "Bearer",
      expires_at: typeof body["expires_at"] === "string" ? body["expires_at"] : null,
      refresh_expires_at:
        typeof body["refresh_expires_at"] === "string" ? body["refresh_expires_at"] : null,
    },
    { onConflict: "channel_id" },
  );
  if (tErr) {
    await admin.rpc("vault_delete_secret", { secret_id: accessId });
    if (refreshId) await admin.rpc("vault_delete_secret", { secret_id: refreshId });
    return bad("Could not link the token.", 500);
  }

  return Response.json({ channel_id: ch.id });
});
