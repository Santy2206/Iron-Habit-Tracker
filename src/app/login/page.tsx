"use client";

import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/lang";

export default function LoginPage() {
  const { t } = useT();
  const supabase = createClient();

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes:
          "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/fitness.body.read",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[#242424] p-6">
      {/* soft glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, #3fb97f 0%, #429a8e 45%, transparent 70%)",
        }}
      />

      <div className="relative flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl bg-[#1d2027] px-8 py-10 shadow-2xl">
        <svg
          viewBox="0 0 512 512"
          role="img"
          aria-label="IRON Habit Tracker"
          className="size-20 shadow-lg"
        >
          <rect width="512" height="512" rx="112" fill="#181b21" />
          <polyline
            points="116,368 212,272 292,328 388,200"
            fill="none"
            stroke="#3fb97f"
            strokeWidth="40"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="304,200 388,200 388,284"
            fill="none"
            stroke="#3fb97f"
            strokeWidth="40"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[#e7e9ee]">
            IRON Habit Tracker
          </h1>
          <p className="text-sm leading-relaxed text-[#9aa0ab]">
            {t(
              "Compound interest for your life: automate the five capitals you invest in every day — productive, physical, intellectual, social and spiritual — and watch the returns add up.",
              "Interés compuesto para tu vida: automatiza los cinco capitales en los que inviertes cada día — productivo, físico, intelectual, social y espiritual — y mira cómo se acumulan los retornos.",
            )}
          </p>
        </div>

        <button
          onClick={signInWithGoogle}
          className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] shadow transition-colors hover:bg-[#f1f3f4]"
        >
          <svg className="size-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09a7.19 7.19 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {t("Continue with Google", "Continuar con Google")}
        </button>

        <p className="text-center text-[11px] leading-relaxed text-[#6b7280]">
          {t("Access to Google Calendar and Google Fit will be requested for sync.", "Se pedirá acceso a Google Calendar y Google Fit para sincronizar.")}
        </p>
      </div>
    </div>
  );
}
