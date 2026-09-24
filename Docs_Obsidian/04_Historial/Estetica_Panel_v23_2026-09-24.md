---
tipo: historial
fecha: 2026-09-24
version: V23
hash: 189532b
tags: [panel, estetica, ux, tema-oscuro, v23]
---

# #V23 · Paquete estético del panel

**Fecha:** 2026-09-24 · **Hash:** `189532b` · **Ámbito:** solo `public/` (frontend)

## Qué tocó
1. **Tema oscuro** — `[data-theme="dark"]` con overrides de variables; toggle `#btnTema` en el pie del sidebar; persiste en `localStorage` (`panel_tema`) y respeta `prefers-color-scheme` la primera vez.
2. **Fuente Inter** vía Google Fonts (`display=swap`, preconnect) con fallback a Segoe UI/system-ui.
3. **Chips de estado** (`.chip*`) para estados de pedidos y conversaciones con punto de color.
4. **Transición** `viewIn` (fade + slide 4px, 0.18 s) en todas las vistas.
5. **Hover** en tarjetas: elevación sutil (sombra + -1px).
6. **Empty states** con icono de anillo (`.empty::before`).
7. **Mini-gráficas** en el dashboard desde datos reales:
   - Donut de ingresos por canal (`/api/ventas/resumen` → `por_canal`), centro con total abreviado, leyenda con valor por canal.
   - Sparkline de ventas de los últimos 7 días (`/api/ventas`, agrupado por día).
8. **Avatares con iniciales** coloreados deterministamente por hash del nombre (`avatarClass`) en pedidos, lista y detalle de conversaciones.
9. **Toasts globales** (`#toastWrap`, éxito/error) en la mayoría de acciones: pagar pedido, guardar perfil/cliente, config, tomar/devolver chat, enviar como operador.
10. **Pill de conexión** (`#syncStatus`) en el dashboard: ok (verde + hora) o sin conexión (rojo).
11. **Skeleton de tabla** con shimmer en productos mientras carga.
12. **Responsive móvil** (`max-width: 760px`): sidebar horizontal (brand oculto), clave API accesible en primera fila (regresión corregida en la 1ª prueba), tarjetas a 1 columna, inbox apilado.

## Verificación
- `node --check public/app.js` OK.
- Backend real local (`.env`, puerto 3101) + Playwright/Edge: pill "Conectado", donut con segmentos reales (1 canal: Mostrador 4700,90 Bs), sparkline con 2 paths, métricas pobladas, las 5 vistas se alternan bien, tema persiste, **0 errores de consola / 0 page errors / 0 requests fallidos**.
- Móvil (390×844, isMobile): sin overflow horizontal, clave accesible, tema oscuro aplicado (`rgb(14,17,22)`), 0 errores.

## Notas
- Los datos del donut son los reales de la BD: hoy solo hay canal **Mostrador** (WhatsApp sin ventas todavía).
- Backend para la fase analítica pendiente: [[En_Progreso]] #V30 (schemas BD) → #V31 (mini-gráficas ya frontend, falta el `GET /ventas/serie` si se quiere).

## Enlaces
- [[Changelog_Versionado]] · [[Estado_Actual]] · [[En_Progreso]] · [[Mejoras_Panel_Layout_2026-09-22]] · [[Indicador_Version_y_Clave_2026-09-22]]