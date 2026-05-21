import { createClient } from "@supabase/supabase-js";

let _service = null;

export function serviceClient() {
  if (_service) return _service;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars missing");
  }
  _service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _service;
}

export function userClientFromAuthHeader(authHeader) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader || "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req) {
  const authHeader = req.headers.authorization || "";
  const sb = userClientFromAuthHeader(authHeader);
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  return data.user;
}
