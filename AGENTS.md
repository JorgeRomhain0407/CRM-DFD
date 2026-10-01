# AGENTS.md — CRM-DFD

CRM omnicanal para la Farmacia DFD: bot de WhatsApp (Meta Cloud API + OpenAI Responses API con function calling) + panel web "Mostrador" para los farmacéuticos. Node.js ≥20, Express 4, Supabase (PostgreSQL), PM2 en VPS.

## Regla 0 — Dónde trabajar

- **Repo canónico: `C:\Users\Aleja\Projects\CRM-DFD`** (rama `main`). **Un SOLO clon de trabajo**: no crear clones paralelos (una vez causó duplicación del proyecto y trabajo divergente).
- El clon viejo de `C:\Users\Aleja\AppData\Local\Temp\opencode\CRM-DFD` está **dañado** — no usarlo ni borrarlo. La bóveda y docs viejos aún lo referencian: ignora esas rutas.
- Producción: VM `crm-vps` (Oracle), código en `/home/alejandromera2002/crm`, PM2 con dos apps: **`crm`** (este repo) y **`farmacia-consumidor`** (middleware TPV). Ojo: `ecosystem.config.js` define nombre `crm-dfd`, pero en la VM el app se llama `crm`.

## Regla 1 — Protocolo de sesión (obligatorio)

1. **Al iniciar: leer solo** `Docs_Obsidian/00_Sistema/Contexto_IA.md` y `Docs_Obsidian/03_Progreso/Estado_Actual.md` (protocolo de la bóveda; el resto se lee bajo demanda).
2. **Al terminar un cambio: actualizar la bóveda** — `Estado_Actual.md` + fila nueva en `Docs_Obsidian/04_Historial/Changelog_Versionado.md` con el `#V{n}` y el hash del commit. El usuario lo pide como "Actualiza la bóveda".
3. **GO/No-GO: nada se ejecuta sin OK explícito del usuario** (`empieza #V{n}` / `lanza #V{n}`). Proponer ≠ implementar.

## Comandos exactos

```bash
npm run dev                      # servidor con --watch (puerto 3000)
npm start                         # producción local
npm run check-openai             # verifica la key de OpenAI (no crea asistente)

node scripts/test-guardia-sanitaria.js   # batería guardia sanitaria 21/21, SIN BD
node scripts/sync-prompt.js              # system.txt -> bot_config.system_prompt (BD)
node scripts/backfill-v30.js             # perfil JSONB desde habitos (necesita .env con service_role)
node scripts/bench-v30.js               # p95 del snapshot #V30 (meta <300ms; 2º arg = N)

node run-tests.js                # E2E del bot contra localhost:3000 (usa MOSTRADOR_API_KEY del .env)
node check-ctx.js                # inspecciona estado_chat.last_tool_context de un teléfono de prueba
```

No hay `npm test` ni linter: la verificación es `node --check <archivo>` tras cada cambio de JS, más las baterías de arriba. `farmacia-sync/` es un proyecto aparte con su propio `package.json` y su `farmacia.env` (scripts: `servidor`, `consumidor`, `sync`, `inspeccionar`).

## Entorno y secretos

- `.env` NO se versiona; la VM tiene el suyo. Plantilla: `.env.example`.
- `SUPABASE_SERVICE_ROLE_KEY`: **solo backend**, nunca en navegador. El panel nunca habla con Supabase directo — solo con la API Node vía `x-api-key` (`MOSTRADOR_API_KEY`). `ADMIN_CONFIG_KEY` aparte para editar la config del bot.
- **Prompt del bot: la fuente de verdad es `bot_config.system_prompt` en BD**; `src/prompts/system.txt` es plantilla/fallback. Para cambiar el prompt: edita `system.txt` y corre `scripts/sync-prompt.js` (no solo el archivo).
- No hay acceso local a la BD de producción: **las migraciones las pega el usuario en el SQL Editor de Supabase**. Los archivos de `sql/` son idempotentes y re-ejecutables.

## Arquitectura en 30 segundos

- Entrada: `src/server.js` (Express + Helmet + rate-limit; `app.set('trust proxy', 1)` — requerido detrás del proxy de la VM o `express-rate-limit` lanza `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`).
- **`src/services/webhook.js` → `src/services/bot.js` (`grabarMensaje()`) → `src/services/ai.js`** es el camino de todo mensaje. Roles: usuario | asistente | operador; canal: whatsapp | test.
- Tool calling estricto: `src/lib/openai-tools.json` define las tools; el bot **nunca** inventa precio/stock (pasa por `consultar_precio_y_stock`, máx 3 opciones).
- `src/lib/guardia-sanitaria.js`: interceptor server-side ANTES del LLM — receta/posología/emergencia/embarazo etc. fuerzan `solicitar_asistencia_humana` sin depender del modelo. **Nunca relajar esto: el bot no inventa dosis ni diagnósticos.**
- #V30 (capa de datos ágil): tabla append-only `cliente_eventos` (CHECK de tipos: mensaje_usuario/tool_call/compra/handoff…), RPCs `registrar_evento_cliente`/`contexto_cliente_snapshot`, `clientes.perfil` JSONB, hook fire-and-forget en `grabarMensaje` (sin PII). Servicio: `src/services/cliente-contexto.js`.
- Estados de chat en `estado_chat`: `bot_activo` / `esperando_operador` / `humano_activo`. En `esperando_operador` el webhook NO invoca OpenAI hasta que el mostrador reactiva.
- Panel: `public/` (SPA sin framework). Cache-busting manual `?v=N` en CSS/JS — súbelo al tocar el frontend o el navegador sirve la versión vieja.

## Migraciones — cuidado

- **NO re-ejecutar `farmacia-sync/sql/migracion-fefo-lotes.sql` a la ligera**: termina con `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated` global, que revoca las RPCs de #V30 (`registrar_evento_cliente`, `contexto_cliente_snapshot`) y rompe el bot. Para el problema de RLS en `lotes` existe el fix quirúrgico ya aplicado: `sql/fix-rls-lotes.sql`.
- `sql/migracion-fefo-lotes.sql` (en la raíz `sql/`) es un **stub obsoleto** — la canónica vive en `farmacia-sync/sql/`.
- Patrón de seguridad de tablas: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `REVOKE ALL … FROM anon, authenticated` + `GRANT ALL … TO service_role`. Nunca crear policies para anon; el único consumidor es el backend con service_role.

## Versionado y releases

- Doble registro: **`#V{n}`** (cambios individuales, mapeados a hash git) en la bóveda `04_Historial/Changelog_Versionado.md`; **releases** `vX.Y.Z` (tags + `CHANGELOG.md` raíz, SemVer). La tabla de PM2 muestra la `version` de `package.json` — búmpala al liberar.
- Deploys a la VM (los corre el usuario por SSH; el agente no tiene acceso):
  ```bash
  cd /home/alejandromera2002/crm && git pull origin main
  npm ci && pm2 restart crm --update-env
  pm2 logs crm --lines 20 --nostream
  ```
  Endpoint de salud: `/health` (HTTPS vía Caddy).

## Orquesta de departamentos (no pisarse)

El proyecto corre como sesiones/agentes separados por capa — respeta el alcance y consulta asignaciones en `Docs_Obsidian/03_Progreso/En_Progreso.md`:

- **D01 Backend** (rutas, Supabase, motor, TPV) · **D02 Frontend** (`public/`) · **D03 QA** (validación funcional, `run-tests.js`) · **D04 Seguridad/Salud** (audita límites sanitarios y datos) · **D05 Release/Deploy** (merge, tags, VM) · **D06 Chatbots** (conversación, intents, tono — audita, propone `#V{n}`, no implementa sin OK).
- Los items terminados van a `Estado_Actual.md` §Hecho; los pendientes viven en `En_Progreso.md` con responsable y prioridad.

## Lecciones pagadas (no repetirlas)

- **Un solo clon de trabajo** (`Projects\CRM-DFD`): los clones paralelos divergen y duplican el proyecto (pasó el 2026-09-30).
- **Corrupción de heredocs de PowerShell**: escribir JS con here-strings de PS corrompió código (literalmente `const N = 50lite;`) y llegó a commitearse. Usar la herramienta de escritura de archivos, nunca heredocs, y **`node --check` inmediato** tras escribir JS.
- **Verificar en disco, no en el transcript**: la discrepancia de #V47 existió porque se confió en lo reportado. grep/leer el archivo real antes de afirmar que algo está hecho.
- **`pm2 logs` tras un restart muestra líneas viejas**: para verificar que un fix de errores de runtime funcionó, `pm2 flush crm` primero, reproducir, y entonces mirar el log.
- **Merges con `main` avanzando en paralelo**: otras sesiones empujan a `origin/main` — `git fetch` antes de pushear; en conflictos de changelog, el lado de main suele ser el superset (la rama feat tiende a solo reformat).
- Local es Windows, prod es Linux: el repo usa LF (git avisa LF→CRLF; es solo warning local, no lo "arregles" masivamente).
- Español para TODO lo user-facing y para los commits (`tipo(scope): descripción`). Mensajes al cliente: cortos, estilo WhatsApp, sin jerga técnica.
