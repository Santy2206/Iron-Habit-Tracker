"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/lang";

/**
 * OAuth callback (client-side — required for static export).
 * Implicit flow lands tokens in the URL #fragment (parsed automatically by
 * detectSessionInUrl → SIGNED_IN); legacy PKCE tabs land a ?code= param.
 * Either way we persist the Google provider tokens via save-google-tokens.
 */
export default function AuthCallbackPage() {
  const { t } = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    return (
      search.get("error_description") ??
      search.get("error") ??
      hash.get("error_description") ??
      hash.get("error")
    );
  });

  useEffect(() => {
    if (error) return;
    const supabase = createClient();
    let done = false;

    async function finish(session: {
      provider_token?: string | null;
      provider_refresh_token?: string | null;
    } | null) {
      if (done) return;
      done = true;
      if (session?.provider_token || session?.provider_refresh_token) {
        await supabase.functions
          .invoke("save-google-tokens", {
            body: {
              provider_token: session.provider_token,
              provider_refresh_token: session.provider_refresh_token,
            },
          })
          .catch(() => {});
      }
      router.replace(session ? "/dashboard" : "/login");
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN") void finish(session);
    });

    void (async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setError(error.message);
          return;
        }
        await finish(data.session);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await finish(data.session);
        return;
      }
      // nothing in the URL and no session → give the fragment parser a moment,
      // then bail back to login
      setTimeout(() => {
        if (!done) router.replace("/login");
      }, 4000);
    })();

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-1 items-center justify-center bg-background">
      {error ? (
        <div className="text-center">
          <p className="text-sm text-red-400">{t("Authentication error", "Error de autenticación")}: {error}</p>
          <button
            onClick={() => router.replace("/login")}
            className="mt-3 text-sm text-muted-foreground underline"
          >
            {t("Back to login", "Volver al login")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("Connecting…", "Conectando…")}</p>
      )}
    </div>
  );
}
