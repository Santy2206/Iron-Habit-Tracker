"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/lang";

export default function Home() {
  const { t } = useT();
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? "/dashboard" : "/login");
    });
  }, [router]);

  return (
    <div className="flex flex-1 items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">{t("Loading…", "Cargando…")}</p>
    </div>
  );
}
