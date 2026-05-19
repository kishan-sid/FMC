import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Service-role client — bypasses RLS. Use ONLY for server-side trusted ops.
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// User-scoped client — respects RLS using the caller's JWT.
export function userClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

export async function requireUser(req: Request) {
  const sb = userClient(req);
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return { user: data.user, sb };
}
