# IRON Habit Tracker — Setup

App 100% autocontenida: **Next.js static export** (SPA) + **Supabase Edge Functions** para toda la lógica server-side. El mismo bundle corre en web, Tauri (desktop) y Capacitor (mobile); las extensiones de navegador comparten la misma UI/lógica.

```
Browser/Desktop/Mobile (SPA estática)
   │  supabase-js: auth, db, realtime, functions.invoke
   ▼
Supabase ── Postgres (events/tasks/todos) + Realtime
         ── Auth (Google provider, scope calendar)
         ── Edge Functions: gcal-push, gcal-sync, gcal-watch,
            gcal-webhook (Google llama directo), save-google-tokens
```

## 1. Base de datos

Supabase Dashboard → **SQL Editor** → ejecutar `supabase/schema.sql` ✅ ya hecho

## 2. `.env.local` ✅ ya configurado

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## 3. Google OAuth web ✅ ya hecho

Cliente web en GCP `iron-499018` con redirect
`https://lqxfzeetqwmhcvkjuquj.supabase.co/auth/v1/callback` + Calendar API habilitada + provider Google activo en Supabase Auth.

## 4. Desplegar las Edge Functions ✅ hecho

```bash
supabase link --project-ref lqxfzeetqwmhcvkjuquj
supabase db push                    # migraciones en supabase/migrations/
supabase functions deploy           # gcal-* + save-google-tokens + gfit-sync
supabase secrets set GOOGLE_CLIENT_ID=<id> GOOGLE_CLIENT_SECRET=<secret>
```

`config.toml` ya marca `gcal-webhook` con `verify_jwt = false` (Google lo llama sin JWT).

## 4b. Migración de datos de la app Python

`weight_data.json` (peso/dieta local) ya se importó a Supabase una vez con:

```bash
node scripts/import-weight.mjs <user_id>
```

Las tablas de Finance (transactions, categories, accounts, food_*) ya vivían en
Supabase — la app web las lee directo, cero migración.

## 5. Correr en dev

```bash
npm run dev     # http://localhost:3000
```

## 6. Distribución

- **Web / PWA**: `npm run build` → `out/` estático. Servir en cualquier host (Railway, Vercel, Netlify, Cloudflare Pages). PWA instalable en Android/Windows gracias a `manifest.webmanifest`.
- **Desktop (Tauri)**: `npm i -D @tauri-apps/cli` → `npx tauri init` → `build.distDir: "../out"` + `frontendDist`. Dev URL o URL deployada.
- **Mobile (Capacitor)**: `npm i @capacitor/core @capacitor/cli` → `npx cap init` → `webDir: "out"` (o `server.url` apuntando al deploy para OAuth simple).
- **OAuth en shells nativos**: como el auth fluye por la URL web (Supabase redirect), lo más simple es que Tauri/Capacitor carguen la URL deployada — el OAuth funciona igual que en browser. Deep-linking nativo es la mejora futura.

## 7. Sync con Google Calendar — cómo funciona

- **App → Google**: cada crear/editar/eliminar invoca `gcal-push` (inmediato).
- **Google → App**: pull incremental con `syncToken` vía `gcal-sync` al cargar y cada 5 min.
- **Push real**: `gcal-watch` registra un canal Google → `gcal-webhook` (expira ~7 días; llamar periódicamente o tras login). Esto sí funciona local porque el webhook apunta a Supabase, no a tu PC.
- **Entre dispositivos**: Supabase Realtime — sin refrescar.

## Estructura

```
src/
  app/ (login, auth/callback, dashboard — todo client-side)
  components/
    app-shell.tsx                # sidebar IRON por capitales
    (time-manager: week-calendar, kanban, todo-list, analytics)
    iron/
      weight-module.tsx          # Physical → Weight (grid mensual + chart + GFit)
      diet-module.tsx            # Physical → Diet (targets, status, recomendación)
      finance-module.tsx         # Productive → Finance (Resumen/Revisión/Comida)
      flashcards-module.tsx      # Intellectual → Flashcards (SM-2)
  lib/ (capitals, types, diet-engine, supabase client)
supabase/
  schema.sql
  config.toml                    # verify_jwt=false para gcal-webhook
  migrations/                    # iron_modules: weight/diet/flashcards + RLS
  functions/
    _shared/ (cors, auth, google)
    gcal-push | gcal-sync | gcal-watch | gcal-webhook | save-google-tokens
    gfit-sync                    # Google Fit -> weight_entries
scripts/
  import-weight.mjs              # weight_data.json -> Supabase (one-time)
```
