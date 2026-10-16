---
tipo: orquestacion
titulo: Plan de Orquestacion — Director de Orquesta
actualizado: 2026-10-13
tags: [orquestacion, plan, departamentos, d00, d01, d02, d03, d04, d05, d06]
departamentos: [D00-PM, D01-Backend, D02-Frontend, D03-QA, D04-Seguridad, D05-Release, D06-Flujos-IA]
---

# 🎼 Plan de Orquestación — CRM DFD (Director de Orquesta)

> **Rol del director (yo):** recibo tus pedidos → los convierto en tareas `#V{n}` → las **delego al departamento dueño** con prompt y criterio de salida → QA valida → Seguridad audita → Release decide si despliega. **NUNCA ejecuto sin tu OK** (regla de oro, la pusiste tú).

---

## 0 · Reparto de responsabilidades (quién hace qué — no se pisan)

| Sesión | Departamento | Alcance | ¿Commitea? | ¿Despliega? |
|--------|--------------|---------|-----------|-------------|
| **D01** | Backend / Engineering | API, bot, Supabase, middleware, motor de recomendación | No** | No |
| **D02** | Frontend / Diseño | Panel web, UX mostrador, caja recomendaciones, dashboards | No | No |
| **D03** | QA / Testing | Pruebas mostrador→venta→recomendación, regresiones, repro | No | No |
| **D04** | Seguridad | CHECK cédula, x-api-key, sanitización, auditoría, triaje | No | No |
| **D05** | Release | Versionado `#V{n}`, merges, changelog, **deploy** | **SÍ** (a `main`) | **SÍ — único** |
| **D00** | Project Manager / Arquitecto | Orden y arquitectura; prioriza `#V`; bóveda; **primera parada de casi toda tarea** | Sí (rama `dept/proyect-manager`) | No |
| **D06** | Flujos de IA / Especialista Chatbots | `src/prompts/`, intents, flujos, handoff, grounding | Sí (rama `dept/flujos-ia`) | No |

> **Nota (2026-10-13, D00/PM):** D01–D04 y D06 **sí commitean, pero solo a su rama `dept/*`** — a `main` solo entra por D05. Ver [[Ramas_por_Departamento]].

---

## 1 · Mapa de dependencias (QUÉ habilita QUÉ)

```
             #V30  Supabase BD ágil (base de datos no estructurada)
               │  ── es prerequisito ──►  #V29  recompra (necesita historial+preferencias)
               │  ── es prerequisito ──►  #V31  analítica (necesita datos cruzados)
               │  ── es prerequisito ──►  #V33  carrito abandonado (necesita carrito persistido)
               │  ── es prerequisito ──►  #V34  notas de voz / fotos (necesita historial chat ágil)
               │  ── es prerequisito ──►  #V35  sentimiento (necesita historial chat ágil)

#V28  estado de pedido/carrito = STANDALONE (no necesita #V30; sólo estado carrito en runtime)
#V32  WhatsApp Flows = STANDALONE (interfaz bot; no bloquea ni es bloqueado)

Orden de fase sugerido:
  FASE 1 (fundación)   → #V30
  FASE 2 (bot core)    → #V28 → #V33 → #V29
  FASE 3 (IA)          → #V34 → #V35
  FASE 4 (interfaz)    → #V32 → #V31
```

**Decisión de fase:** los `#V36–#V42` (mejoras opcionales V2x) quedan **congelados** — solo se entra a ellos cuando pides "abrir fase V2x". Son fidelización, triaje humano, omnicanal, estacionales, drip, cross-selling, etiquetado.

---

## 2 · Plan por pasos POR TAREA (prompt de cada agente + criterio de salida)

> **Cómo usar:** para encender una tarea me dices "lanza #V29". El director (yo) deja paso a tu OK y entonces D-se asigna el prompt. Formato de cada entrada: `▶ prompt` (lo que pega la sesión) + `✅ salida` (definición de hecho) + `🔀 depende de`.

---

### FASE 1 — FUNDACIÓN

**#V30 · Supabase BD ágil para datos no estructurados**
- **Dueño:** D01-Backend · **Revisa:** D04-Seguridad · **Valida:** D03-QA
- `▶ prompt D01:` "Tarea #V30: diseña en Supabase el esquema escalable para datos no estructurados (historial de chat + preferencias de producto). Decide `jsonb + índices GIN` vs tablas relacionales según volumen proyectado. Objetivo: consultas ultrarrápidas para el bot (< 300 ms). Entrégalo como migración SQL versionada + prueba de carga básica. No hagas cross-ing de vendas ni toques el frontend."
- `✅ salida:` migración aplicada en staging + benchmark de latencia documentado + punto de contacto con #V29/#V31/#V33/#V34/#V35.
- `🔀 requiere:` nada (es la base).

---

### FASE 2 — BOT CORE

**#V28 · Estados de orden en WhatsApp (carrito + resumen con disclaimer)**
- **Dueño:** D01-Backend · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V28: el bot debe responder con el **estado del carrito actual** si el cliente lo pide, y tras **verificar pedido**, enviar **resumen del carrito con disclaimer**: 'el monto total puede variar al momento del despacho por cambios en la tasa de cambio, etc.'. Implementa comando + endpoint de estado; cableá el disclaimer en el resumen."
- `✅ salida:` `GET /carrito/:ident/estado` + resumen con disclaimer en el texto del bot, probado en staging.
- `🔀 requiere:` nada (standalone).

**#V33 · Recuperación de carritos abandonados (2 h / 12 h)**
- **Dueño:** D01-Backend · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V33: detecta pedido iniciado no finalizado → cargo en Supabase (requiere #V30 o tabla plana primero) → disparador envíe mensaje amigable: '¿Olvidaste algo en tu carrito? Finaliza tu compra aquí' a las **2 h** y a las **12 h**. Evita spam: máx 2 avisos por carrito, no en horario nocturno."
- `✅ salida:` job programado + regla de no-repeat + carrito persiste entre sesiones.
- `🔀 requiere:` #V30 (persistencia) o tabla `carritos_abandonados`.

**#V29 · Alertas preventivas de recompra (tratamiento crónico / suplementos)**
- **Dueño:** D01-Backend · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V29: alerta cuando paciente esté **por agotar tratamiento crónico/suplementos** (según receta/historial) → mensaje con **recompra directa desde el mismo chat**. Herramienta sugerida: ActivePieces **si es la mejor opción; si no, propón la superior y cablea esa**."
- `✅ salida:` detección de fin de stock por fecha + botón/cadenena de recompra de 1 toque, validada para anti-alertas falsas.
- `🔀 requiere:` #V30 (historial de compra y dosis).

---

### FASE 3 — CAPA IA

**#V34 · Notas de voz + fotos de recetas médicas**
- **Dueño:** D01-Backend (IA) · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V34: el bot entiende **notas de voz** (transcripción) y **fotos de recetas** (OCR). Si no puede interpretar, **derivar a atención humana** (fallback). Usa Whisper/OCR según lo ya evaluado. Nunca inventes datos de una receta ilegible."
- `✅ salida:` transcripción/OCR funcional + fallback humano automático ante ilegibilidad + no-alucinación de dosis.
- `🔀 requiere:` #V30 (guardar historial) — parcial.

**#V35 · Análisis de sentimiento (frustración / confusión / urgencia)**
- **Dueño:** D01-Backend (IA) · **Revisa:** D04 · **Valida:** D03
- `▶ prompt D01:` "Tarea #V35: capa de IA que etiquete **frustración, confusión o urgencia** en texto/voz → etiqueta `prioridad roja` + **derivación a atención humana**. Cablea la etiqueta en `estado_chat` y alerta al panel."
- `✅ salida:` etiquetado automático + alerta en panel + escalado humano documentado.
- `🔀 requiere:` #V30 (historial), #V34 (voz).

---

### FASE 4 — INTERFAZ

**#V32 · WhatsApp Flows (catálogos / formularios piel / calendario asesoría)**
- **Dueño:** D02-Frontend · **Revisa:** D01 (API) · **Valida:** D03
- `▶ prompt D02:` "Tarea #V32: interfaces enriquecidas en el chat: **catálogo desplegable**, **formulario tipo de piel**, **calendario para agendar asesoría** — en vez de menús numéricos largos. Cablea con los endpoints de D01 y el motor de recomendaciones."
- `✅ salida:` flows renderizados en WhatsApp con datos reales del perfil, UX fluida en mostrador.
- `🔀 requiere:` #V28 (estado carrito), endpoints de recomendaciones.

**#V31 · Paneles de analítica visual (ventas × estacionalidad)**
- **Dueño:** D02-Frontend · **Revisa:** D01 (cruce datos) · **Valida:** D03
- `▶ prompt D02:` "Tarea #V31: dashboards interactivos que crucen **ventas con patrones estacionales** (ej: picos de antihistamínicos en primavera) → optimizar campañas y abastecimiento. Responsive, datos reales de Supabase (#V30)."
- `✅ salida:` dashboard con filtros de estacionalidad, legible en pantalla de farmacia, datos en vivo.
- `🔀 requiere:` #V30 (datos), #V31 necesita que D01 exponga el cruce.

---

### COLA ACTIVA (post-#V59, 2026-10-13) — definida por D00/PM

> **Estado (2026-10-13, D00/PM):** `#V56` **EN EJECUCIÓN** (D04) · `#V57` **PAUSADA** por el usuario · `#V63` y `#V64` **EN EJECUCIÓN** (lanzadas) · `#V65` **PLANIFICADA**. Cada tarea se implementa en su rama `dept/*` y **D05 integra**. Dueños: [[Ramas_por_Departamento]] · Backlog: [[En_Progreso]] §B4.
>
> **Orden (indicación del usuario, 2026-10-13):** se **pausa `#V57`** (D01) para liberar a Backend y atacar primero los 3 fallos de mostrador; se prioriza **`#V63` → `#V64`** (mismo dueño D01, serializadas) y luego **`#V65`**. `#V56` (D04) sigue **en paralelo** (independiente).
>
> **Actualización (2026-10-15, D00/PM) — diagnóstico en producción cerrado:** acceso SSH restablecido (era el **cortafuegos del Wi‑Fi de la universidad** tirando el puerto 22 saliente; la VM nunca estuvo caída: `uptime 30 días`, `sshd` active, `iptables` sin reglas). Con los **logs reales de la VM** quedó la causa raíz de los 3 fallos: `#V63` = schema `strict` de `recomendar_productos` sin `tema` en `required` (400 OpenAI → 503) · `#V64` = fix ya en `dept/backend` (`0a00cd5`) **sin mergear a `main`** · `#V65` sigue planificada. Extra: falta la tabla `public.auditoria` en Supabase (`[auditoria] Could not find the table 'public.auditoria'`). Detalle en las fichas de cada `#V` abajo.

**#V56 · Access-log + auditoría** (seguridad — cierre del ciclo abierto por #V59)
- **Dueño:** D04-Ciberseguridad · **Revisa:** D01-Backend · **Valida:** D03-QA
- `▶ prompt D04:` "Tarea #V56: con #V59 ya hay sesión+roles, pero no queda **rastro** de quién accede o muta qué. Diseña un **access-log/auditoría** append-only: tabla `audit_log` (actor, rol, acción, recurso, ip, user-agent, resultado ok/deny, timestamp) con **RLS on + REVOKE de anon/authenticated + GRANT a service_role** (patrón #V55). Escribe desde las rutas protegidas: login/logout (incluye intentos fallidos), CRUD de `usuarios`, mutaciones de la KB (crear/aprobar/rechazar), cierre/registro de venta. **Nunca** registrar secretos ni PII sensible: enmascara cédula/telefono. Entrega: migración SQL versionada + hook de escritura + `GET /api/auditoria?dias=N` (**gestor-only**) + política de retención. No toques el motor de IA."
- `✅ salida:` migración aplicada en la BD + hook cableado en rutas + endpoint gestor-only (401 sin sesión) + **advisors de seguridad 0 ERROR** + firma de D03 (QA) sobre login / mutación / denegación.
- `🔀 depende de:` **#V59** (sin sesión/roles no hay `actor` autenticado que auditar).

**#V57 · Endurecimiento de rendimiento del bot** (latencia) — ⏸️ **PAUSADA (2026-10-13)**
- **Dueño:** D01-Backend · **Revisa:** D06-Flujos-IA · **Valida:** D03-QA
- `▶ prompt D01:` "Tarea #V57: la QA de #V51–#V54 midió **p50 4.4 s / p95 6.8 s** — hay que bajarlo. (1) **Consolida en una sola RPC** la búsqueda de producto (hoy son varios round-trips); (2) **selecciona el modelo por intent** (los intents simples no necesitan el modelo grande); (3) **cachea** lo cacheable (ya existe el patrón en `bot_config`, #V51). Mide **antes/después** con la telemetría `bot_respuesta` y documenta p50/p95. **No** cambies la lógica de intents (`src/lib/intents.js`) ni fallback (`src/lib/fallback.js`) sin coordinarlo con D06 — su comportamiento es contrato de QA."
- `✅ salida:` RPC consolidada + routing de modelo por intent + benchmark p50/p95 antes/después documentado + baterías intents/fallback **en verde** (sin regresión).
- `🔀 depende de:` **#V51** (telemetría de latencia) y **#V52** (intents, para el routing por modelo).
- ⏸️ **PAUSADA (2026-10-13, orden del usuario):** se libera a D01 para resolver primero los fallos de mostrador `#V63`/`#V64`. Se retoma después.

**#V63 · Test del bot: diagnóstico + arreglo** (fallo de mostrador)
- **Dueño:** D03-QA (diagnóstico) + D01-Backend (arreglo) · **Revisa:** D04-Seguridad · **Valida:** D03-QA
- `▶ prompt D03:` "Tarea #V63: con la cuenta real reproduce el fallo del *Test del bot* y captura (1) el rol mostrado en `#userRol` (`public/app.js:41`), (2) el **status HTTP y el cuerpo** de `POST /api/bot/test` (browser/curl) y (3) `pm2 logs crm` en la VM. **Decisión del owner: el test es solo gestor** (no se amplía a operador), así que distingue el caso: (a) si entra como **operador** → el nav `test` está oculto (`public/app.js:46-49`) y el endpoint responde 403 → **no es bug de código**; hay que entregar credenciales de un gestor (bootstrap `ensureGestorInicial`, `src/server.js:86`); (b) si entra como **gestor** → el endpoint ya responde 503 claro ante fallo del asistente (`src/routes/bot.js:73-80`); reporta el log real (OpenAI/Supabase). Entrega: causa raíz + evidencia."
- `▶ prompt D01:` "Tarea #V63: **solo si** el diagnóstico de D03 arroja un fallo de **código** reproducible en el path del gestor, corrige `src/routes/bot.js:50-84` y/o `public/app.js:1817-1844`. NO toques el modelo de roles (el test sigue gestor-only)."
- `✅ salida:` causa raíz documentada; si era rol/credencial → gestor operativo; si era OpenAI/Supabase → corregido; repro del test en verde desde el panel.
- `🔀 depende de:` **#V59** (auth).
- 🔎 **CAUSA RAÍZ CONFIRMADA (2026-10-15, D00 — leída de los logs reales de la VM):** el *Test del bot* devuelve **503** porque OpenAI responde **400 `invalid_function_parameters`**: la tool `recomendar_productos` (`src/lib/openai-tools.json:112-129`, `"strict": true`) declara la propiedad `tema` (`["string","null"]`) pero **NO** la incluye en `required` (`["telefono_cliente"]`). En modo **`strict`** OpenAI exige que **toda** propiedad figure en `required` (los opcionales van como `null`). El 400 rompe `responderConAsistente` (`src/services/ai.js:283`) → `/api/bot/test` responde **503** (`src/routes/bot.js:84`). **Arreglo (1 línea):** `"required": ["telefono_cliente", "tema"]`. **Introducido por `#V56`** (`eb07954`) al añadir `tema` sin actualizar `required`. ⚠️ Afecta a **cualquier** turno que incluya esa tool (saludo/general/handoff), no solo al test → el bot real (WhatsApp) también falla. **D01:** aplicar el fix; **D03:** repro en verde; **D05:** desplegar. ✅ **SOLVENTADO Y EN PRODUCCIÓN (2026-10-15):** aplicado en `main` (`5f980be`) por D00 con GO del owner; auto-deploy verificado (VM en `469a62d`, `crm` online, `restart #46`, sin errores nuevos en `crm-error.log`).

**#V64 · Fix: «Error interno del servidor» al escribir en Conversaciones** (fallo de mostrador)
- **Dueño:** D01-Backend · **Revisa:** D04-Seguridad · **Valida:** D03-QA · **Apoya:** D02-Frontend (badge)
- `▶ prompt D01:` "Tarea #V64: `POST /api/bot/mensajes` (`src/routes/bot.js:86-112`) llama a `sendWhatsAppText` (`src/lib/meta.js:29`), que **lanza** si Meta rechaza (`meta.js:49-52`); sin try/catch → el handler global devuelve el 500 genérico (`src/server.js:80`) = «Error interno del servidor». Arregla: (1) si el hilo es **de prueba** (el último mensaje del teléfono tiene `canal==='test'`; viene en `getConversaciones`/`getConversacion`, `src/services/bot.js:62,107`) → **no llames a Meta**: graba `grabarMensaje(telefono,'operador',texto,'test')` y responde ok (así el flujo test↔conversaciones funciona de punta a punta); (2) en un fallo **real** de Meta (HTTPS/Graph) → graba igual el mensaje del operador y devuelve **502/503 con el error de Meta** (no el 500 genérico); (3) conserva el cambio de estado a `humano_activo` (líneas 93-106)."
- `▶ prompt D02:` "Tarea #V64: en el inbox de conversaciones marca las **de prueba** (badge «prueba») usando `mensajes.canal`, que `getConversaciones` ya devuelve (`public/app.js`, render de la lista `:1301`)."
- `✅ salida:` enviar en una conversación de prueba → ok sin tocar Meta; fallo real → mensaje claro (no 500); D03 verifica ambos casos.
- `🔀 depende de:` nada (independiente).
- 🔎 **ESTADO (2026-10-15, D00):** el arreglo **ya existe** en `dept/backend` → commit `0a00cd5` *fix(#V64): POST /api/bot/mensajes no filtra el fallo de Meta* (implementa exactamente (1) canal `test` sin llamar a Meta y (2) **502** con el error real de Meta). Pero **NO está en `main`** (`git merge-base --is-ancestor 0a00cd5 main` → falla) → **producción sigue devolviendo el 500**. Evidencia runtime: `[api] error interno: Error: (#131030) Recipient phone number not in allowed list` en `src/lib/meta.js:54`, disparado desde `src/routes/bot.js:118`. **Acción D05:** integrar `dept/backend` → `main` (o cherry-pick `0a00cd5`) y desplegar. ✅ **SOLVENTADO Y EN PRODUCCIÓN (2026-10-15):** cherry-pick de `0a00cd5` aplicado en `main` (`469a62d`) por D00 con GO del owner; deploy verificado junto con `#V63`.

**#V65 · Hábitos de consumo = tabla `cliente_habitos` (producto_id) + autofill del bot** (✅ DESPLEGADA 2026-10-15 — código en `main` `217b69c`; migración `v65_cliente_habitos` `20261016005132` aplicada en prod; QA pendiente)
- **Dueño:** D01-Backend + D02-Frontend + D06-Flujos-IA · **Revisa:** D04-Seguridad · **Valida:** D03-QA
- `▶ prompt:` "(D01) migración `cliente_habitos(telefono_cliente → clientes(telefono), producto_id → productos(id), PK compuesta, RLS service_role)`; el alta/upsert de cliente (`src/routes/api.js:141-143`) acepta `habitos: [producto_id]` validados contra `productos` activos y reemplaza filas del join; `registrarHabitosConsumo` (`src/services/customers.js:165`) hace **upsert** desde `carritos_temporales` al `'pedido'` (`src/services/tools.js:413,471`); las recomendaciones (`src/services/customers.js:256-273`) leen del join. (D02) selector **multi-producto** (autocompletar reusando `fuzzyScore`, `public/app.js:1015`, sobre `GET /api/productos`) en el alta (`public/index.html:245-246`, `public/app.js:1899`) y en el perfil (`public/app.js:993,1113-1145`). (D06) `HABITOS_CONSUMO` del prompt (`src/services/ai.js:84,92`) desde el join. Migración de datos best-effort del texto legacy (columna queda como solo-lectura); la escritura en prod la ejecuta el owner con GO."
- `✅ salida:` alta/edición de clientes **solo** con productos del catálogo; el perfil del bot nace con nombre+teléfono+hábitos de lo comprado; recomendaciones por hábito desde el join; QA en verde.
- `🔀 depende de:` nada (independiente).
- 🔎 **ESTADO (2026-10-15, D00):** código + migración **implementados en `main` (worktree `CRM-DFD`, sin commitear)**. Cambios:
  - (1) **`sql/migracion-v65-cliente-habitos.sql`** (nuevo): tabla `cliente_habitos(telefono_cliente → clientes(telefono), producto_id → productos(id), origen CHECK `manual|compra|legacy`, creado_en, PK compuesta)` + índice; **DROP de las vestigio-huérfanas `clientes_habitos`/`habitos_consumo`** (0 filas, sin uso en código/funciones/vistas); migración best-effort del texto legacy (`regexp_replace` quita prefijo `Nx `, match por nombre); RLS `service_role`. Idempotente.
  - (2) **`src/services/customers.js`**: `getClienteHabitos(telefono)` + `setClienteHabitos(telefono, productoIds, origen='manual')` (valida contra productos **ACTIVOS**); `registrarHabitosConsumo` **reescrita** (upsert idempotente `origen='compra'` desde `carritos_temporales` + `ventas`); `getRecomendaciones` lee del join (se eliminó la lectura del texto `ILIKE`).
  - (3) **`src/routes/api.js`**: `UUID_RE` a nivel módulo; `CLIENTE_SELECT` incluye `cliente_habitos ( producto_id, origen, productos ( nombre ) )`; helpers `conHabitos`/`fetchClienteConHabitos`; `GET /api/clientes[/:ident]` exponen `habitos`; **`PUT /api/clientes` acepta `habitos: [producto_id]`** (UUID validado) → `setClienteHabitos` + re-lectura + auditoría campo `'habitos'`; auto-alta de hábitos en `POST /ventas` y `POST /carritos/:id/pagar`.
  - (4) **`src/services/ai.js`**: `buildAdditionalInstructions` ahora **async**, lee `HABITOS_CONSUMO` del join (fallback al texto legacy) y se **await** en la llamada.
  - (5) **Frontend**: selector **multi-producto con chips + autocompletado** (`fuzzyScore`) en el alta (`public/index.html` → `#habitosForm`) y en el perfil (`#perfilHabitos`), **sin texto libre**; `public/app.js` (factory `crearSelectorHabitos`, submit, `renderPerfil`, `guardarPerfil`, `fichaDatosInternaHtml`); `public/styles.css` estilos `#V65`.
  - **Decisión del owner (2026-10-15):** el selector ofrece **todo el catálogo activo** (no solo lo comprado) para evitar texto aleatorio; los productos comprados se **auto-añaden** como hábitos (`origen='compra'`) y quedan **editables**. Cliente nuevo sin compras se crea igual (puede quedar en blanco). *(Revierte el "solo productos comprados" del borrador previo.)*
  - Verificado: `node --check` **ALL_OK** en los 4 archivos + `require()` smoke OK. **✅ APLICADA Y DESPLEGADA (2026-10-15, con GO del owner):** migración `v65_cliente_habitos` (versión `20261016005132`) aplicada en Supabase; verificada por SQL (`cliente_habitos` existe, vestigios eliminados, 2 filas legacy migradas, RLS on). Código commiteado y pusheado a `main` (**`217b69c`**) → auto-deploy; verificado en la VM: `~/crm` en `217b69c`, `crm` **online** (restart #48), `health` 200, `crm-error.log` sin escrituras desde el reinicio, y `openai-tools.json` con el fix de `#V63`. **QA (D03) pendiente de correr.**

**Siguiente en cola (sin `#V` aún, las numera D05 al lanzarlas):** FEFO por lotes (D01) · recomendaciones + perfil de consumo + `categoria_id` (D06 + D02).

---

## 3 · Flujo de GO/No-GO (cuándo algo SÍ se ejecuta)

```
[Tú] "lanza #V29" ──► [Director] agenda la tarea en [[En_Progreso]] con estado "EN COLISION: D01"
      │
      ├─► D01 la implementa (su promp está arriba) ──► D03-QA la prueba
      │
      ├─► D04 la audita (seguridad/cumplimiento) ⓘ si es fármaco/receta → triaje
      │
      └─► D05-Reloase versiona #V29 → changelog → decide despliegue ──► tu visto bueno final
```

**Regla de oro (inalterable):** mientras una tarea esté en `[[En_Progreso]]` con etiqueta `SIN EJECUTAR`, ni D01 ni D02 la tocan. Solo el director (yo), con tu `lanza #V{n}`, la coloca en "EN COLISIÓN" y recién ahí los agentes trabajan.

---

## 4 · Próximo paso (esperando tu orden)

**Cola activa hoy (2026-10-15, tras el diagnóstico D00):** `#V56` (D04, **en ejecución**) · `#V57` (D01, **PAUSADA**) · `#V63` (D03+D01, ✅ **RESUELTO Y EN PRODUCCIÓN** `5f980be`) · `#V64` (D01+D02, ✅ **RESUELTO Y EN PRODUCCIÓN** `469a62d`) · `#V65` (D01+D02+D06, ✅ **EN PRODUCCIÓN** `217b69c` + migración `v65_cliente_habitos`; QA pendiente). Las fases #V28–#V35 siguen abiertas aparte. 🎼
