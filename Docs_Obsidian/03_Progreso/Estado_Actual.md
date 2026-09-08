---
tipo: progreso
actualizado: 2026-09-08
tags: [progreso, estado, backlog]
---

# Estado Actual — CRM DFD

## Hecho / Terminado
- **Bóveda Obsidian activa** (`Docs_Obsidian/`) como memoria a largo plazo: protocolo de lectura (solo [[Contexto_IA]] y este archivo) y escritura ("Actualiza la bóveda"). Regla permanente: mantenerla actualizada con cada cambio. Config `.obsidian/*` versionada (layout local ignorado).
- **Búsqueda inteligente** (`consultar_precio_y_stock`): normalización de unidades (g/gramo, mg/miligramo…), stopwords, match exacto de unidades (evita que "gramo" matchee "miligramo"), puntuación por coincidencia y marca.
- **≤3 opciones**: límite duro `max_ofertas: 3`; recomendaciones priorizan coincidencia → marca → rotación → stock → FEFO (si hay fechas) → precio.
- **Rotación**: `estado_chat.last_tool_context` guarda por UUID el contador `veces`; la lista varía entre consultas. `recordarRecomendacion` hace upsert de cliente + estado (fix de FK a `clientes`).
- **Intención de precio**: `orden_precio=asc` solo se honra si el texto pide explícitamente "barato/económico" (regex de intención); reseñado también en el prompt.
- **Prompt centralizado en BD** (`bot_config.system_prompt`, plantilla `src/prompts/system.txt`, sincronizador `scripts/sync-prompt.js`): bienvenida a Farmacia DFD en primer mensaje y **petición del nombre al confirmar pedido**.
- **Fallback**: coincidencia incierta → 1 opción y pregunta; no encuentro → 2 vías (buscar similar / `solicitar_asistencia_humana`).
- **Panel Mostrador**: inbox de conversaciones en vivo (poll 10 s, swap atómico), **toma de control humano en cualquier momento** (botón "Atender" en todo estado, operador envía y pausa el bot automáticamente), pedidos, test del bot, configuración.
- **Test del bot** vía `/api/bot/test` (exige `x-api-key`; teléfono editable).

## En curso
- **Datos reales del TPV** (marcas, lotes, vencimientos) mediante middleware `farmacia-sync`.
- **FEFO** (priorizar por vencimiento) — la lógica está preparada en la tool pero espera las fechas reales.
- **WhatsApp en producción**: falta VPS/webhook público para probar el flujo real end-to-end.

## Próximos pasos inmediatos
1. Conectar el middleware del TPV y cargar el catálogo real (productos con lote/vencimiento).
2. **Borrar datos de prueba**: `DELETE FROM productos WHERE nombre LIKE '[TEST]%'`.
3. Desplegar en VPS con webhook público y validar `/webhook` con WhatsApp real.
4. Continuar el [[Decision_Log_001]] al cerrar cada sesión.

## Cómo mantener esta bóveda
- **Lectura al iniciar sesión:** solo [[Contexto_IA]] y este archivo.
- **Comando de escritura:** "Actualiza la bóveda" → actualizar este archivo y crear un nuevo registro en `04_Historial/`.

## Enlaces
- [[Contexto_IA]] · [[Vision_General]] · [[Stack_y_BD]]