---
tipo: arquitectura
actualizado: 2026-09-08
tags: [arquitectura, stack, base-de-datos, apis]
---

# Stack y Base de Datos — CRM DFD

## Stack tecnológico
| Capa | Tecnología |
|---|---|
| Runtime | Node.js ≥20 |
| Servidor web | Express 4 (Helmet, express-rate-limit) |
| IA | OpenAI Responses API + function calling (`openai` v4) |
| Datos | Supabase / PostgreSQL (`@supabase/supabase-js` v2) |
| WhatsApp | Meta Cloud API (Graph v21) |
| Frontend | HTML/CSS/JS planos servidos por Express (`public/`) |

Dependencias (`package.json`): `@supabase/supabase-js`, `dotenv`, `express`, `express-rate-limit`, `helmet`, `openai`.

## Ejecución
- `npm start` → `node src/server.js` (escucha en `:3000`).
- `npm run dev` → mode watch.
- `node scripts/sync-prompt.js` → sincroniza `src/prompts/system.txt` con `bot_config.system_prompt` en BD.

## Variables de entorno clave (`src/config.js`)
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_ASSISTANT_ID`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `MOSTRADOR_API_KEY` (protege `/api/*`), `ADMIN_CONFIG_KEY` (edita bot_config)
- `META_ACCESS_TOKEN`, `META_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`
- `PORT`, `DEFAULT_PHONE_PREFIX`, `IS_PROD`

## Estructura de datos (tables)
| Tabla | Propósito | Notas |
|---|---|---|
| `clientes` | Ficha del cliente | `telefono` PK (E.164); nombre, edad, hábitos_consumo |
| `estado_chat` | Estado de la conversación | `estado`: bot_activo / esperando_operador / humano_activo; `last_tool_context` jsonb (id→nombre + contador de rotación `veces`) |
| `mensajes` | Historial del chat | rol: usuario / asistente / operador; canal: whatsapp / test / mostrador |
| `productos` | Catálogo | nombre, precio, stock, activo; `fecha_vencimiento` (útil para FEFO) |
| `carritos` | Carritos/pedidos | línea de estado: activo → pendiente_confirmacion → pedido → completado |
| `carritos_temporales` | Soporte efímero de carrito | caduca 24 h |
| `ventas` | Ventas cerradas | canal mostrador / whatsapp |
| `bot_config` | Config del bot | id=1; `system_prompt` es la **fuente única** del prompt |
| `webhook_events` | Desduplicación de webhooks | `claimWebhookEvent` por `wa_message_id` |

## APIs principales (`src/routes/`)
| Ruta | Función |
|---|---|
| `/webhook` | Entrada de mensajes WhatsApp de Meta (GET verificación, POST mensajes) |
| `/api/bot/test` | Prueba del asistente sin WhatsApp (exige `x-api-key`) |
| `/api/bot/conversaciones` (+ `/:telefono`) | Inbox y detalle de conversaciones |
| `/api/bot/mensajes` | Enviar como operador → WhatsApp; **toma el control automático** (bot_activo → humano_activo) |
| `/api/bot/estado-chat/:telefono` | PATCH de estado: bot_activo / esperando_operador / humano_activo |
| `/api/bot/config` | GET/PUT del prompt y configuración (PUT con `x-admin-key`) |
| `/api/productos`, `/api/clientes`, `/api/carritos`, `/api/ventas` | Catálogo, clientes, pedidos y métricas |

## Herramientas del asistente (`src/lib/openai-tools.json`)
`consultar_precio_y_stock` (búsqueda→rotación→≤3), `agregar_al_carrito`, `ver_resumen_carrito`, `actualizar_estado_pedido`, `solicitar_asistencia_humana`.

## Enlaces
- [[Contexto_IA]] · [[Vision_General]] · [[Estado_Actual]] · [[Decision_Log_001]]