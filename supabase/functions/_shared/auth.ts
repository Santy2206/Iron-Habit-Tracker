import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/** Service-role client — bypasses RLS. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Extracts the authenticated user from the request's Bearer JWT. */
export async function getUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
}
