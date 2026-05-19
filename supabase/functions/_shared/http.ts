import { corsHeaders } from "./cors.ts";

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export function ok(body: unknown): Response {
  return json(body, { status: 200 });
}

export function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 });
}

export function unauthorized(message = "Unauthorized"): Response {
  return json({ error: message }, { status: 401 });
}

export function serverError(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  return json({ error: message }, { status: 500 });
}
