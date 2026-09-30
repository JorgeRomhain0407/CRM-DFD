---
tipo: propuestas-d06
titulo: Auditoría y propuestas del bot — D06 (2026-09-22)
actualizado: 2026-09-22
tags: [d06, bot, auditoria, propuestas, v43, v44, v45, v46, v47]
estado: SIN EJECUTAR — esperando OK explícito del usuario ("empieza #V{n}")
---

# 🔍 D06 · Auditoría del bot + propuestas #V43–#V47

> **Regla de oro respetada:** este documento SOLO registra. Nada se implementa hasta que el usuario diga "empieza #V{n}".
> Auditoría hecha leyendo en disco: `src/routes/webhook.js`, `src/services/bot.js`, `src/services/ai.js`, `src/services/tools.js`, `src/services/customers.js`, `src/routes/bot.js`, `src/prompts/system.txt`, `sql/schema.sql`, `sql/schema-pedidos.sql`.

---

## A · Discrepancias disco vs. contexto recibido

| Afirmación recibida | Realidad en disco |
|---------------------|-------------------|
| Webhook en `src/services/webhook.js` | Está en `src/routes/webhook.js` (llamadas a `grabarMensaje` en L114/121/131: correctas) |
| `grabarMensaje()` en bot.js L110 | Función en L109, INSERT en L111 — coincide en sustancia |
| **#V30 YA IMPLEMENTADO** (tabla `cliente_eventos` + CHECK de tipos, RPCs `registrar_evento_cliente`/`contexto_cliente_snapshot`, `clientes.perfil` JSONB, `estado_chat.contexto_bot` JSONB) | **NO EXISTE.** Grep en `sql/` y `src/` = 0 resultados. Solo hay `estado_chat.last_tool_context`. Ver propuesta **#V47** |

## B · Resumen del árbol de conversación actual

Arquitectura real: bucle LLM (OpenAI Responses API, máx 10 iteraciones de tools) sobre 5 tools definidas en `src/lib/openai-tools.json` + prompt en BD (`bot_config.system_prompt`, plantilla `src/prompts/system.txt`).

| Rama | Comportamiento | Punto débil (archivo:línea) |
|------|----------------|------------------------------|
| Entrada WhatsApp | firma Meta → 200 → async | errores post-200 invisibles (webhook.js:24-45) |
| Silencio por handoff | graba y return | sin acuse ni timeout al cliente (webhook.js:111-117) |
| Consulta producto | top 3, rotación, barato explícito | FEFO inactivo por falta de fechas (tools.js:156-157) |
| Carrito | RPCs + caduca 24 h | caducidad silenciosa (tools.js:266) |
| Pedido | pendiente_confirmacion/pedido | — |
| Handoff | estado + Telegram | enlace `localhost` roto (tools.js:357) |
| Adjuntos | texto genérico al LLM | sin guardia determinista (webhook.js:85-93) |
| Operador | pausa bot, rol `operador` | sus mensajes no entran al LLM (ai.js:64) |

**Bugs estructurales:** historial = primeros 30, no últimos (ai.js:59-60) · usuario duplicado cada turno (webhook.js:121 + ai.js:95) · `temperatura` guardada pero nunca enviada (bot.js:24-32 vs. ai.js:104-109).

---

## C · Diagnóstico ordenado por impacto al mostrador

1. **Contexto roto** — ai.js:59-60, ai.js:95, webhook.js:121.
2. **Fallos silenciosos** — webhook.js:36-40, ai.js:23-27.
3. **Handoff degradado** — tools.js:357, webhook.js:111-117, ai.js:64.
4. **Adjuntos clínicos sin barrera server-side** — webhook.js:85-93.
5. **Cero trazabilidad de eventos** — `cliente_eventos` inexistente en disco.

---

## D · Propuestas NUEVAS (no pisan #V28–#V42)

### #V43 · Contexto de conversación correcto (ventana real + sin duplicados + operador visible)
- **Qué:** corregir `getHistorial` para tomar los ÚLTIMOS N mensajes (desc → reverse), eliminar el push duplicado del mensaje del usuario, e incluir mensajes del rol `operador` (marcados como contexto humano) en el input del LLM. Aplicar `bot_config.temperatura` a la llamada de OpenAI.
- **Por qué:** hoy el bot se congela en los primeros 30 mensajes y repite preguntas; el operador escribe y el bot no lo sabe al retomar.
- **Criterio de salida (verificable):** (a) conversación de prueba con >30 mensajes donde el bot cita información del turno 35; (b) en logs/input del LLM el mensaje del usuario aparece 1 sola vez por turno; (c) tras volver de `humano_activo` a `bot_activo`, el bot responde sin contradecir lo dicho por el operador. D03-QA reproduce los 3 casos.
- **Riesgo:** bajo. Cambio localizado en `ai.js::getHistorial` + `ai.js::responderConAsistente`. No toca herramientas ni BD.
- **Departamento:** D01 Backend (implementa) + D06 (revisa redacción/estilo del prompt) + D03 QA.

### #V44 · Respuesta de contingencia ante fallos (nada de silencios)
- **Qué:** capturar errores de `responderConAsistente` en el webhook y enviar SIEMPRE al cliente un mensaje corto en español ("Tenemos un problema técnico en este momento; escribe de nuevo en unos minutos o te paso con una persona") + alerta al panel/Telegram con el error.
- **Por qué:** hoy cualquier excepción deja al cliente sin respuesta y al mostrador sin aviso (webhook.js:36-40 solo hace `console.error`).
- **Criterio de salida:** con `OPENAI_API_KEY` inválida simulada, el cliente recibe el mensaje de contingencia 1 vez (no spam por reintentos), y el evento queda registrado para el mostrador. D03-QA valida con la key rota.
- **Riesgo:** bajo-medio. Cuidado con duplicar avisos si Meta reintenta el webhook (ya cubierto por `claimWebhookEvent`).
- **Departamento:** D01 Backend + D06 (textos) + D03 QA.

### #V45 · Handoff robusto (enlace real, acuse y timeout)
- **Qué:** (a) sustituir el enlace `http://localhost:3000/` de `notifyHandoff` por la URL pública real desde `config`; (b) enviar al cliente un acuse único cuando pase a `esperando_operador`; (c) job de timeout: si nadie toma el chat en X minutos, re-alertar al panel/Telegram.
- **Por qué:** clientes quedan esperando eternamente y el operador recibe un enlace roto (tools.js:357).
- **Criterio de salida:** (a) la notificación Telegram abre el panel real; (b) el cliente recibe exactamente 1 acuse; (c) simulando 30 min sin atención (o intervalo configurable), llega re-alerta. D03-QA verifica los 3.
- **Riesgo:** medio. El timeout requiere job programado (cron/`setInterval` en el server o ActivePieces como en #V29 — decidir con D01).
- **Departamento:** D01 Backend (job + config) + D06 (acuse/textos) + D03 QA.

### #V46 · Guardia sanitaria determinista server-side (defensa en profundidad)
- **Qué:** filtro server-side ANTES del LLM: si el texto del cliente contiene señales de receta/posología/interacción/emergencia (lista de patrones mantenida por D06), forzar `solicitar_asistencia_humana` sin depender de que el LLM llame a la tool. Aplica también a adjuntos tipo imagen/audio/documento marcados como posible receta (webhook.js:85-93).
- **Por qué:** hoy la única barrera sanitaria es el prompt (`system.txt` L63-78). La regla innegociable del proyecto exige que el handoff clínico NO dependa de la obediencia del modelo. Complementa (no duplica) el #V37 congelado: #V37 es triaje inteligente por IA; #V46 es el guardia determinista mínimo.
- **Criterio de salida:** batería D03-QA con frases ("cuántos mg de X al día", "tengo dolor de pecho", "foto de mi receta") → el chat pasa a `esperando_operador` y el bot responde el acuse, EN CADA CASO, incluso forzando el modelo a no llamar a la tool.
- **Riesgo:** medio. Falsos positivos derivarían chats innecesarios → lista de patrones conservadora, revisable por D06, y SIEMPRE en la dirección segura (derivación de más, nunca de menos).
- **Departamento:** D06 (patrones + textos) + D01 (interceptor en webhook.js) + D04 (revisa que no filtre datos clínicos a logs) + D03 QA.

### #V47 · Aplicar/verificar la capa de eventos #V30 en disco (prerrequisito real)
- **Qué:** el contexto recibido dice que #V30 ya está implementado; **en disco no existe**. Verificar con el usuario si se aplicó en otro entorno; si no, ejecutar la migración de `cliente_eventos` (CHECK de tipos), RPCs `registrar_evento_cliente`/`contexto_cliente_snapshot`, `clientes.perfil` JSONB y `estado_chat.contexto_bot` JSONB, y cablear `grabarMensaje`/tools para que registren eventos.
- **Por qué:** sin esta capa no hay trazabilidad del bot (#V44 no podrá registrar fallos) ni base para #V29 (recompra), #V31 (analítica) ni #V33 (carrito abandonado).
- **Criterio de salida:** migración aplicada y verificable en Supabase; cada mensaje/tool_call/handoff genera evento consultable con `registrar_evento_cliente`; D03-QA valida con 5 eventos de tipos distintos.
- **Riesgo:** medio. Es la tarea con más superficie (BD + src). Coordinar con D04 para el CHECK de tipos y permisos RPC.
- **Departamento:** D01 Backend + D04 Seguridad (revisa) + D03 QA.

---

## E · Dependencias sugeridas

```
#V43 (contexto) ── independiente ──► puede ir primero (máximo impacto/mínimo riesgo)
#V44 (contingencia) ── conviene DESPUÉS de #V47 (para registrar el fallo como evento)
#V45 (handoff) ── independiente del resto
#V46 (guardia sanitaria) ── independiente; recomendado de inmediato (riesgo sanitario)
#V47 (eventos #V30) ── prerrequisito real de #V29/#V31/#V33 y mejora #V44
```

## F · Estado

- ⏳ **#V43 IMPLEMENTA (fecha: 2026-09-22)** — cambios aplicados en `src/services/ai.js`:
  1. `getHistorial`: orden `desc` + `limit(30)` + re-inversión ⇒ ventana de los **últimos** 30 mensajes (antes: los primeros 30, ai.js:59-60 bug original).
  2. Mensajes del rol `operador` incluidos en el input del LLM, prefijados `(Enviado al cliente por un operador humano, no por el bot)`.
  3. Eliminado el `push` duplicado del mensaje del usuario en `responderConAsistente` (el mensaje llega ya grabado por `webhook.js:121` / `routes/bot.js:63`).
  4. `bot_config.temperatura` aplicada a las dos llamadas `openai.responses.create`.
  - `node --check` OK en `ai.js`, `webhook.js`, `routes/bot.js` (sin cambios en estos dos últimos).
- ⏳ **#V46 IMPLEMENTADA (2026-09-22)** — guardia sanitaria determinista server-side:
  1. `src/lib/guardia-sanitaria.js` (nuevo): `detectarGuardia(texto)` con 4 categorías — urgencia, posología, interacción, clínica (embarazo/lactancia/reacción adversa/receta) — y acuses user-facing cortos en español (`ACUSE_URGENCIA` / `ACUSE_CLINICO`). Dirección segura: derivar de MÁS, nunca de MENOS.
  2. `src/routes/webhook.js`: interceptor ANTES del LLM → si activa: `solicitarAsistenciaHumana` (estado `esperando_operador` + Telegram) + acuse enviado y grabado como mensaje asistente + return. No corre si el bot ya está silenciado (evita acuses repetidos en handoff en curso); dedupe de reintentos Meta garantizado por `claimWebhookEvent`.
  3. `src/routes/bot.js` POST `/test`: espejo del guardia para reproducibilidad QA sin webhook.
  4. `scripts/test-guardia-sanitaria.js` (nuevo, sin BD): batería 21/21 OK — 12 activaciones (criterio de salida #V46: "cuántos mg…", "dolor de pecho", "foto de mi receta", etc.) + 9 negativos de venta normal.
  - `node --check` OK en todos los archivos tocados.
- ⏸ **#V44, #V45, #V47 SIN EJECUTAR.** Esperando OK explícito: *"empieza #V44"* (o las que correspondan).
