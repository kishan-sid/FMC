// POST /functions/v1/bootstrap-profile
// Ensures a `profiles` row exists for the calling user. Safe to call on login.
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;

  try {
    const { user } = await requireUser(req);
    const admin = serviceClient();

    const name =
      (user.user_metadata?.name as string | undefined) ??
      user.email?.split("@")[0] ??
      "User";

    const { data, error } = await admin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email!,
          name,
          role: (user.user_metadata?.role as string) ?? "analyst",
          initials: name.slice(0, 2).toUpperCase(),
        },
        { onConflict: "id" }
      )
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ profile: data }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
