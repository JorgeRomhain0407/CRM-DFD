---
tipo: propuestas-d06
titulo: AuditorÃ­a y propuestas del bot â€” D06 (2026-09-22)
actualizado: 2026-09-22
tags: [d06, bot, auditoria, propuestas, v43, v44, v45, v46, v47]
estado: SIN EJECUTAR â€” esperando OK explÃ­cito del usuario ("empieza #V{n}")
---

# ðŸ” D06 Â· AuditorÃ­a del bot + propuestas #V43â€“#V47

> **Regla de oro respetada:** este documento SOLO registra. Nada se implementa hasta que el usuario diga "empieza #V{n}".
> AuditorÃ­a hecha leyendo en disco: `src/routes/webhook.js`, `src/services/bot.js`, `src/services/ai.js`, `src/services/tools.js`, `src/services/customers.js`, `src/routes/bot.js`, `src/prompts/system.txt`, `sql/schema.sql`, `sql/schema-pedidos.sql`.

---

## A Â· Discrepancias disco vs. contexto recibido

| AfirmaciÃ³n recibida | Realidad en disco |
|---------------------|-------------------|
| Webhook en `src/services/webhook.js` | EstÃ¡ en `src/routes/webhook.js` (llamadas a `grabarMensaje` en L114/121/131: correctas) |
| `grabarMensaje()` en bot.js L110 | FunciÃ³n en L109, INSERT en L111 â€” coincide en sustancia |
| **#V30 YA IMPLEMENTADO** (tabla `cliente_eventos` + CHECK de tipos, RPCs `registrar_evento_cliente`/`contexto_cliente_snapshot`, `clientes.perfil` JSONB, `estado_chat.contexto_bot` JSONB) | **NO EXISTE.** Grep en `sql/` y `src/` = 0 resultados. Solo hay `estado_chat.last_tool_context`. Ver propuesta **#V47** |

## B Â· Resumen del Ã¡rbol de conversaciÃ³n actual

Arquitectura real: bucle LLM (OpenAI Responses API, mÃ¡x 10 iteraciones de tools) sobre 5 tools definidas en `src/lib/openai-tools.json` + prompt en BD (`bot_config.system_prompt`, plantilla `src/prompts/system.txt`).

| Rama | Comportamiento | Punto dÃ©bil (archivo:lÃ­nea) |
|------|----------------|------------------------------|
| Entrada WhatsApp | firma Meta â†’ 200 â†’ async | errores post-200 invisibles (webhook.js:24-45) |
| Silencio por handoff | graba y return | sin acuse ni timeout al cliente (webhook.js:111-117) |
| Consulta producto | top 3, rotaciÃ³n, barato explÃ­cito | FEFO inactivo por falta de fechas (tools.js:156-157) |
| Carrito | RPCs + caduca 24 h | caducidad silenciosa (tools.js:266) |
| Pedido | pendiente_confirmacion/pedido | â€” |
| Handoff | estado + Telegram | enlace `localhost` roto (tools.js:357) |
| Adjuntos | texto genÃ©rico al LLM | sin guardia determinista (webhook.js:85-93) |
| Operador | pausa bot, rol `operador` | sus mensajes no entran al LLM (ai.js:64) |

**Bugs estructurales:** historial = primeros 30, no Ãºltimos (ai.js:59-60) Â· usuario duplicado cada turno (webhook.js:121 + ai.js:95) Â· `temperatura` guardada pero nunca enviada (bot.js:24-32 vs. ai.js:104-109).

---

## C Â· DiagnÃ³stico ordenado por impacto al mostrador

1. **Contexto roto** â€” ai.js:59-60, ai.js:95, webhook.js:121.
2. **Fallos silenciosos** â€” webhook.js:36-40, ai.js:23-27.
3. **Handoff degradado** â€” tools.js:357, webhook.js:111-117, ai.js:64.
4. **Adjuntos clÃ­nicos sin barrera server-side** â€” webhook.js:85-93.
5. **Cero trazabilidad de eventos** â€” `cliente_eventos` inexistente en disco.

---

## D Â· Propuestas NUEVAS (no pisan #V28â€“#V42)

### #V43 Â· Contexto de conversaciÃ³n correcto (ventana real + sin duplicados + operador visible)
- **QuÃ©:** corregir `getHistorial` para tomar los ÃšLTIMOS N mensajes (desc â†’ reverse), eliminar el push duplicado del mensaje del usuario, e incluir mensajes del rol `operador` (marcados como contexto humano) en el input del LLM. Aplicar `bot_config.temperatura` a la llamada de OpenAI.
- **Por quÃ©:** hoy el bot se congela en los primeros 30 mensajes y repite preguntas; el operador escribe y el bot no lo sabe al retomar.
- **Criterio de salida (verificable):** (a) conversaciÃ³n de prueba con >30 mensajes donde el bot cita informaciÃ³n del turno 35; (b) en logs/input del LLM el mensaje del usuario aparece 1 sola vez por turno; (c) tras volver de `humano_activo` a `bot_activo`, el bot responde sin contradecir lo dicho por el operador. D03-QA reproduce los 3 casos.
- **Riesgo:** bajo. Cambio localizado en `ai.js::getHistorial` + `ai.js::responderConAsistente`. No toca herramientas ni BD.
- **Departamento:** D01 Backend (implementa) + D06 (revisa redacciÃ³n/estilo del prompt) + D03 QA.

### #V44 Â· Respuesta de contingencia ante fallos (nada de silencios)
- **QuÃ©:** capturar errores de `responderConAsistente` en el webhook y enviar SIEMPRE al cliente un mensaje corto en espaÃ±ol ("Tenemos un problema tÃ©cnico en este momento; escribe de nuevo en unos minutos o te paso con una persona") + alerta al panel/Telegram con el error.
- **Por quÃ©:** hoy cualquier excepciÃ³n deja al cliente sin respuesta y al mostrador sin aviso (webhook.js:36-40 solo hace `console.error`).
- **Criterio de salida:** con `OPENAI_API_KEY` invÃ¡lida simulada, el cliente recibe el mensaje de contingencia 1 vez (no spam por reintentos), y el evento queda registrado para el mostrador. D03-QA valida con la key rota.
- **Riesgo:** bajo-medio. Cuidado con duplicar avisos si Meta reintenta el webhook (ya cubierto por `claimWebhookEvent`).
- **Departamento:** D01 Backend + D06 (textos) + D03 QA.

### #V45 Â· Handoff robusto (enlace real, acuse y timeout)
- **QuÃ©:** (a) sustituir el enlace `http://localhost:3000/` de `notifyHandoff` por la URL pÃºblica real desde `config`; (b) enviar al cliente un acuse Ãºnico cuando pase a `esperando_operador`; (c) job de timeout: si nadie toma el chat en X minutos, re-alertar al panel/Telegram.
- **Por quÃ©:** clientes quedan esperando eternamente y el operador recibe un enlace roto (tools.js:357).
- **Criterio de salida:** (a) la notificaciÃ³n Telegram abre el panel real; (b) el cliente recibe exactamente 1 acuse; (c) simulando 30 min sin atenciÃ³n (o intervalo configurable), llega re-alerta. D03-QA verifica los 3.
- **Riesgo:** medio. El timeout requiere job programado (cron/`setInterval` en el server o ActivePieces como en #V29 â€” decidir con D01).
- **Departamento:** D01 Backend (job + config) + D06 (acuse/textos) + D03 QA.

### #V46 Â· Guardia sanitaria determinista server-side (defensa en profundidad)
- **QuÃ©:** filtro server-side ANTES del LLM: si el texto del cliente contiene seÃ±ales de receta/posologÃ­a/interacciÃ³n/emergencia (lista de patrones mantenida por D06), forzar `solicitar_asistencia_humana` sin depender de que el LLM llame a la tool. Aplica tambiÃ©n a adjuntos tipo imagen/audio/documento marcados como posible receta (webhook.js:85-93).
- **Por quÃ©:** hoy la Ãºnica barrera sanitaria es el prompt (`system.txt` L63-78). La regla innegociable del proyecto exige que el handoff clÃ­nico NO dependa de la obediencia del modelo. Complementa (no duplica) el #V37 congelado: #V37 es triaje inteligente por IA; #V46 es el guardia determinista mÃ­nimo.
- **Criterio de salida:** baterÃ­a D03-QA con frases ("cuÃ¡ntos mg de X al dÃ­a", "tengo dolor de pecho", "foto de mi receta") â†’ el chat pasa a `esperando_operador` y el bot responde el acuse, EN CADA CASO, incluso forzando el modelo a no llamar a la tool.
- **Riesgo:** medio. Falsos positivos derivarÃ­an chats innecesarios â†’ lista de patrones conservadora, revisable por D06, y SIEMPRE en la direcciÃ³n segura (derivaciÃ³n de mÃ¡s, nunca de menos).
- **Departamento:** D06 (patrones + textos) + D01 (interceptor en webhook.js) + D04 (revisa que no filtre datos clÃ­nicos a logs) + D03 QA.

### #V47 Â· Aplicar/verificar la capa de eventos #V30 en disco (prerrequisito real)
- **QuÃ©:** el contexto recibido dice que #V30 ya estÃ¡ implementado; **en disco no existe**. Verificar con el usuario si se aplicÃ³ en otro entorno; si no, ejecutar la migraciÃ³n de `cliente_eventos` (CHECK de tipos), RPCs `registrar_evento_cliente`/`contexto_cliente_snapshot`, `clientes.perfil` JSONB y `estado_chat.contexto_bot` JSONB, y cablear `grabarMensaje`/tools para que registren eventos.
- **Por quÃ©:** sin esta capa no hay trazabilidad del bot (#V44 no podrÃ¡ registrar fallos) ni base para #V29 (recompra), #V31 (analÃ­tica) ni #V33 (carrito abandonado).
- **Criterio de salida:** migraciÃ³n aplicada y verificable en Supabase; cada mensaje/tool_call/handoff genera evento consultable con `registrar_evento_cliente`; D03-QA valida con 5 eventos de tipos distintos.
- **Riesgo:** medio. Es la tarea con mÃ¡s superficie (BD + src). Coordinar con D04 para el CHECK de tipos y permisos RPC.
- **Departamento:** D01 Backend + D04 Seguridad (revisa) + D03 QA.

---

## E Â· Dependencias sugeridas

```
#V43 (contexto) â”€â”€ independiente â”€â”€â–º puede ir primero (mÃ¡ximo impacto/mÃ­nimo riesgo)
#V44 (contingencia) â”€â”€ conviene DESPUÃ‰S de #V47 (para registrar el fallo como evento)
#V45 (handoff) â”€â”€ independiente del resto
#V46 (guardia sanitaria) â”€â”€ independiente; recomendado de inmediato (riesgo sanitario)
#V47 (eventos #V30) â”€â”€ prerrequisito real de #V29/#V31/#V33 y mejora #V44
```

## F Â· Estado

- â³ **#V43 IMPLEMENTA (fecha: 2026-09-22)** â€” cambios aplicados en `src/services/ai.js`:
  1. `getHistorial`: orden `desc` + `limit(30)` + re-inversiÃ³n â‡’ ventana de los **Ãºltimos** 30 mensajes (antes: los primeros 30, ai.js:59-60 bug original).
  2. Mensajes del rol `operador` incluidos en el input del LLM, prefijados `(Enviado al cliente por un operador humano, no por el bot)`.
  3. Eliminado el `push` duplicado del mensaje del usuario en `responderConAsistente` (el mensaje llega ya grabado por `webhook.js:121` / `routes/bot.js:63`).
  4. `bot_config.temperatura` aplicada a las dos llamadas `openai.responses.create`.
  - `node --check` OK en `ai.js`, `webhook.js`, `routes/bot.js` (sin cambios en estos dos Ãºltimos).
- â³ **#V46 IMPLEMENTADA (2026-09-22)** â€” guardia sanitaria determinista server-side:
  1. `src/lib/guardia-sanitaria.js` (nuevo): `detectarGuardia(texto)` con 4 categorÃ­as â€” urgencia, posologÃ­a, interacciÃ³n, clÃ­nica (embarazo/lactancia/reacciÃ³n adversa/receta) â€” y acuses user-facing cortos en espaÃ±ol (`ACUSE_URGENCIA` / `ACUSE_CLINICO`). DirecciÃ³n segura: derivar de MÃS, nunca de MENOS.
  2. `src/routes/webhook.js`: interceptor ANTES del LLM â†’ si activa: `solicitarAsistenciaHumana` (estado `esperando_operador` + Telegram) + acuse enviado y grabado como mensaje asistente + return. No corre si el bot ya estÃ¡ silenciado (evita acuses repetidos en handoff en curso); dedupe de reintentos Meta garantizado por `claimWebhookEvent`.
  3. `src/routes/bot.js` POST `/test`: espejo del guardia para reproducibilidad QA sin webhook.
  4. `scripts/test-guardia-sanitaria.js` (nuevo, sin BD): baterÃ­a 21/21 OK â€” 12 activaciones (criterio de salida #V46: "cuÃ¡ntos mgâ€¦", "dolor de pecho", "foto de mi receta", etc.) + 9 negativos de venta normal.
  - `node --check` OK en todos los archivos tocados.
- â³ **#V44 IMPLEMENTADA (2026-09-22)** â€” contingencia ante fallos:
  1. `src/services/telegram.js`: nueva `notifyAlerta({telefono, error})` â€” alerta operativa sin Markdown (los errores pueden contener asteriscos/underscores que rompen el parseo).
  2. `src/routes/webhook.js`: nueva `obtenerRespuestaBot(msg)` que envuelve al LLM â†’ en error: alerta Telegram + (si hay texto del cliente y pasa el antispam de 5 min por cliente) envÃ­o y grabaciÃ³n de `MSJ_CONTINGENCIA` ("Disculpa, tuvimos un problema tÃ©cnicoâ€¦ escrÃ­benos en unos minutos o pide hablar con una personaâ€¦"). El catch del handler externo tambiÃ©n alerta (fallo de envÃ­o/grabaciÃ³n posterior al LLM).
  3. `src/routes/bot.js` POST `/test`: fallo del asistente â†’ `503` JSON con mensaje accionable para el panel (antes: 500 genÃ©rico).
  - Cobertura: sin canal si WhatsApp o Supabase estÃ¡n caÃ­dos (no hay medio de aviso al cliente); el mostrador se entera SIEMPRE vÃ­a Telegram.
- â³ **#V45 IMPLEMENTADA (2026-09-22)** â€” handoff robusto:
  1. Config: `PANEL_URL` + `HANDOFF_ALERTA_MINUTOS` (config.js, .env, .env.example).
  2. `tools.js`: enlace de la notificaciÃ³n de handoff = `config.panelUrl` (eliminado el `http://localhost:3000/` hardcodeado).
  3. `ai.js`: acuse determinista al cliente al pasar a humano (`ACUSE_HANDOFF`), cortando el bucle de OpenAI â€” el texto ya no depende del modelo; el guardia (#V46) tiene su propio acuse.
  4. `handoff-timeout.js` (nuevo, cableado en `server.js` con `unref()`): re-alerta Telegram tras X min sin atenciÃ³n; anti-duplicado en memoria por episodio de `silenciado_desde`.
  - Nota de #V47: el usuario indicÃ³ que ya estÃ¡ implementada; **en disco NO existe** (grep = 0 en sql/ y src/, tampoco en las migraciones nuevas de 03â€“21/09). Duda abierta: si se aplicÃ³ directo en Supabase sin versionar en el repo, habrÃ¡ que cablear src y la nota queda resuelta; mientras tanto sigue SIN EJECUTAR.
- âœ… **CIERRE 2026-10-01 â€” #V44, #V45, #V47 COMPLETADAS con OK del usuario** ("termina con V44, V45 y V47"). Detalle de cierre en [[En_Progreso]] Â§B2. Resumen:
  - #V44: `notifyAlerta` (Telegram) + `obtenerRespuestaBot` con contingencia y antispam 5 min/cliente + `/test` â†’ 503 legible.
  - #V45: `PANEL_URL`/`HANDOFF_ALERTA_MINUTOS` en config + enlace real al panel + acuse determinista de handoff (`ACUSE_HANDOFF`, corta bucle OpenAI) + vigilante `handoff-timeout.js` con re-alerta por episodio.
  - #V47: la capa #V30 ya estaba desplegada en la BD de producciÃ³n (la discrepancia original era repoâ†”BD, no existencia real); cableada `src/services/cliente-contexto.js` (hook en `grabarMensaje` + tool_call/producto_visto/carrito_accion/compra/handoff, fail-soft, anti-PII) + versionada en `sql/migracion-cliente-eventos.sql` + `backfill-v30.js`/`bench-v30.js`. Smoke BD OK; bench local media 193 ms (p95 337 â€” revisar desde la VM de producciÃ³n).
  - Lección aplicada (AGENTS.md): "verificar en disco, no en el transcript" — el disco incluye la BD real vía credenciales del .env; el grep solo-repo es insuficiente cuando la migración vive solo en Supabase.
  - Pendiente definitivo: QA runtime (D03, servidor arriba) + commit/release (D05).
