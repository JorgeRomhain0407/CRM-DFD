# PLAN DE REMEDIACIÓN — Auditoría CSO D04 (Seguridad) — CRM-DFD

Fuente: auditoría del 2026-09-18 (run `1789741958269-5bc46b0e4882ee94`).
Alcance: cédula `^[VE]?[0-9]{5,9}$`, `x-api-key`, sanitización, auditoría.

Orden: por severidad → impacto → esfuerzo. Cada ítem indica archivo/línea y cambio concreto.

---

## P0 — Crítico (hacer ya, antes de cualquier deploy)

### R1 · Stored XSS en el panel vía `motivo_handoff` (origen externo WhatsApp)
- **Dónde:** `src/services/tools.js:330-339` (persiste `motivo` = texto del cliente), `public/app.js:560` (render innerHTML sin escapar), `src/server.js:17` (CSP apagada).
- **Qué hacer:**
  1. Escapar TODA salida en `public/app.js` antes de `innerHTML`: en `buildAccionesArea` (`Motivo: ${conv.motivo_handoff}`), en `renderConversaciones` (`conv-name`, línea 516) y en `abrirConversacion` (`detail-title`, línea 611). Usar el helper ya existente `esc()` (línea 342) o `textContent`.
  2. `buildMensajesHtml` (línea 560) solo escapa `<`: extender a `esc()` para atributos y contexto general.
  3. Habilitar CSP en helmet: `contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"] } }` (server.js:16-19). El panel no usa scripts/CDN externos → compatible.
  4. (Defensa en profundidad) Al persistir `motivo` en `solicitarAsistenciaHumana` y en PATCH `/api/estado-chat` (api.js:245, bot.js:113-115): normalizar a texto plano (`motivo.replace(/[<>]/g,'')` o limitar charset).
- **Verificación:** abrir una conversación con `motivo` = `<img src=x onerror=alert(1)>` y confirmar que se muestra literal. Revisar con navegador todas las vistas del panel.

### R2 · `x-api-key` también en query string → eliminar
- **Dónde:** `src/routes/api.js:14`, `src/routes/bot.js:20`.
- **Qué hacer:** quitar `|| req.query.api_key`. Solo cabecera `x-api-key`.
- **Verificación:** `GET /api/clientes?api_key=dev-mostrador-key` → 401; `GET /api/clientes` con cabecera → 200.

---

## P1 — Alto (esta semana)

### R3 · Fail-open de claves con fallback predecible
- **Dónde:** `src/config.js:7-13, 20, 37`.
- **Qué hacer:**
  1. `env()`: lanzar si `required && !value` **siempre** (no solo `isProd`), o exigir fallback solo si `NODE_ENV === 'development'` está explícito y vaciar el valor por defecto en cualquier otro caso.
  2. Sustituir `fallback: 'dev-mostrador-key'` y `fallback: 'dev-verify-token'` por sin fallback (o valor generado con `crypto.randomBytes` solo en dev explícito).
- **Verificación:** arrancar sin `MOSTRADOR_API_KEY` y sin `NODE_ENV=production` → debe fallar al arrancar.

### R4 · Comparación de claves no constante en tiempo
- **Dónde:** `api.js:15`, `bot.js:21`, `webhook.js:18` (handshake).
- **Qué hacer:** reutilizar `timingSafeEqual` (ya existe en `src/lib/meta.js`) para `MOSTRADOR_API_KEY`, `ADMIN_CONFIG_KEY` y `hub.verify_token`. Comparar siempre dos hashes de longitud fija (ej. HMAC de ambas partes) para evitar el early-return por longitud.
- **Verificación:** unit test con claves correcta/incorrecta parciaales; confirmar que no hay ramificación de longitud visible.

### R5 · Auditoría: middleware de request log + versión de `bot_config`
- **Dónde:** `src/server.js` (nuevo middleware antes de las rutas), `src/services/bot.js:16-41`.
- **Qué hacer:**
  1. Middleware de acceso: `(req,res,next)=>{ const t=Date.now(); res.on('finish',()=>console.log(JSON.stringify({t:new Date().toISOString(),m:req.method,p:req.path,s:res.statusCode,ms:Date.now()-t,ip:req.ip}))); next(); }` — **sin cuerpo, sin query string, sin cabeceras**. (Alternativa: `morgan` con formato custom.)
  2. Registrar mutaciones: append-only log o tabla `bot_config_audit` (id, bot_config_id=1, admin_key_used, bot_nombre, system_prompt, temperatura, created_at). En `updateBotConfig`, insertar el registro con el valor `x-admin-key` usado (hash) y fecha. Hacer lo mismo, mínimo, para las mutaciones de `clientes` (PUT) con ident de la sesión.
- **Verificación:** hacer un PUT `/api/bot/config` y comprobar entrada en el log/audit.

---

## P2 — Medio (en el sprint siguiente)

### R6 · Cédula: alinear a `^[VE]?[0-9]{5,9}$`
- **Dónde:** `src/services/customers.js:57`, `sql/schema.sql:29`, `sql/migracion-clientes-cedula.sql:17`.
- **Qué hacer:**
  1. `normalizarCedula`: cambiar regex a `/^[VE]?[0-9]{5,9}$/` (mantener trim/upper).
  2. Nueva migración: `ADD CONSTRAINT clientes_cedula_formato CHECK (cedula IS NULL OR (cedula = upper(btrim(cedula)) AND cedula ~ '^[VE]?[0-9]{5,9}$'))`. Antes, `UPDATE clientes SET cedula = NULL WHERE cedula ~ '[^VE][0-9]{5,9}'` (o reportar registros inválidos al equipo para depuración).
- **Verificación:** `J12345678` debe rechazarse (400); `V12345678`, `E1234567` aceptados; `v-12345678` → `V12345678`.

### R7 · Inyección de filtro PostgREST en `/api/clientes?q=`
- **Dónde:** `src/routes/api.js:47-54`.
- **Qué hacer:** restringir `q` a `^[A-Za-z0-9+\\- ]+$` antes de interpolar, o reemplazar `.or()` por dos consultas encadenadas con builders tipados del cliente JS (`.ilike()` en cada columna). Prioridad a los builders tipados (elimina la sintaxis string por completo).
- **Verificación:** `q=*`, `q=a|cond`, `q=..` devuelven 400 o resultados sin salto de filtro; `q=paracetamol 500mg` funciona.

### R8 · PII comiteada: sacar números reales y URL interna
- **Dónde:** `public/index.html:90,100,137,260`, `public/app.js:772`, `check-ctx.js:4`, `src/services/tools.js:357`.
- **Qué hacer:**
  1. Placeholders genéricos (`+34600000000` como ejemplo claro) o leer de configuración (p. ej. `config.defaultTestPhone`).
  2. `tools.js`: `enlace` desde config/entorno (`HANDOFF_URL`), no hardcodeada.
  3. `check-ctx.js`: mantener fuera de versionado (`.gitignore`) o parametrizar teléfono por CLI/env.
- **Verificación:** `git grep` de `+34` / patrones E.164 sobre el HEAD → sin coincidencias reales.

---

## P3 — Verificaciones manuales pendientes (antes de dar por cerrado)

### R9 · Historial git y drivers retenidos por el redactor
- **Acción manual requerida (no realizable por la sesión CSO por bug del helper):**
  1. Revisar `farmacia-sync/src/drivers/{mssql,mysql,postgres}.js` y `farmacia-sync/src/servidor/index.js`: buscar cadenas de conexión con credenciales en claro (`user`, `password`).
  2. Escanear el historial git en busca de secretos: `git log --all -p --oneline | findstr /i "KEY SECRET PASSWORD token api_key"` (Windows) o un pase de gitleaks/trufflehog desde Linux/WSL. Prioridad: ver si `MOSTRADOR_API_KEY`, `META_APP_SECRET` o `SUPABASE_SERVICE_ROLE_KEY` reales existieron en algún commit.
  3. Si aparece algo real → **rotar TODAS las claves** (Supabase service_role, Meta, Mostrador, Admin) y limpiar el history (`git filter-repo`).
  4. Confirmar `.env` raíz NO comiteado y añadir a `.gitignore` (`farmacia.env` es plantilla: marcarla como `.env.example`).

---

## Estado de cierre

| Id | Riesgo | Esfuerzo | Estado |
|----|--------|----------|--------|
| R1 | Crítico (XSS) | M | Pendiente |
| R2 | Alto | S | Pendiente |
| R3 | Alto | S | Pendiente |
| R4 | Alto | S | Pendiente |
| R5 | Alto | M | Pendiente |
| R6 | Medio | M | Pendiente |
| R7 | Medio | S | Pendiente |
| R8 | Medio | S | Pendiente |
| R9 | Manual | — | Pendiente |

Regla fija (de sesión CSO): **no desplegar hasta cerrar R1-R5** (bloqueantes) — y R9.3 si aparece material real en el historial. Confirmar con re-auditoría o recheck de CSO al terminar.