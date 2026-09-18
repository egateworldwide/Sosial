// remove-channel-token · cloud opt-out / disconnect cleanup
//
// Mirrors import-channel-token's auth model: caller JWT → active membership
// check → delete the channel row (token row cascades) → delete the Vault
// secrets so nothing orphaned survives. Idempotent: unknown channel → 200
// { removed: false }.
//
// POST { workspace_id, provider, external_id }
// → 200 { removed: boolean }

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
  if (typeof workspace_id !== "string" || !workspace_id) return bad("workspace_id required.");
  if (typeof provider !== "string" || !PROVIDERS.has(provider)) return bad("Unknown provider.");
  if (typeof external_id !== "string" || !external_id) return bad("external_id required.");

  const admin = createClient(supaUrl, serviceKey);

  const { data: mem } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!mem) return bad("Not a member of this workspace.", 403);

  const { data: ch } = await admin
    .from("connected_channels")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("provider", provider)
    .eq("external_id", external_id)
    .maybeSingle();
  if (!ch) return Response.json({ removed: false });

  // Collect secret ids BEFORE the cascade deletes the token row.
  const { data: tok } = await admin
    .from("channel_tokens")
    .select("access_token_secret_id, refresh_token_secret_id")
    .eq("channel_id", ch.id)
    .maybeSingle();

  await admin.from("connected_channels").delete().eq("id", ch.id);

  const secrets = [tok?.access_token_secret_id, tok?.refresh_token_secret_id].filter(
    (s): s is string => typeof s === "string" && !!s,
  );
  for (const sid of secrets) {
    await admin.rpc("vault_delete_secret", { secret_id: sid });
  }

  return Response.json({ removed: true });
});
