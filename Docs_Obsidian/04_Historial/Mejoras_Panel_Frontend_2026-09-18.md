---
tipo: historial
fecha: 2026-09-18
tags: [historial, panel, frontend, mejoras, seguridad, ux, V20]
---

# #V20 · Mejoras integrales del panel (Frontend / UX / Seguridad)

> Solicitud del usuario: **"Te paso el repo y aplico todo"** sobre la priorización de mejoras del panel. Sesión 100% frontend (`public/`), sin tocar backend.

## Bugs corregidos
- **XSS por atributo**: añadido helper `esc()` (escapa `&<>"'`) y aplicado a nombres, teléfonos, mensajes, `motivo_handoff`, líneas de pedido y `data-tel` (antes solo se escapaba `<` con `.replace(/</g,'&lt;')`).
- **CSS muerto activado**: `.ped-item-lineas` con toggle ⌄/⌃ por pedido (botón `data-lineas`, `aria-expanded`) — la clase `lineas-on` ya existía pero nadie la producía.
- **Polling frágil → robusto**: se sustituyó `setInterval(…, 10000)` por `setTimeout` recursivo tras completar `loadConversaciones()+refreshConversacionAbierta()`, con guarda anti-solapamiento `polling`.
- **Reseteo del chat al enviar como operador**: ahora append optimista del mensaje sobre el muro (`buildMensajesHtml`) en vez de re-renderizar todo el detalle (perdía foco y parpadeaba).
- **`alert()` eliminados**: errores de `cambiarEstado` y `enviarOperador` ahora se muestran inline en `#convStatus`.
- **a11y**: `.conv-item` y `.ped-item` navegables por teclado (`role="button"`, `tabindex`, Enter/Espacio), `aria-current` en la navegación activa, `:focus-visible` global.

## Visual
- Favicon SVG verde con cruz de farmacia (data URI) + `meta theme-color`.
- Brand con icono de cruz y degradado verde (`#00b894 → #017561`).
- Nav activo con barra lateral verde + badge rojo de handoffs pendientes (`#navHandoff`, estado `esperando_operador`).
- Métricas con iconos por canal y **skeleton shimmer** mientras cargan.
- Radius en el input de la clave API; estilos de stock (rojo=0, ámbar=≤5) y `mark` para resaltar búsqueda.

## Funcional
- **UX clave API**: ojo mostrar/ocultar (`btnToggleKey`), validación debounce 700 ms (`/api/ventas/resumen`), estado inline, botón **Probar clave** y checkbox **Recordar en este equipo** (localStorage; si no, solo sesión).
- **Badge de handoffs pendientes** en el nav de Conversaciones.
- **Atajos de teclado**: <kbd>/</kbd> enfoca el buscador de la vista activa; <kbd>g</kbd> + <kbd>d/p/c/t/s</kbd> navega; <kbd>Esc</kbd> limpia pendientes/cierra sugerencias.
- **Sugerencias de cliente** en la búsqueda (debounce 250 ms, top 6, clic rellena y consulta).
- **Productos**: contador "X de Y", botón limpiar (×), filtro "Solo agotados", resaltado del término buscado, stock crítico coloreado.
- **Marcar como pagado con doble confirmación** (arma el botón 4 s y exige segundo clic).
- **Test del bot**: timestamps `HH:MM` en burbujas, indicador "escribiendo…" animado, botón **Reiniciar chat**, presets de teléfono (`datalist`).
- **Configuración**: contador de caracteres del prompt, aviso de cambios sin guardar al salir (`window.confirm`) y limpieza de `admin_key` tras guardar.

## Archivos tocados
- `public/index.html`, `public/app.js`, `public/styles.css`.

## Verificación
- `node --check public/app.js` OK.
- Servidor local arranca y sirve HTTP 200; `/app.js` y `/styles.css` con el contenido nuevo; sin `alert(` residuales en el JS servido.

## Pendiente
- Commit + push (`git add -A && git commit && git push`) para fijar el hash `#V20` en [[Changelog_Versionado]].