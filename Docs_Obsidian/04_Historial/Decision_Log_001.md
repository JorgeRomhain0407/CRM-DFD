---
tipo: historial
actualizado: 2026-09-08
tags: [decisiones, historial]
---

# Decision Log 001 — Decisiones y sesiones hasta hoy

> Registro inmutable de decisiones técnicas y del recorrido del proyecto. Los ítems se añaden al final, sin reescribir lo anterior.

## 2026-09-08 · Sesión de búsqueda inteligente y control humano

### D001 — El prompt vive en la base de datos
La fuente única es `bot_config.system_prompt` en Supabase. `src/prompts/system.txt` es la plantilla canónica y `scripts/sync-prompt.js` la re-sincroniza tras cada edición. **Motivo:** poder ajustar el comportamiento del bot sin tocar código ni redeployar.

### D002 — Búsqueda inteligente con rotación y límite de 3
`consultar_precio_y_stock` normaliza unidades sinónimas, ignora stopwords, puntúa coincidencias y devuelve **como máximo 3 productos**. Se prioriza coincidencia > marca > rotación > stock > FEFO > precio. **Motivo:** simplicidad de lectura en WhatsApp y variedad en consultas repetidas.

### D003 — Match exacto de unidades de medida
El bug "miligramo ⊂ gramo" (coincidencia por subcadena) devolvía paracetamol de 500 mg al buscar "1 gramo". Se añadió `UNIDADES_EXACTAS`: los tokens de unidad solo matchean por **igualdad exacta**; el resto sigue por subcadena. **Motivo:** precisión de dosis/formatos.

### D004 — Rotación persistida en `last_tool_context` (jsonb)
`estado_chat.last_tool_context` guarda por **UUID de producto** `{ id, nombre, veces, ultima }`. `recordarRecomendacion` incrementa `veces` y `ai.js` fusiona sin pisar el contador. Se corrigió el fallo de FK: la tool hace **upsert de `clientes`** antes de insertar `estado_chat` (sin fila, el update no persistía).

### D005 — `orden_precio=asc` solo con intención explícita de "barato"
El modelo tendía a pasar `asc` en consultas neutrales, lo que anulaba la rotación (mismo orden de precio siempre). La tool ahora detecta intención de precio con una regex sobre el texto (`barat|económic|…`) y el prompt instruye al modelo a solo usar `asc` ante petición explícita. **Motivo:** que la variedad por rotación no quede anulada por un flag automático.

### D006 — Fallback en dos vías
Sin resultado (o negación del cliente): **buscar un producto similar por otro nombre** **o** **pasar a farmacéutico humano** (`solicitar_asistencia_humana`), dejando que el cliente elija. Se eliminó la tendencia a adivinar repetidamente.

### D007 — Bienvenida y petición de nombre
Al primer mensaje de una conversación nueva, el bot se presenta en el servicio de atención al cliente de la **Farmacia DFD**. Al confirmar el pedido, si el bot no conoce el nombre, lo pide con amabilidad para dejar el pedido preparado a su nombre.

### D008 — Operador puede tomar el control en cualquier momento
El panel muestra la barra de acciones y el cuadro del operador **en todos los estados** (antes solo tras handoff). Al enviar un mensaje como operador, el backend **pausa el bot automáticamente** (`humano_activo`); "Atender" y "Devolver al bot" cambian el estado de forma explícita. El chat abierto se refresca en vivo (poll 10 s) sin perder lo que escribe el agente. **Motivo:** los agentes deciden cuándo intervenir.

### D009 — Bóveda Obsidian como "Memoria a Largo Plazo"
Se inicializó `Docs_Obsidian/` (estructura `00_Sistema … 04_Historial`) para minimizar el contexto en las sesiones y consultar estado en cualquier momento.
- **Protocolo de lectura:** al iniciar chat, leer solo `Contexto_IA.md` y `Estado_Actual.md`; el resto solo si se pide.
- **Protocolo de escritura:** comando "Actualiza la bóveda" → actualizar `Estado_Actual.md` y crear registro en `04_Historial/`.
- **Regla aceptada (instrucción permanente):** mantener la bóveda actualizada con todo cambio realizado en el proyecto.
- Config de Obsidian (`.obsidian/*` salvo `workspace*.json`) versionada; el layout local está en `.gitignore`.

## Pendientes registrados
- **FEFO**: lógica condicional lista, esperando fechas de vencimiento del TPV (ver [[Estado_Actual]]).
- **Productos `[TEST]`**: borrar con datos reales (`DELETE FROM productos WHERE nombre LIKE '[TEST]%'`).
- **Despliegue WhatsApp real**: requiere VPS/webhook público.

## Enlaces
- [[Contexto_IA]] · [[Vision_General]] · [[Stack_y_BD]] · [[Estado_Actual]]