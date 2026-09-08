---
tipo: contexto_ia
actualizado: 2026-09-08
tags: [contexto, memoria, raiz]
---

# Contexto IA — CRM DFD

> **ÚNICO archivo de lectura obligatoria al iniciar sesión.** El resto de la bóveda solo se lee si se pide explícitamente.

## Qué es
CRM omnicanal para la **Farmacia DFD**: un asistente de IA (FarmaBot) que atiende por WhatsApp y un panel web ("Mostrador") donde los farmacéuticos gestionan pedidos y conversaciones.

## Stack
- **Backend:** Node.js ≥20, Express 4, Helmet, express-rate-limit, dotenv.
- **IA:** OpenAI Responses API con *function calling* (`src/services/ai.js` + `src/lib/openai-tools.json`).
- **Datos:** Supabase (PostgreSQL) vía `@supabase/supabase-js`.
- **WhatsApp:** Meta Cloud API (webhook `/webhook` + envío).
- **Prompt:** fuente única = `bot_config.system_prompt` en BD; plantilla canónica en `src/prompts/system.txt` y sincronizador `scripts/sync-prompt.js`.

## Funcionamiento (alto nivel)
1. El cliente escribe → el webhook de Meta guarda el mensaje.
2. La IA decide si llama a herramientas: `consultar_precio_y_stock`, carrito, pedido o `solicitar_asistencia_humana`.
3. Si el chat está en `bot_activo`, responde la IA; si un operador lo toma (`humano_activo`), el bot se silencia y responde el humano.

## Reglas de oro
- **Nunca inventar precios/stock**: toda afirmación pasa por `consultar_precio_y_stock` (máx. 3 opciones, orden con rotación).
- **Fuente única del prompt:** editar `system.txt` y re-sincronizar con `scripts/sync-prompt.js`.

## Enlaces
- [[Vision_General]] — negocio y problema
- [[Stack_y_BD]] — tablas y dependencias
- [[Estado_Actual]] — qué está hecho y próximos pasos
- [[Decision_Log_001]] — decisiones tomadas