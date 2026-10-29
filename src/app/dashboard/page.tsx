"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login");
      } else {
        setUser({ id: data.user.id, email: data.user.email ?? "" });
      }
      setChecked(true);
    });
  }, [router]);

  if (!checked || !user) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }
  return <AppShell userId={user.id} email={user.email} />;
}
