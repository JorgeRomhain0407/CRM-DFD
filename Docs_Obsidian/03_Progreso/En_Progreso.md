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

## B2 · PROPUESTAS D06 — AUDITORÍA DEL BOT (2026-09-22, registradas, NO implementadas)

> Auditoría completa en [[Auditoria_Bot_D06_2026-09-22]]. Esperando OK explícito ("empieza #V{n}").

| # | Tarea | Impacto | Departamento |
|---|-------|---------|--------------|
| **#V43** | **Contexto de conversación correcto**: últimos N mensajes (no los primeros 30), sin duplicar el mensaje del usuario, mensajes del operador visibles al LLM, aplicar `temperatura` real | Alto | D01 + D06 + D03 |

> **⏳ #V43 — IMPLEMENTADA (2026-09-22), pendiente de validación D03-QA + release D05.**
> Cambios en `src/services/ai.js`: (1) `getHistorial` ahora toma los **últimos** 30 mensajes (order desc → reverse) e incluye el rol `operador` prefijado como contexto humano; (2) eliminado el `push` duplicado del mensaje del usuario (llega ya grabado por webhook/panel); (3) `bot_config.temperatura` aplicada a ambas llamadas de `openai.responses.create`. Verificación estática `node --check` OK. Prueba funcional pendiente: servidor + Supabase (run-tests.js) — tarea D03.
| **#V44** | **Respuesta de contingencia ante fallos**: nunca dejar al cliente sin respuesta (mensaje breve + alerta al mostrador) | Alto | D01 + D06 + D03 |
| **#V45** | **Handoff robusto**: enlace real al panel (hoy `localhost` roto), acuse único al cliente, timeout de espera con re-alerta | Alto | D01 + D06 + D03 |
| **#V46** | **Guardia sanitaria determinista server-side**: patrones de receta/posología/emergencia fuerzan handoff sin depender del LLM | Alto (seguridad) | D06 + D01 + D04 + D03 |

> **⏳ #V46 — IMPLEMENTADA (2026-09-22), pendiente de validación D03-QA + release D05.**
> Cambios: (1) nuevo módulo `src/lib/guardia-sanitaria.js` — 4 categorías (urgencia / posología / interacción / clínica: embarazo, lactancia, reacción adversa, receta) con acuses breves en español; (2) interceptor en `webhook.js` ANTES del LLM: si activa → `solicitar_asistencia_humana` (Telegram incluido) + acuse grabado y enviado + return (bot silenciado por estado); (3) espejo en `routes/bot.js` POST `/test` para reproducibilidad de QA sin webhook real; (4) batería sin BD: `node scripts/test-guardia-sanitaria.js` → **21/21 pasan** (incluye casos negativos de venta normal, evita falsos positivos). Nota de diseño: la categoría es solo la etiqueta del motivo; el handoff se activa igual en cualquier dirección segura. Verificación end-to-end (estado_chat → esperando_operador + mensaje en BD) pendiente de servidor: tarea D03.
| **#V47** | ~~Aplicar/verificar capa de eventos #V30 en disco~~ **CERRADA (2026-09-30, F1+F2 v31.0.0)** | — | cerrada |
> **✅ #V47 — CERRADA (2026-09-30).** La discrepancia era real y ya está resuelta por el release **v31.0.0** (`0a742d8` + `3cc9811`). Evidencia: (1) **en disco** — `src/services/cliente-contexto.js` (snapshotContexto), hook en `src/services/bot.js` (grabarMensaje → registrarEvento), `sql/migracion-v30-datos-no-estructurados.sql`, `scripts/backfill-v30.js`, `scripts/bench-v30.js`; grep ya no da 0 resultados. (2) **En BD** — migración aplicada, smoke PASS (2 eventos), RLS + grants + sequence OK. (3) **En producción (VM `crm` v31.0.0)** — `git pull` a `3cc9811`, `pm2 restart` OK; backfill real `total=3 ok=3 errores=0`; bench `n=50 p50=60.8ms p95=118.5ms` → **META p95<300ms CUMPLE**; `cliente_eventos` **devolviendo filas en vivo** (hook capturando mensajes reales) y 3 clientes con `perfil` JSONB poblado. (4) **Bono** — fix de seguridad `sql/fix-rls-lotes.sql` (`779d123`): RLS activada en `lotes` (Advisor CRITICAL → 0) sin tocar RPCs.

### Pendiente de validación funcional (D03-QA)
- **#V43** y **#V46** están **desplegadas en producción** con v31.0.0 (eran de #V30/#V28 y viajarían en el mismo merge), pero su validación funcional sigue pendiente: `node scripts/test-guardia-sanitaria.js` (21/21) corre en disco, falta el end-to-end real de la guardia sanitaria (`estado_chat → esperando_operador` + mensaje en BD) y de `getHistorial` con rol `operador` visible al LLM.
- **#V44** y **#V45** → asignadas a D06 (petición del owner el 2026-09-30). Nota de dependencia para D06: **#V45 necesita una URL real del panel** (hoy el enlace de handoff apunta a `localhost`); eso depende de la infraestructura de producción (dominio HTTPS público para el webhook + Tailscale para el panel), no del código del bot.

---

## C · CÓMO SE ACTUALIZA
- Al recibir una entrega tuya → la muevo de aquí a [[Estado_Actual]] §"En curso" asignando `#V{n}` y **cableo/implemento solo lo que pidas**.
- Lo que NO pidas queda **documentado aquí como backlog de versión futura** (#V36…#V42).
