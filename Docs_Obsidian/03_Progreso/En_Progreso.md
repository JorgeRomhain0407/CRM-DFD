---
tipo: pendientes
actualizado: 2026-09-08
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

> **⏳ #V43 — IMPLEMENTADA (2026-09-22), pendiente de validación D03-QA + release D05.**
> Cambios en `src/services/ai.js`: (1) `getHistorial` ahora toma los **últimos** 30 mensajes (order desc → reverse) e incluye el rol `operador` prefijado como contexto humano; (2) eliminado el `push` duplicado del mensaje del usuario (llega ya grabado por webhook/panel); (3) `bot_config.temperatura` aplicada a ambas llamadas de `openai.responses.create`. Verificación estática `node --check` OK. Prueba funcional pendiente: servidor + Supabase (run-tests.js) — tarea D03.
| **#V44** | **Respuesta de contingencia ante fallos**: nunca dejar al cliente sin respuesta (mensaje breve + alerta al mostrador) | Alto | D01 + D06 + D03 |

> **✅ #V44 — CERRADA (2026-10-01; QA runtime D03 + release D05 pendientes).**
> Cambios: (1) `src/services/telegram.js`: nueva `notifyAlerta({telefono, error})` (sin markdown para no romper parseo con texto de error); (2) `src/routes/webhook.js`: `obtenerRespuestaBot()` captura cualquier fallo del LLM → mensaje al cliente (`MSJ_CONTINGENCIA`, ofrece reintentar o pedir a una persona) + alerta Telegram (fail-soft) + graba el mensaje como asistente; antispam de 5 min por cliente (mapa en memoria; reintentos del mismo mensaje ya deduplicados por `claimWebhookEvent`); el handler externo también dispara `notifyAlerta` si falla algo fuera de esa función (envío/grabación); (3) `routes/bot.js` POST `/test`: fallo del LLM → `503` con texto claro para el panel en vez del 500 genérico. Cobertura: OpenAI/Supabase/Meta → alerta al mostrador SIEMPRE. Con #V47, los fallos del LLM además generan evento `tool_call`/mensaje según punto: trazabilidad completa.
| **#V45** | **Handoff robusto**: enlace real al panel (hoy `localhost` roto), acuse único al cliente, timeout de espera con re-alerta | Alto | D01 + D06 + D03 |

> **✅ #V45 — CERRADA (2026-10-01; QA runtime D03 + release D05 pendientes).**
> Cambios: (1) `src/config.js`: `PANEL_URL` (fallback local) y `HANDOFF_ALERTA_MINUTOS` (30) — añadidas a `.env` y `.env.example`; (2) `src/services/tools.js`: enlace de `notifyHandoff` = `config.panelUrl` (antes `localhost` roto en producción); (3) `src/services/ai.js`: handoff por herramienta → **acuse determinista** `ACUSE_HANDOFF` del servidor (1 sola vez, corta el bucle de OpenAI; el texto no depende del modelo); la guardia #V46 tiene su propio acuse y corta antes; (4) `src/services/handoff-timeout.js` (nuevo; `server.js` con `unref()`): job 1/min — `esperando_operador` sin atención tras ≥X min → re-alerta Telegram con motivo y antigüedad; "ya re-alertado" en memoria keyed por `silenciado_desde` (tras restart a lo sumo duplica 1 re-alerta; persistencia queda natural para los eventos de #V47). Pendiente QA (D03): handoff LLM → acuse único; handoff guardia → acuse del guardia; esperar X min → re-alerta única por episodio.
| **#V46** | **Guardia sanitaria determinista server-side**: patrones de receta/posología/emergencia fuerzan handoff sin depender del LLM | Alto (seguridad) | D06 + D01 + D04 + D03 |

> **⏳ #V46 — IMPLEMENTADA (2026-09-22), pendiente de validación D03-QA + release D05.**
> Cambios: (1) nuevo módulo `src/lib/guardia-sanitaria.js` — 4 categorías (urgencia / posología / interacción / clínica: embarazo, lactancia, reacción adversa, receta) con acuses breves en español; (2) interceptor en `webhook.js` ANTES del LLM: si activa → `solicitar_asistencia_humana` (Telegram incluido) + acuse grabado y enviado + return (bot silenciado por estado); (3) espejo en `routes/bot.js` POST `/test` para reproducibilidad de QA sin webhook real; (4) batería sin BD: `node scripts/test-guardia-sanitaria.js` → **21/21 pasan** (incluye casos negativos de venta normal, evita falsos positivos). Nota de diseño: la categoría es solo la etiqueta del motivo; el handoff se activa igual en cualquier dirección segura. Verificación end-to-end (estado_chat → esperando_operador + mensaje en BD) pendiente de servidor: tarea D03.
| **#V47** | **Aplicar/verificar capa de eventos #V30 en disco**: `cliente_eventos`, RPCs, `perfil`/`contexto_bot` JSONB | Alto (prerrequisito) | D01 + D04 + D03 |

> **✅ #V47 — CERRADA (2026-10-01).** Resolución de la discrepancia: la capa **SÍ está desplegada en la BD de producción de Supabase** (tabla append-only con filas desde 09-30; RPCs verificadas en vivo: `registrar_evento_cliente` responde al CHECK de tipos — sondeo con tipo inválido devuelve violación de constraint y NO inserta; `contexto_cliente_snapshot` devuelve `{estado, cliente, eventos}`; columnas `clientes.perfil` y `estado_chat.contexto_bot` existen). Lo que faltaba era cablear `src` y versionar el SQL. Hecho:
> 1. `src/services/cliente-contexto.js` (nuevo, nombre canónico según AGENTS.md): `registrarEvento` vía RPC fail-soft + `registrarMensaje` (evento `mensaje_*` + ventana rodante `contexto_bot`, límite 20, contenido recortado a 160 chars) + `registrarTool`/`registrarProductoVisto`/`registrarCarrito`/`registrarCompra`/`registrarHandoff`. Anti-PII: payload solo canal/chars/flags/ids/longitudes; texto del cliente NUNCA va a eventos.
> 2. Cableado: `services/bot.js::grabarMensaje` (hook fire-and-forget: cubre los 3 roles y todos los canales) · `services/ai.js` (`tool_call` + `producto_visto`) · `services/tools.js` (`carrito_accion` al agregar/cambiar estado, `compra` al formalizar pedido, `handoff`).
> 3. Versionado de la estructura en repo: `sql/migracion-cliente-eventos.sql` (idempotente: cada objeto se crea SOLO si falta — no pisa nada desplegado; GRANT solo a `service_role`, sin REVOKE-ALL global que rompa otras RPCs) + `scripts/backfill-v30.js` (perfil desde hábitos/edad) + `scripts/bench-v30.js` (p95 del snapshot, meta <300 ms).
> 4. Smoke real contra BD: evento `tool_call` escrito y releído ✅ · batería guardia 21/21 ✅ · `node --check` OK en todo.
> 5. Bench inicial desde Windows local: media 193 ms / p50 165 / p95 337 (liga por encima de meta por RTT local) — **validar desde la VM de producción** (Oracle), que es donde corre el bot.
> 6. Cierre de otra brecha AGENTS↔disco: `scripts/backfill-v30.js` y `scripts/bench-v30.js` estaban referenciados pero no existían — ahora existen.

---

## C · CÓMO SE ACTUALIZA
- Al recibir una entrega tuya → la muevo de aquí a [[Estado_Actual]] §"En curso" asignando `#V{n}` y **cableo/implemento solo lo que pidas**.
- Lo que NO pidas queda **documentado aquí como backlog de versión futura** (#V36…#V42).
