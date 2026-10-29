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

## 8. Captura financiera durable — preparación, no despliegue

Estado: backend validado localmente con eventos **sintéticos** y Postgres aislado. Se consultó únicamente el esquema del proyecto enlazado; no sus filas, logs de notificaciones ni configuración efectiva de Edge Functions. No se desplegó ni se migró producción. La interfaz de diagnóstico queda aplazada por decisión del solicitante; este cambio debe revisarse como **draft**, no como integración lista para activar.

### Hallazgos y alcance

- Confirmado en código anterior: identidad dependiente de la hora de recepción si faltaba `occurred_at`; palabras genéricas (incluido crédito) decidían dirección; múltiples importes podían interpretarse usando el primero; errores de escritura sin comprobar; redirección a RappiCard con fallback silencioso; patrones de tarjeta exclusivamente bajo RappiCuenta. No se atribuyen incidentes de producción a estas observaciones.
- Confirmado por inspección del esquema, sin leer datos: cuentas/transacciones sin propietario; políticas financieras `authenticated_all`; emparejamiento automático por importe, dirección opuesta y 15 minutos. Esos patrones no prueban una transferencia propia.
- El config versionado no declaraba `verify_jwt=false` para este webhook. No sabemos qué flag tiene el despliegue actual. La nueva configuración solo es válida con el nuevo handler: captura con secreto individual de alta entropía y reprocesamiento con JWT validado mediante `auth.getUser`. No existe modo anónimo de escritura.
- La ampliación de propiedad/RLS fue autorizada explícitamente. No se cambian Next.js, exportación estática, componentes, estilos ni i18n. No hay API routes, servicios pagos ni IA por evento.

### Contrato y confirmación

`POST $SUPABASE_URL/functions/v1/ingest-notification` con `x-webhook-secret` individual (32–512 caracteres, recomendado 32 bytes aleatorios), `Content-Type: application/json`:

```json
{
  "event_id": "phone-a:1042",
  "account_name": "RappiCard",
  "occurred_at": "2026-10-20T10:00:00-05:00",
  "raw_text": "<notificación capturada; no guardar ejemplos reales en el repositorio>"
}
```

`source` es un alias de `account_name`. Describe la fuente/app, no garantiza el producto destino. Se permiten las fuentes configuradas por administrador en el capturador; por defecto Bancolombia, Nequi, RappiCard y RappiCuenta. Una compra de RappiCard recibida desde la fuente RappiCuenta busca exclusivamente la RappiCard del propietario, nunca la cuenta de otra persona ni un fallback a RappiCuenta.

Compatibilidad con texto plano: `POST .../ingest-notification?account=Nequi`, cuerpo = texto sin escapar; headers `x-webhook-secret`, `x-event-id` y `x-occurred-at`. Se conservan `?mode=learn` y los nombres de campos existentes. **Cambio de contrato deliberado:** el capturador antiguo debe añadir un ID estable; sin él se devuelve 400, no una deduplicación inventada. `occurred_at` puede faltar: el evento se conserva, pero un movimiento sin hora de notificación queda pendiente y no usa la hora de recepción como hora financiera.

Límites: cuerpo HTTP 16 KiB, texto UTF-8 8 KiB, ID ASCII de 1–128 caracteres (`A-Z a-z 0-9 _ . : -`), timestamp ISO con zona explícita, calendario válido y años 1970–2200. Importes completos de máximo 12 enteros y dos decimales, sin `parseFloat` parcial. Se mantienen como decimal exacto hasta Postgres `numeric(14,2)`.

Respuesta 200 con `received: true` solo después de un evento duradero. El estado del parser es independiente de la recepción; `received`, `pending_review`, `ignored` o `error` no ordenan reenviar. Si falla guardar el evento: 503. Si se reutiliza un ID con distinto contenido: 409. Las credenciales inválidas reciben 401, el contrato inválido 400. Nunca se devuelven errores SQL ni texto financiero en logs de aplicación.

La identidad es `(capturer_id, event_id)`, no texto, importe ni minuto. El hash verifica que un reintento no cambió el payload, pero no fusiona dos IDs distintos. La hora de recepción se almacena separadamente. OTP/claves/códigos se descartan antes de persistir: solo se guarda metadata de un evento ignorado, ni texto ni hash de ese contenido sensible.

### MacroDroid: configuración que debe realizarse en el teléfono

No se modificó ni se probó ningún teléfono. La versión de MacroDroid y sus nombres de acciones deben confirmarse en el dispositivo. Configuración requerida, sin depender de JSON construido por concatenación:

1. Disparador de notificación/SMS limitado a las apps/remitentes bancarios reales que el usuario verifique. Elegir una etiqueta de fuente exacta de las permitidas. No inventar paquetes Android ni tomar todas las notificaciones del sistema.
2. Al capturar **una vez**, guardar texto y timestamp original con zona horaria. Incrementar un contador persistente por instalación y formar `event_id = <id-instalación>:<contador>`. Otra alternativa es un UUID generado una sola vez. Serializar la captura para evitar carreras del contador; no usar solo milisegundos ni regenerar el ID al reenviar. Verificar persistencia del contador tras reinicio y cambiar el ID de instalación si se reinstala/restaura una copia.
3. Antes del HTTP, guardar el registro completo en una cola local persistente. Cada registro conserva ID, fuente, timestamp y texto. Rechazar OTP/claves también en el dispositivo cuando sea posible y proteger la cola del acceso de otras apps. No sobrescribir un único registro mientras otro está pendiente.
4. Macro de envío: tomar un registro de esa cola y hacer HTTP POST como texto plano a la ruta anterior con `?account=<fuente>`, `Content-Type: text/plain; charset=utf-8` y los tres headers indicados. El secreto vive solo en la configuración privada del teléfono; nunca en frontend, URL, capturas públicas o repositorio. El ID y la hora proceden del registro, no del reloj de la macro de envío.
5. Quitar el registro de la cola únicamente al recibir 200 y `received: true`. Ante timeout, desconexión o 5xx, mantenerlo y reintentar el mismo registro con espera creciente (por ejemplo 1, 2, 4 y hasta 15 minutos). Ante 400/401/409, detener los reintentos automáticos de ese registro y avisar para intervención: no alterar ID/texto para forzar aceptación. Un 200 pendiente se resuelve en la bandeja, no se reenvía infinitamente.
6. Antes de activar captura real, probar en staging: reenvío del mismo registro, dos compras idénticas con IDs distintos, cola tras reinicio y pérdida de respuesta después de guardar. La entrega exacta desde Android y la persistencia de su cola **siguen sin validar**.

### Migración y propiedad: pasos administrativos separados

`20261029090000_notification_inbox.sql` requiere el esquema financiero existente inspeccionado. `finance-current-schema.sql` es un snapshot **solo DDL** de ese esquema para reconstrucción local; incluye objetos antiguos con permisos anteriores. **No es una migración, no contiene filas y jamás debe restaurarse sobre una base existente o producción.** El historial original de creación de finanzas no estaba en las migraciones actuales.

La nueva migración añade `user_id` nullable a las tablas financieras; deja los registros antiguos en NULL sin inferir dueño y los oculta a la SPA. Nuevos registros de usuario toman `auth.uid()`. Las políticas restrictivas limitan incluso las antiguas políticas permisivas; se eliminan privilegios de cliente innecesarios y se comprueban las referencias entre propietarios. Los nombres de cuentas/categorías/alimentos pasan a ser únicos por usuario. El singleton `budget_split.id=true` conserva la API existente mediante una PK técnica y unicidad por propietario.

**No aplicar remotamente sin una ventana de mantenimiento, backup y revisión de propiedad:**

1. Probar primero la migración en una copia de esquema y datos anonimizados de staging; revisar integraciones Python/email que usen service_role: ahora deben proporcionar el propietario y respetar sus referencias. Las escrituras antiguas sin propietario fallan de forma cerrada.
2. Revisar quién es dueño de cada conjunto de datos históricos. Solo si **todos los registros financieros aún sin dueño pertenecen a una misma persona**, el administrador puede ejecutar explícitamente `select public.assign_legacy_finance_owner('<UUID-confirmado>');`. Esta función no se ejecuta automáticamente ni desde la SPA. Si hay varios dueños, no usarla: preparar una asignación por filas y validar referencias en staging. No inferir propietario por nombre de cuenta.
3. Aprovisionar un secreto aleatorio individual en el teléfono/gestor privado. Calcular SHA-256 fuera del frontend y registrar **solo el hash** mediante una conexión administrativa: `insert into public.notification_capturers(user_id,secret_hash,label) values ('<UUID-confirmado>','<sha256-hex-de-64-caracteres>','Teléfono personal');`. No compartir hashes ni secretos en el PR. Para revocar: administrador establece `enabled=false`. Al rotar el secreto del mismo dispositivo, actualizar `secret_hash` de la **misma fila**, manteniendo capturer_id y los IDs de la cola; crear otro capturador para reintentos antiguos cambiaría la identidad y podría duplicarlos. `app_secrets.notification_ingest_secret` deja de usarse y no se elimina ni se expone.
4. Comprobar cuentas/productos y sus roles por propietario. RappiCard debe tener `role=credit`; si no existe o el rol no corresponde, el movimiento queda pendiente. Revisar presupuestos por usuario. No se crean cuentas silenciosamente.
5. Actualizar y probar el capturador en staging **antes** de cambiar conjuntamente handler/config. `verify_jwt=false` no significa autenticación desactivada: el nuevo handler valida secreto individual o JWT según acción. No publicar el config con el handler anterior ni activar el nuevo sin credenciales aprovisionadas.

No se reescriben transacciones ni parejas históricas. Los automatismos de emparejamiento por importe/tiempo quedan inertes para nuevas inserciones; confirmar manualmente dos movimientos sigue siendo posible. Las reglas e income splits existentes se acotan al propietario para el flujo manual/legacy; la bandeja no ejecuta reglas genéricas que reclasifiquen automáticamente pagos de tarjeta, transferencias o ingresos. La RPC masiva `reapply_rules` anterior queda revocada; no era utilizada por la SPA y no se sustituye por una reclasificación masiva de correcciones del usuario.

### Diagnóstico, revisión y reprocesamiento desde cliente autenticado

La interfaz compacta está **aplazada**. El backend ya expone, bajo RLS:

- `notification_source_status`: último evento por fuente, fechas separadas, estado, motivo y transacción; sin texto ni secretos.
- `notification_events`: bandeja propia, incluyendo texto mínimo para revisión; no permite escrituras directas del cliente. Estados: recibido, procesado, pendiente, ignorado y error.
- `POST .../ingest-notification?action=reprocess`, header `Authorization: Bearer <JWT de sesión>`, JSON `{ "id": "<UUID-evento>" }`. Se valida el usuario real, se busca por ID **y propietario** y se usa el parser actual. No admite user_id del request. Un evento ya procesado no cambia su transacción ni sus correcciones.
- `supabase.rpc('review_notification', { p_id, p_product, p_amount, p_direction, p_kind, p_occurred_at })`: decisión explícita del usuario. `p_product` es nombre de su cuenta, importe decimal exacto, dirección `in/out`, tipo `expense/income/card_payment/internal_transfer`, hora efectiva ISO. No edita el texto ni la hora de notificación original. Usa lock de fila y referencia única de evento; repetir no duplica ni sobrescribe correcciones.
- `supabase.rpc('link_notification_evidence', { p_id, p_transaction })`: vincula manualmente un evento aún sin transacción a una transacción propia cuando el usuario ha comprobado evidencia suficiente; no crea ni fusiona operaciones por parecido. Repetir no cambia una decisión previa. Esta es una decisión humana explícita, no una inferencia por monto.

RappiCard compra se registra como gasto una sola vez; pago de tarjeta e ingreso/transferencia quedan en revisión cuando falta evidencia contable. Una revisión `card_payment` no es consumo y `internal_transfer` no es ingreso ni consumo en los agregados existentes. No se actualiza automáticamente la tabla `debts` ni se determina qué deuda liquida un pago: hace falta vinculación real y validación del usuario. Los reversos/devoluciones quedan pendientes; nunca se borra ni se netea la operación original. Hace falta definir su asiento/vínculo contable con ejemplos y producto real antes de automatizarlos.

### Pruebas locales reproducibles

Deno y frontend:

```bash
npm run test:notifications
deno check supabase/functions/ingest-notification/index.ts
npm run lint
npm run build
```

SQL: se usó Docker con Postgres Supabase 17, sin filas remotas ni el servicio local existente de puerto 5432. Ejemplo Bash para una instancia **nueva y aislada** (credencial siguiente es exclusivamente sintética/local, no usar en otros entornos):

```bash
docker run -d --name iron-notification-tests -e POSTGRES_PASSWORD=iron-local-test-only -p 127.0.0.1:55432:5432 public.ecr.aws/supabase/postgres:17.11.0.002
docker exec iron-notification-tests pg_isready -U postgres
export PGPASSWORD=iron-local-test-only
psql -w -h 127.0.0.1 -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "create database iron_notification_final_test template template0"
docker exec iron-notification-tests pg_dump -U postgres --schema-only --schema=auth --no-owner --no-privileges postgres | psql -w -h 127.0.0.1 -p 55432 -U postgres -d iron_notification_final_test -v ON_ERROR_STOP=1
psql -w -h 127.0.0.1 -p 55432 -U postgres -d iron_notification_final_test -v ON_ERROR_STOP=1 -c "grant usage on schema auth to anon, authenticated, service_role" -f supabase/finance-current-schema.sql -f supabase/migrations/20261029090000_notification_inbox.sql -c "set iron.test_database = 'synthetic-local-only'" -f supabase/notification_inbox_test.sql
unset PGPASSWORD
```

Esperar disponibilidad real de Postgres antes de continuar. Si ya existe ese contenedor/base, usar nombres nuevos: no borrar ni resetear instancias existentes. Las pruebas SQL exigen nombre `iron%test` y marca explícita de entorno, y hacen rollback de todas las filas sintéticas. No requieren pgTAP; fallan con excepción SQL y `ON_ERROR_STOP`.

Cobertura: reenvío, dos eventos legítimos idénticos, persistencia fallida sin ACK, parser fallido después de guardado con ACK, conflicto de identidad, importes válidos/inválidos, crédito, promoción, rechazo, ambigüedad, fecha inválida/ausente, OTP descartado, cuenta inexistente sin fallback, reprocesamiento idempotente, RLS de dos propietarios y anónimo, referencias cruzadas, revisión que conserva una corrección, evidencia vinculada sin duplicar, pago de tarjeta sin doble gasto, transferencia propia explícita sin ingreso y desactivación de emparejamiento por monto. El SQL se ejecutó sobre el snapshot real de esquema y fixtures sintéticos; el handler se prueba con Store en memoria, **no** como Edge Function desplegada ni contra Auth/PostgREST reales.

### Limitaciones y evidencias faltantes

- Los ejemplos de pruebas son sintéticos. Los patrones Rappi heredados estaban en comentarios del código anterior, sin corpus que demuestre su procedencia. Se mantienen separados por producto, pero no se presentan como mensajes bancarios reales validados.
- Faltan ejemplos anonimizados reales de Bancolombia y Nequi (compra aprobada, recepción/envío, pagos, moneda, operación rechazada, múltiples importes) y de RappiCard (compra, PSE, devolución/reverso, idioma y referencia de operación), además de capturas del emisor/versión Android. Sin formatos suficientes, el parser conserva para revisión en vez de adivinar.
- No hay correlación automática entre evidencias distintas de una misma operación: faltan IDs de operación bancarios verificados. Distintos event_id se conservan separados; una vinculación segura se decide manualmente. No hay borrado de duplicados históricos ni reparación retroactiva de parejas.
- No se auditó el contenido histórico de `unparsed_notifications`, ni se probó un teléfono, gateway remoto, JWT real de la Edge Function, carga concurrente/end-to-end o despliegue. No se afirma éxito en producción. Falta aprobar retención/acceso de la cola del teléfono y de textos de revisión; no se añade purga automática de datos.
- Antes de considerar listo para activar: implementar la interfaz aplazada, revisar la asignación de propiedad en staging, probar la cola del teléfono y el handler real con Auth/PostgREST locales/staging, validar los formatos con mensajes reales anonimizados y revisar impactos en consumidores legacy de finanzas.
