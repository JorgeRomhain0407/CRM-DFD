---
tipo: pendientes
actualizado: 2026-10-07
tags: [progreso, pendientes, backlog, mejoras, versiones-futuras]
---

# En Progreso — Pendientes por entregar + Mejoras de versiones futuras

> **Regla de oro (la puso el usuario):** aquí SOLO se **registran** tareas. **No se implementan** hasta que él lo pida explícitamente. Mientras estén en esta página son ideas/cableado pendiente.
> **Cómo cerrar un ítem:** él entrega la tarea → yo la muevo a [[Estado_Actual]] a la sección "En curso/Hecho" con su `#V{n}` → él la aprueba en la siguiente sesión.
> La cédula (`#V25` CHECK) **ya la corrió el usuario con Success** → ese CHECK está DESPLEGADO, no es pendiente.

---

## A · TAREAS PENDIENTES — ENTREGADAS POR EL USUARIO (registradas, NO implementadas)

> Estas son las 8 que él me indicó hoy. Están **numero #V28…#V35**. **Quedan AQUÍ como registro; no se tocan hasta pedirlo.**

| # | Tarea (tal como la entregó) | Impacto | Departamento |
|---|-----------------------------|---------|--------------|
| **#V28** | **Estados de orden en WhatsApp**: que el bot responda con el **estado del carrito actual** si el cliente lo solicita; y **una vez verificado el carrito**, enviar **resumen del mismo con disclaimer**: "el monto total puede variar al momento del despacho por cambios en la taza de cambio, etc." | Alto | Backend + Bot |
| **#V29** | **Alertas preventivas de recompra**: disparar aviso cuando un paciente esté **por agotar su tratamiento crónico o suplementos**, permitiendo **recompra directa desde el mismo mensaje de WhatsApp**. (Sugerencia: ActivePieces, o mejor opción si la hay.) | Alto | Backend + Bot |
| **#V30** | **Gestión ágil de BD no estructurada (Supabase)**: historial de chat + preferencias de producto, **escalable y con tiempos de respuesta ultrarrápidos para el bot** | Medio | Backend / BD |
| **#V31** | **Paneles de analítica visual**: dashboards interactivos que crucen **ventas con patrones estacionales** (ej: picos de antihistamínicos en primavera) para optimizar campañas de marketing y abastecimiento | Medio | Panel / Frontend |
| **#V32** | **WhatsApp Flows**: interfaces enriquecidas en el chat (catálogos desplegables, formularios de tipo de piel, calendario para agendar asesoría) en lugar de comandos largos / menús numéricos | Medio | Bot / Frontend |
| **#V33** | **Recuperación de carritos abandonados**: detectar pedido iniciado y no finalizado → mensaje amigable a las 2 h / 12 h ("¿Olvidaste algo en tu carrito? Finaliza tu compra aquí") | Medio-Alto | Backend + Bot |
| **#V34** | **Notas de voz y fotos de receta**: que el bot entienda notas de voz y fotos de recetas médicas; si no puede, **derivar a atención humana** | Alto | Bot / IA |
| **#V35** | **Análisis de sentimiento**: capa de IA que detecte frustración / confusión / urgencia en texto o voz → etiqueta "prioridad roja" y **derivación a atención humana** | Alto | Bot / IA |

---

## B · MEJORAS OPCIONALES — PRÓXIMAS VERSIONES (NO se ejecutan hasta pedirlo)

> Las 7 que él listó como "posibles mejoras pendientes / versiones futuras". **Solo registro.**

| # | Mejora | Detalle |
|---|--------|---------|
| **#V36** | **Programa de fidelización (puntos)** | Asignar puntos por compras de parafarmacia / vitaminas / dermocosmética; saldo en el perfil del cliente para **descuentos automáticos** en su próxima interacción |
| **#V37** | **Triaje y escalado humano** | Que la IA detecte síntomas complejos o **interacciones medicamentosas** y derive a **farmacéutico colegiado** inmediatamente (seguridad sanitaria) |
| **#V38** | **Consolidación omnicanal (Meta Business Suite)** | Centralizar atención integrando **Instagram y Facebook Messenger**; perfil de usuario unificado en el CRM |
| **#V39** | **Campañas estacionales predictivas** | Segmentar perfiles por hábitos → difusiones personalizadas (ej: **protectores solares en verano** para quien compró dermocosmética; **vitaminas en otoño** según historial del año anterior) |
| **#V40** | **Secuencias de nutrición (Drip Campaigns)** | Al detectar compra de tratamiento continuo / kit, programar **mensajes educativos espaciados** con consejos de uso (posiciona la farmacia como asesora de bienestar) |
| **#V41** | **Venta cruzada inteligente (Cross-selling)** | Al cerrar el carrito, sugerir complementario según perfil (ej: champú anticaída → ampollas complementarias con 10% dto.) |
| **#V42** | **Etiquetado dinámico de clientes** | Auto-etiquetas por clics/consultas (ej: "Comprador frecuente", "Interesado en Skincare", "Solo promociones") para retargeting futuro |

---

## B2 · PROPUESTAS D06 — AUDITORÍA DEL BOT (2026-09-22) · ESTADO: #V43–#V47 CERRADAS (código), QA D03 + release D05 pendientes

> Auditoría completa en [[Auditoria_Bot_D06_2026-09-22]]. Cierre de las cinco en 2026-10-01 con OK del usuario.

| # | Tarea | Impacto | Departamento |
|---|-------|---------|--------------|
| **#V43** | **Contexto de conversación correcto**: últimos N mensajes (no los primeros 30), sin duplicar el mensaje del usuario, mensajes del operador visibles al LLM, aplicar `temperatura` real | Alto | D01 + D06 + D03 |

> **✅ #V43 — IMPLEMENTADA (2026-09-22) y VALIDADA en QA runtime D03 (2026-10-07, v32.0.0 desplegada); release D05 pendiente.**
> Cambios en `src/services/ai.js`: (1) `getHistorial` ahora toma los **últimos** 30 mensajes (order desc → reverse) e incluye el rol `operador` prefijado como contexto humano; (2) eliminado el `push` duplicado del mensaje del usuario (llega ya grabado por webhook/panel); (3) `bot_config.temperatura` aplicada a ambas llamadas de `openai.responses.create`. Verificación estática `node --check` OK. Prueba funcional pendiente: servidor + Supabase (run-tests.js) — tarea D03.
| **#V44** | **Respuesta de contingencia ante fallos**: nunca dejar al cliente sin respuesta (mensaje breve + alerta al mostrador) | Alto | D01 + D06 + D03 |

> **✅ #V44 — CERRADA y VALIDADA en QA runtime D03 (2026-10-07, v32.0.0 desplegada: 503 claro con OpenAI roto); release D05 pendiente.**
> Cambios: (1) `src/services/telegram.js`: nueva `notifyAlerta({telefono, error})` (sin markdown para no romper parseo con texto de error); (2) `src/routes/webhook.js`: `obtenerRespuestaBot()` captura cualquier fallo del LLM → mensaje al cliente (`MSJ_CONTINGENCIA`, ofrece reintentar o pedir a una persona) + alerta Telegram (fail-soft) + graba el mensaje como asistente; antispam de 5 min por cliente (mapa en memoria; reintentos del mismo mensaje ya deduplicados por `claimWebhookEvent`); el handler externo también dispara `notifyAlerta` si falla algo fuera de esa función (envío/grabación); (3) `routes/bot.js` POST `/test`: fallo del LLM → `503` con texto claro para el panel en vez del 500 genérico. Cobertura: OpenAI/Supabase/Meta → alerta al mostrador SIEMPRE. Con #V47, los fallos del LLM además generan evento `tool_call`/mensaje según punto: trazabilidad completa.
| **#V45** | **Handoff robusto**: enlace real al panel (`PANEL_URL` ya operativo con HTTPS público), acuse único al cliente, timeout de espera con re-alerta | Alto | D01 + D06 + D03 |

> **✅ #V45 — CERRADA y VALIDADA en QA runtime D03 (2026-10-07, v32.0.0 desplegada: acuse determinista + re-alerta única); release D05 pendiente.**
> Cambios: (1) `src/config.js`: `PANEL_URL` (fallback local) y `HANDOFF_ALERTA_MINUTOS` (30) — añadidas a `.env` y `.env.example`; (2) `src/services/tools.js`: enlace de `notifyHandoff` = `config.panelUrl` (antes `localhost` roto en producción); (3) `src/services/ai.js`: handoff por herramienta → **acuse determinista** `ACUSE_HANDOFF` del servidor (1 sola vez, corta el bucle de OpenAI; el texto no depende del modelo); la guardia #V46 tiene su propio acuse y corta antes; (4) `src/services/handoff-timeout.js` (nuevo; `server.js` con `unref()`): job 1/min — `esperando_operador` sin atención tras ≥X min → re-alerta Telegram con motivo y antigüedad; "ya re-alertado" en memoria keyed por `silenciado_desde` (tras restart a lo sumo duplica 1 re-alerta; persistencia queda natural para los eventos de #V47). QA D03 ejecutado (2026-10-07): handoff LLM → acuse único ✅; handoff guardia → acuse del guardia ✅; 2 h sin atender → 1 sola re-alerta Telegram real ✅. El enlace del acuse ya apunta a la URL pública HTTPS (`PANEL_URL` configurado en la VM).
| **#V46** | **Guardia sanitaria determinista server-side**: patrones de receta/posología/emergencia fuerzan handoff sin depender del LLM | Alto (seguridad) | D06 + D01 + D04 + D03 |

> **✅ #V46 — IMPLEMENTADA (2026-09-22), VALIDADA en QA runtime D03 (2026-10-07) y ampliada por #V48; release D05 pendiente.**
> Cambios: (1) nuevo módulo `src/lib/guardia-sanitaria.js` — 4 categorías (urgencia / posología / interacción / clínica: embarazo, lactancia, reacción adversa, receta) con acuses breves en español; (2) interceptor en `webhook.js` ANTES del LLM: si activa → `solicitar_asistencia_humana` (Telegram incluido) + acuse grabado y enviado + return (bot silenciado por estado); (3) espejo en `routes/bot.js` POST `/test` para reproducibilidad de QA sin webhook real; (4) batería sin BD: `node scripts/test-guardia-sanitaria.js` → **21/21 pasan** (incluye casos negativos de venta normal, evita falsos positivos). Nota de diseño: la categoría es solo la etiqueta del motivo; el handoff se activa igual en cualquier dirección segura. Verificación end-to-end D03 ejecutada (2026-10-07): `guardia=true` sin LLM → `esperando_operador` + mensaje en BD ✅. Batería ahora **23/23** tras #V48.
| **#V47** | **Aplicar/verificar capa de eventos #V30 en disco**: `cliente_eventos`, RPCs, `perfil`/`contexto_bot` JSONB — **CERRADA** | Alto (prerrequisito) | D01 + D04 + D03 |

> **✅ #V47 — CERRADA por dos vías complementarias (F1/F2 v31.0.0 + cableado D06 `ad77db3`).**
> **(A) Release a producción (F1/F2, v31.0.0):** la capa llegó a disco y a la VM — `0a742d8` + `3cc9811` desplegados; backfill real `total=3 ok=3 errores=0`; **bench desde la VM de producción: n=50 p50=60.8ms p95=118.5ms → META p95<300ms CUMPLE**; `cliente_eventos` devolviendo filas en vivo (hook capturando mensajes reales); 3 clientes con `perfil` JSONB poblado; fix de seguridad `sql/fix-rls-lotes.sql` (`779d123`, Advisor CRITICAL → 0).
> **(B) Resolución de la discrepancia + cableado src (D06):** la capa **SÍ estaba desplegada en la BD de producción** (RPCs verificadas en vivo: `registrar_evento_cliente` responde al CHECK de tipos — sondeo con tipo inválido devuelve violación de constraint y NO inserta; `contexto_cliente_snapshot` devuelve `{estado, cliente, eventos}`); lo que faltaba era cablear `src` y versionar el SQL. Hecho:
> 1. `src/services/cliente-contexto.js` (canónico): `registrarEvento` vía RPC fail-soft + `registrarMensaje` (evento `mensaje_*` + ventana rodante `contexto_bot`, límite 20, contenido recortado a 160 chars) + `registrarTool`/`registrarProductoVisto`/`registrarCarrito`/`registrarCompra`/`registrarHandoff` + `snapshotContexto` (unión D05 en el merge de v32.0.0). Anti-PII: payload solo canal/chars/flags/ids/longitudes; texto del cliente NUNCA va a eventos.
> 2. Cableado: `services/bot.js::grabarMensaje` (hook fire-and-forget: cubre los 3 roles y todos los canales) · `services/ai.js` (`tool_call` + `producto_visto`) · `services/tools.js` (`carrito_accion` al agregar/cambiar estado, `compra` al formalizar pedido, `handoff`).
> 3. Versionado de la estructura en repo: `sql/migracion-cliente-eventos.sql` (idempotente: cada objeto se crea SOLO si falta — no pisa nada desplegado; GRANT solo a `service_role`, sin REVOKE-ALL global que rompa otras RPCs) + `scripts/backfill-v30.js` (perfil desde hábitos/edad) + `scripts/bench-v30.js` (p95 del snapshot, meta <300 ms).
> 4. Smoke real contra BD: evento `tool_call` escrito y releído ✅ · batería guardia 21/21 ✅ · `node --check` OK en todo. El bench desde Windows local dio media 193 ms / p95 337 ms (RTT local) — la medición válida es la de la VM de producción, donde corre el bot: **118.5 ms CUMPLE** (punto A).
> 5. **Sonda de contrato (D06, 2026-10-01):** los **8/8 tipos** que emite `cliente-contexto.js` (`mensaje_usuario/asistente/operador`, `tool_call`, `producto_visto`, `carrito_accion`, `compra`, `handoff`) insertan sin error contra el CHECK y el FK **reales de producción**, y el CHECK sigue rechazando un tipo inválido (`23514`). Esto importa porque `registrarEvento` es **fail-soft**: un tipo no aceptado se perdería en silencio, sin log. Filas de sonda borradas después (tabla queda en 20).
| **#V36** | **Programa de fidelización por puntos**: toda compra acumula (base `precio_usd`) + bonus en categorías curadas; canje de recompensas desde el panel | Medio | D06 + D03 + D05 |

> **⏳ #V36 — IMPLEMENTADA (2026-10-02); migración SQL aplicada (2026-10-07), pendiente validar acumulación/canje/caducidad con el programa activo.**
> Cambios: (1) `sql/migracion-fidelizacion.sql` — 4 tablas (`fidelizacion_config`/`categorias`/`recompensas` + libro mayor `puntos_movimientos`) y 6 RPC `SECURITY DEFINER` con `GRANT` solo a `service_role`. **`activo` arranca en FALSE**: hasta que el operador lo active, las compras no acumulan. (2) `src/services/fidelizacion.js`: fail-soft (una compra nunca se cae si el programa falla) + aviso único en log si falta la migración. (3) Cableado del acumulador en las 2 vías de venta: `routes/api.js` (mostrador) y `services/tools.js::actualizarEstadoPedido` (WhatsApp), ambas con `referencia` idempotente. (4) Herramienta de bot `consultarPuntos` + instrucción en `system.txt` (ya sincronizado a `bot_config`). (5) **Nuevo apartado "Fidelización" en el panel**: reglas del programa, CRUD de recompensas/ofertas (crear, editar, desactivar, borrar), consulta de puntos de un cliente, canje con descuento en Bs o %, y ajuste manual de puntos. Atajo `g+f`.
> Puntos que importan: (a) el bonus sale de `bonificacion_categoria` de la config — la tabla de categorías solo decide **quién** tiene bonus (multiplicador propio opcional, `NULL` = usa la config); (b) `FOR UPDATE` sobre `clientes(telefono)` en acumular/canjear/ajuste: sin él, dos compras simultáneas del mismo cliente grababan un `saldo_despues` erroneo; (c) el RPC es la única fuente de saldo (el libro mayor es append-only con `UNIQUE (telefono, tipo, referencia)`); (d) todo paso por el helper `rpc()` de `lib/supabase`, que **lanza** — con `sb.rpc()` a pelo se recibía el sobre `{data,error}` y una migración sin aplicar parecía "0 puntos" con el programa activo.
> Verificado: `node scripts/test-fidelizacion.js` → **18/18** (aritmética + fail-soft sin BD) · guardia sanitaria **23/23** sin regresión · `node --check` en los 5 archivos · `openai-tools.json` válido · **panel probado en navegador real (2026-10-07)**: `GET /api/fidelizacion-config` → 200 con config, 2 recompensas sembradas, consulta de cliente y canje cargan, cero 4xx/5xx y cero errores de consola.
> **2026-10-07:** migración aplicada en producción (config real + seeds, `activo=FALSE`); PUT parcial de config corregido (PostgREST resuelve el RPC por firma exacta, así que `setConfig` ahora funde los campos enviados con la config actual — antes devolvía **500**); las rutas desconocidas de `/api/*` responden **404 en JSON con método + ruta**, para que el banner del panel diga qué pidió en vez de un "HTTP 404" mudo.
> **2026-10-07 — Validación funcional con programa ACTIVO: 39/39 ✅** (script propio contra servidor local + BD real, todo restaurado al final). Cubre: inactivo no acumula · activar + vigencia 30d · asignar categoría desde el panel · **puntos exactos 1x y 2x** (750 + 900 = 1650) · idempotencia de acumulación y de canje · espejo `clientes.perfil.puntos` · GET de saldo con recompensas · canje en Bs y en % (con `monto_pedido` obligatorio y tope sin recortar) · errores `cliente_no_existe`/`recompensa_invalida`/`minimo_no_alcanzado`/`puntos_cero`/`saldo_insuficiente` · **caducidad** (asiento vencido → `caducados=1650`, canjeable excluye, canje bloqueado) · restauración completa de config, categoría de producto y clientes de prueba (libro mayor limpio).
> **Pendiente:** decidir si el operador activa el programa desde el panel (hoy `activo=FALSE`) y etiquetar productos en categorías curadas — **ningún producto tiene `categoria_id` todavía, así que el bonus 2x no se aplica a ninguna venta real**.

### Validación funcional D03-QA — EJECUTADA (2026-10-07, v32.0.0 desplegada en VM) ✅
> Batería E2E contra instancia local + BD real con el teléfono de pruebas `+34900000088` (canal `test`). Resultado: **6/6 en verde**.
- **#V43 operador visible al LLM ✅** — mensaje `rol=operador` insertado → el bot respondió citando a la operadora y el producto («Marta» + «paracetamol»).
- **#V44 contingencia ✅** — instancia con `OPENAI_API_KEY` rota → `POST /api/bot/test` devolvió **503 con texto claro** (no 500 genérico), proceso sin crash.
- **#V45 handoff LLM ✅** — «quiero hablar con una persona» → `ACUSE_HANDOFF` determinista + `estado_chat=esperando_operador`.
- **#V45 timeout ✅** — `silenciado_desde` backdated 2 h + 2 pasadas de `revisarHandoffs()` → **1 sola re-alerta Telegram real** (dedupe por episodio: 1ª=1, 2ª=1).
- **#V46 guardia determinista ✅** — «¿qué dosis de paracetamol le doy…?» → `guardia=true` + acuse clínico + `esperando_operador` (sin LLM).
- **#V30 espejo ✅** — secuencia real en BD: `mensaje_usuario → handoff + tool_call → mensaje_asistente`.
- **⚠️ HALLAZGO D03 → APLICADO como #V48 (2026-10-07, con OK del owner):** «¿Cuánto ibuprofeno le puedo dar a mi hijo de 5 años?» **NO matcheaba** ninguno de los 7 patrones de posología → la frase pasaba al LLM, que SÍ derivó a humano (capa 2 funcionó), pero una frase tan natural de cliente real no debe depender del modelo. Añadido patrón conservador `/cu[áa]nto\b[^.?!]{0,40}\b(?:puedo|puede|podr[íi]a|debo|debe)\s+(?:dar(?:le)?|tomar(?:me)?)\b/i` + caso positivo (la frase de evidencia) y caso negativo de protección («¿cuánto cuesta el ibuprofeno que suelo tomar?») en la batería → **23/23**. Pendiente: despliegue en VM para que la capa determinista actúe en producción.
- Nota: la alerta por fallo en el **webhook real** (firma HMAC → `notifyAlerta`) queda cubierta por `notifyAlerta` probado E2E (arriba) + revisión estática de D06; el ejercicio 100% real requiere un evento Meta auténtico.

---

## B3 · #V50 — SYNC DEL TPV: DÓNDE CORRE (diagnóstico 2026-10-07)

> **Diagnóstico (evidencia).** `farmacia-consumidor` corre en la VM de GCP (pm2, ~19 días, 4 restarts) y **falla cada 15 min con `fetch failed`**: llama a `http://localhost:4000/productos` (`farmacia-sync/src/consumidor/sync.js:7,13`) y **no hay servidor** en la VM (nada escuchando en el 4000). El servidor `farmacia-sync` sí arranca en la VM y `/health` da 200, pero `/productos` → `500 Driver de base de datos no soportado: "undefined"`: el `.env` de la VM (406 B, 15 sep) solo tiene claves de consumidor (`CRM_SYNC_*`, `SUPABASE_*`) y **no hay `FARMACIA_SYNC_DB_*`**. La BD SOINFARMA no es alcanzable desde GCP: el único `.env` real (local) apunta a `mssql/SOINFARMA @ 127.0.0.1:1433` y en la máquina local no hay SQL Server ni listener 1433 ni túnel SSH (revisado: sin `~/.ssh/config`, `known_hosts`, historiales, PuTTY/Termius/WinSCP ni WSL). `farmacia.env` trackeado es **plantilla** (`sqlite`/`localhost`, secretos vacíos → sin fuga de credenciales ✅). El "puente" existente es solo `ecosystem-farmacia.config.js` (config de pm2, no un túnel).

> **✅ #V50 — VALIDADA end-to-end (2026-10-07): sync real en el PC de la farmacia.** El "puente" era `farmacia-tunel.cmd` (SSH **inverso** `-R` del PC → VM publicando `localhost:4000`), que estaba caído — de ahí los 19 días de `fetch failed`. Arquitectura elegida: **B (todo en el PC de la farmacia)**, sin túnel. Resultado: servidor reiniciado con código de `main` (perfil `soinfarma`, `lotesActivo=true`) → `recibidos 4094 productos / 4573 lotes` → **`sincronizados 4094/4094 productos (0 errores) y 4433/4433 lotes (0 errores)`** (140 huérfanos descartados por el filtro). Verificado en Supabase: 4094 productos con `marca` (antes 0), 4417 lotes únicos con `fecha_vencimiento` al 100% (antes 3), `precio_usd` poblado. La copia del PC se actualizó con el ZIP de `main` (ese PC no tiene git).
> **✅ Persistencia resuelta (2026-10-07):** pm2 en el PC de la farmacia con `farmacia-sync` + `farmacia-consumidor` **ambos online**, `pm2 save` hecho y script `pm2-farmacia.cmd` en la carpeta de **Inicio** de Windows que ejecuta `pm2.cmd resurrect` al iniciar sesión (elegido frente a `pm2-windows-startup`, que no quedaba en PATH). Sync automático cada 15 min; verificado tras el arreglo: `/health` 200 y `sincronizados 4094/4094 productos + 4433/4433 lotes (0 errores)`.
> **✅ Túnel archivado (2026-10-07):** confirmación B dada; `farmacia-tunel.cmd` renombrado a `farmacia-tunel.cmd.obsolete` en el PC de la farmacia (el consumidor ya estaba borrado de la VM: `pm2 delete` + `pm2 save`).
> **✅ Limpieza de huérfanos ejecutada y verificada (2026-10-07):** el usuario corrió el SQL en el editor de Supabase (respaldo `productos_huerfanos_bak_20261007` con 224 filas + `UPDATE productos SET activo=FALSE WHERE marca IS NULL`). Verificación con `service_role` post-ejecución: **4094 activos / 224 inactivos / respaldo 224 / lotes 4417**. Soft-delete en vez de DELETE porque `ventas`/`carritos_temporales` referencian `productos(id)` con `ON DELETE RESTRICT`; el upsert del TPV reactiva `activo=TRUE` si un producto vuelve al catálogo, y bot/panel filtran `activo=true` (`api.js:35`, `tools.js:95`) → los huérfanos desaparecen del bot. **#V50 CERRADA.** Backlog restante del frente: lotes **vencidos con stock > 0** (ej. venc. 2001/2020) que FEFO pondrá el último — limpieza en el TPV.

---

## C · CÓMO SE ACTUALIZA
- Al recibir una entrega tuya → la muevo de aquí a [[Estado_Actual]] §"En curso" asignando `#V{n}` y **cableo/implemento solo lo que pidas**.
- Lo que NO pidas queda **documentado aquí como backlog de versión futura** (#V36…#V42).
