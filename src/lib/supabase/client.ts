import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

// Single shared client — every module used to create its own GoTrueClient
// instance, which raced on refresh-token rotation and kicked the user back
// to login whenever the access token expired.
let client: SupabaseClient | null = null;

export function createClient() {
  client ??= createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Implicit flow: tokens come back in the URL fragment — no PKCE
        // verifier, which breaks inside installed PWAs / custom tabs.
        flowType: "implicit",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  );
  return client;
}
