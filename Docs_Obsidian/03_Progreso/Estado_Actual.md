---
tipo: progreso
actualizado: 2026-10-07
tags: [progreso, estado, backlog]
estado_v24: "V24 · fast-ops del panel (Ctrl+K, atajos J/K, paginación de productos, copiar/cotizar, estado en URL) — hash pendiente"
stado_v23: "V23 · paquete estético del panel (tema oscuro, Inter, chips, mini-gráficas, toasts, responsive) — hash 189532b"
stado_v22: "V22 · panel: indicador de versión visible + aviso de clave API faltante — hash 8a89526"
stado_v21: "V21 · ajustes de layout del panel + anti-caché — hash 0565779"
stado_v20: "V20 · mejoras integrales del panel (seguridad/UX/visual, solo public/) — hash 6a891aa"
stado_v27: "V27 · caja de recomendaciones híbridas cableada al panel (HEAD 5404bd1)"

# Estado Actual — CRM DFD

## Hecho / Terminado
- **Infra: dominio + HTTPS público (2026-10-07, VM `crm-vps`, us-central1-a)** — nginx + certbot (Let's Encrypt) con cert para `34-122-96-104.sslip.io` (vence 2026-12-31, auto-renovación por `certbot.timer`); bloque único: `443 ssl` + redirect 80→443 → `proxy_pass 127.0.0.1:3000` (cabeceras `X-Forwarded-*` ya presentes, coherente con `trust proxy = 1`). `PANEL_URL=https://34-122-96-104.sslip.io` en el `.env` de la VM → los enlaces de handoff y re-alerta de #V45 apuntan al panel real (antes `localhost` roto). Verificado en vivo: `/health` → 200 y `GET /webhook?hub.verify_token=...` → devuelve el challenge `12345`. Firewall: regla existente `allow-https-crm` (tag `https-server`) + instancia con tags `http-server;https-server;web`. Pendiente: cambiar la URL del webhook en Meta a `https://34-122-96-104.sslip.io/webhook`; pendiente de hardening: el puerto 3000 sigue en `*:3000` (expuesto a internet fuera de nginx) → **cerrado en #V49** (`HOST=127.0.0.1`, **desplegado 2026-10-07 en v32.2.0**: `ss` confirma `127.0.0.1:3000`, `/health` 200 vía nginx).
- **#V24 · Fast-ops del panel (2026-10-01)** — objetivo elegido por el usuario: *velocidad de uso diario* ("que es rápido de operar"). Command palette `Ctrl+K` (fuzzy multipalabra sobre vistas, clientes, conversaciones, pedidos y productos + *Recientes* en localStorage), atajos `J`/`K` para recorrer chats, `Enter` en el filtro abre la primera, hoja de atajos con `Shift+?`, tabla de productos paginada de 50 en 50 (trae 1.000 filas reales), columna *Acción* para **copiar** el precio o **cotizar** la línea para WhatsApp, y estado de vista en la URL (`#/vista/id`) que sobrevive a recarga, enlace compartido y atrás/adelante. Verificado contra backend real con 0 errores de consola/página/red y móvil sin overflow. 3 regresiones corregidas durante la verificación (overflow móvil, hash pisado al arrancar, `Ctrl+K` bloqueado al escribir). Detalle: [[Fastops_Panel_v24_2026-10-01]].
- **Fase B y C del plan fast-ops NO ejecutadas** (decisión del usuario): B = inbox de 3 paneles, quick actions de pedidos y deshacer con toast; C = capa de datos Supabase/TPV. Quedan disponibles si se piden.
- **Release v32.0.0 · D06 #V43–#V47 integradas + QA runtime D03 VALIDADA (2026-10-07)** — #V44 contingencia (el cliente nunca en silencio) y #V45 handoff robusto (`PANEL_URL` + vigilante 1/min con re-alerta) fusionadas y desplegadas en la VM. Batería E2E D03 contra BD real (teléfono de pruebas `+34900000088`): #V43 operador visible al LLM ✅ · #V44 503 claro con OpenAI roto ✅ · #V45 acuse determinista + re-alerta única por episodio (1 Telegram real, dedupe OK) ✅ · #V46 guardia determinista ✅ · #V30 espejo (secuencia usuario → handoff+tool → asistente) ✅. **Hallazgo con evidencia**: «¿Cuánto X le puedo dar a mi hijo?» evade los 7 patrones del guardia (el LLM sí derivó) → **corregido en #V48** (patrón conservador + 2 casos, batería 23/23; pendiente despliegue en VM).
- **#V30 · BD ágil no estructurada** — tabla `cliente_eventos` (append-only, CHECK de tipos, RLS + grants + sequence), `clientes.perfil` JSONB con GIN, `estado_chat.contexto_bot` rodante, RPCs `registrar_evento_cliente`/`contexto_cliente_snapshot` (SECURITY DEFINER), hook fire-and-forget en `grabarMensaje` (sin PII: canal+chars). Smoke Supabase PASS (2 eventos DESC). Backfill/bench idempotentes. Fusionado a main en **v31.0.0** (hash `5ad01a0`).
- **#V28 · Estados de orden en WhatsApp** — `ver_resumen_carrito` expone `estado_actual` (de `carritos.estado`) + disclaimer obligatorio de tasa de cambio en todos los casos (carrito lleno y vacío); regla en system prompt (unión con el prompt renovado) y en la doc del tool. Fusionado a main en **v31.0.0** (hash `0d71ce7`).
- **Prompt del bot renovado (petición directa del usuario, 2026-09-22, fuera de backlog #V)**: imagen de marca "FarmaBot — asistencia personalizada de Farmacia DFD"; bienvenida cálida con nombre al primer mensaje; formato elegante para las opciones de medicamentos (lista 1️⃣ 2️⃣ 3️⃣, nombre en *negrita* WhatsApp, precio Bs/USD, stock ✅ y cierre con 🛒); emojis moderados (1–3 por mensaje, nunca sustituyendo precios/stock); tono reforzado a atención al cliente. Reglas funcionales y límites sanitarios intactos. Cambios en `src/prompts/system.txt` y sincronizado a `bot_config.system_prompt` vía `scripts/sync-prompt.js` (verificado: longitud en BD 9.897). Pendiente: QA visual del formato en el test del panel (D03).
- **#V23 · Paquete estético del panel** — tema oscuro con toggle persistente (localStorage + `prefers-color-scheme`), fuente Inter, chips de estado, transición entre vistas, hover en tarjetas, empty states con icono, mini-gráficas reales en el dashboard (donut de ingresos por canal y sparkline de ventas de 7 días), avatares de iniciales con color por hash, toasts de éxito/error, pill de conexión con última actualización, skeleton de tabla con shimmer y responsive móvil (regresión corregida: la clave API sigue accesible en móvil). Verificado contra el backend real (donut: Mostrador 4700,90 Bs, sparkline con datos, 0 errores de consola/red). Detalle: [[Estetica_Panel_v23_2026-09-24]].
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