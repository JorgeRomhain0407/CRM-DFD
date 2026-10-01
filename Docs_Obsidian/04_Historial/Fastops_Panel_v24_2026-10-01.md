---
tipo: historial
fecha: 2026-10-01
version: V24
hash: pendiente
tags: [panel, fast-ops, productividad, command-palette, atajos, v24]
---

# #V24 - Fast-ops: operar el panel a velocidad de mostrador

**Fecha:** 2026-10-01 - **Hash:** *(este commit)* - **Ámbito:** solo `public/` (frontend, sin backend)

## Objetivo
Investigación (skill design-consultation) con el usuario: el objetivo elegido fue **velocidad de uso diario** y la impresión clave *"que es rápido de operar"*. Las fases B (inbox de 3 paneles, quick actions de pedidos, deshacer con toast) y C (datos Supabase/TPV) quedaron **descartadas**; esta es solo la **Fase A**.

## Qué tocó
1. **Command palette `Ctrl+K`** (`#palette`): launcher global con fuzzy sobre vistas, clientes, conversaciones, pedidos y productos.
   - Grupos: *Recientes* (localStorage `panel_pal_recentes`, 6 máximo, rehidratado por tipo), *Vistas*, *Clientes*, *Conversaciones*, *Pedidos*, *Productos*.
   - Sólo teclado: `↑`/`↓` (o `Tab`/`Shift+Tab`) mueven, `Enter` ejecuta, `Esc` cierra, clic en el fondo cierra.
   - **Multipalabra**: `"crema facial"` exige que ambos términos aparezcan (se puntúa el más débil); el fuzzy tiene suelo de densidad del 18 % para que `"pedid"` no devuelva 6 nombres largos de catálogo por delante de la vista real.
   - Clientes con debounce de 220 ms contra `/api/clientes?q=`; con el panel servido por HTTP el clipboard usa fallback `execCommand` (no hay secure context).
   - Trigger visible en la barra lateral (`#btnAbrePalette`); en móvil se reduce a botón de icono para no comerse el ancho.
2. **Atajos de operador**: `J`/`K` recorren la lista de conversaciones (en móvil, con `Ctrl`), `Enter` en el filtro abre la primera coincidencia, `Shift+?` abre la **hoja de atajos** (`#helpSheet`, 7 filas). Se conservan `/` y `G`+`d/p/c/t/s`.
   - `Ctrl+K` funciona **aunque estés escribiendo** (es el launcher global, no un atajo de vista).
3. **Paginación de productos**: la tabla trae 1.000 filas reales; ahora renderiza de 50 en 50 con `#btnMasProd` + "Mostrando X de Y". Al filtrar, `prodMostrados` se recalcula sobre la lista coincidente.
4. **Copiar / cotizar por fila** (columna *Acción*): *Copiar* → `Nombre: 22.791,78 Bs / $26.86`; *Cotizar* → línea lista para pegar en WhatsApp. Toast de confirmación; aviso si el portapapeles falla.
5. **Estado de vista en la URL**: hash `#/vista` y `#/vista/id` (pedido o teléfono). Al recargar, al compartir enlace o con atrás/adelante se restaura vista y detalle. `escribirHashSiVisible` evita que la carga inicial (que abre el primer pedido en segundo plano) pise el hash de la vista activa.

## Verificación
- `node --check public/app.js` OK.
- Backend real local (`.env`) + Playwright/Edge: palette abre/cierra con `Ctrl+K` y con el trigger, busca (`"pedid"`, `"vitamina"`, `"5-HTP"`, `"crema facial"`, `"zzzz"`), `Enter` cambia de vista y sincroniza el hash; paginación 50 → 100 filas; portapapeles real = `5-HTP CAPS 100 MG X 60 CAPS - NOW: 22.791,78 Bs / $26.86` y cita `... ¿Te lo dejamos reservado?`; `Shift+?` abre y cierra la hoja; `J`/`J`/`K` recorren la lista y escriben el hash; `Enter` en el filtro abre la primera; `G`+`p` sigue funcionando; **0 errores de consola / 0 page errors / 0 requests fallidos**.
- Regresión #V23: las 5 vistas por `G`, `/` enfoca `#consultaCliente`, tema persiste tras recarga, donut con 2 segmentos, sparkline con 2 paths, pill "Conectado · 20:17", resaltado `<mark>` (21 marcas), "solo agotados", key API y "Cargar más" accesibles en móvil. **0 errores.**
- Móvil (390×844, isMobile + tap): sin overflow horizontal (`scrollWidth === clientWidth === 390`), trigger de búsqueda como icono (38×33), palette a 94 vw, tap en un resultado lleva al producto con su nombre en el buscador.

## Regresiones encontradas y corregidas durante la verificación
1. **Scroll horizontal en móvil**: la columna *Acción* ensancha la tabla y `.content` (grid item) crecía hasta 666 px. Causa: `min-width: auto` por defecto en grid items. Corregido con `.content { min-width: 0 }`.
2. **Hash pisado al arrancar**: `loadPedidos()` abre el primer pedido aunque estés en Dashboard, y eso escribía `#/pedidos/<id>`. Corregido con `escribirHashSiVisible`.
3. **`Ctrl+K` no abría escribiendo**: la guarda `!escribiendo` lo bloqueaba justo cuando más lo usas (p. ej. tras escribir la clave API).

## Notas
- Sin endpoints nuevos: pedidos, conversaciones y productos ya estaban en memoria; los clientes usan el `?q=` existente.
- La hoja de atajos documenta sólo atajos que existen hoy (7 filas), no promesas.
- El fuzzy vive en `fuzzyScore`/`fuzzyTermino`; si en el futuro se quiere buscar por código de barras o laboratorio, es el mismo sitio.

## Enlaces
- [[Changelog_Versionado]] - [[Estado_Actual]] - [[En_Progreso]] - [[Estetica_Panel_v23_2026-09-24]] - [[Mejoras_Panel_Frontend_2026-09-18]]
