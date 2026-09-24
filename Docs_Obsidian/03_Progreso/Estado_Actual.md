---
tipo: progreso
actualizado: 2026-09-22
tags: [progreso, estado, backlog]
stado_v22: "V22 · panel: indicador de versión visible + aviso de clave API faltante — hash 8a89526"
stado_v21: "V21 · ajustes de layout del panel + anti-caché — hash 0565779"
stado_v20: "V20 · mejoras integrales del panel (seguridad/UX/visual, solo public/) — hash 6a891aa"
stado_v27: "V27 · caja de recomendaciones híbridas cableada al panel (HEAD 5404bd1)"

# Estado Actual — CRM DFD

## Hecho / Terminado
- **#V22 · Indicador de versión + aviso de clave** — píldora `#appVersion` en el brand (sabes al instante qué versión está desplegada) y banner `#noKeyHint` cuando falta la `MOSTRADOR_API_KEY`. Causa raíz del "no se ve bien": caché/sesión de navegador antigua — verificado con navegador real (Playwright/Edge): cambio de vistas correcto y endpoints 200. Detalle: [[Indicador_Version_y_Clave_2026-09-22]].
- **#V21 · Ajustes de layout del panel + anti-caché** — tras feedback del usuario ("todo apilado"): página compacta, solo la tabla de productos hace scroll (max-height + thead sticky), estilos `.reco` para la caja de recomendaciones, sección perfil reparada (HTML inválido), header del dashboard sin hints `<kbd>`, y cache-busting `?v=21` en CSS/JS (rompe caché de navegador en cada release). Detalle: [[Mejoras_Panel_Layout_2026-09-22]].
- **#V20 · Mejoras integrales del panel (frontend)** — sesión "te paso el repo y aplico todo": `esc()` anti-XSS aplicado a todo el render, polling con `setTimeout` recursivo, append optimista al enviar como operador, a11y en listas (teclado + `aria-current`), favicon y brand verdes, skeleton en métricas, badge de handoffs pendientes, UX de clave API (mostrar/ocultar, validación, recordar, probar), atajos <kbd>/</kbd> y <kbd>g+d/p/c/t/s</kbd>, sugerencias de cliente, contador/limpiar/solo agotados en productos, doble confirmación de pago y test del bot con timestamps, «escribiendo…» y reiniciar. Detalle en [[Mejoras_Panel_Frontend_2026-09-18]]. Verificado: `node --check` OK y servidor sirviendo los archivos nuevos (HTTP 200).
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