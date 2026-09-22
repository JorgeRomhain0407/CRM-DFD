---
tipo: historial
fecha: 2026-09-22
tags: [historial, panel, frontend, layout, V21, cache]
---

# #V21 · Ajustes de layout del panel + anti-caché (Frontend)

> Riesgo del usuario tras desplegar #V20: el panel se veía "todo apilado como si estuviera todo junto en la misma vista". Diagnóstico: el servidor entrega HTML+CSS correctos (verificado desde la propia máquina del usuario contra http://34.122.96.104/ — `styles.css` 200 con `.hidden` y HTML nuevo con `apiKeyRemember`); el síntoma de "apilado" = el navegador renderiza la página **sin CSS/JS** (apertura local `file://` o caché rancia). Solución doble: instrucciones de recarga dura + **cache-busting**.

## Cambios (solo `public/`)
- **Cache-busting** en `<link rel="stylesheet" href="/styles.css?v=21">` y `<script src="/app.js?v=21">`: cada release rompe la caché del navegador al cambiar el query string → se acabó el "no veo mis cambios".
- **Header del dashboard** vuelto al texto original (se quitaron los hints visuales `<kbd>`; los atajos siguen activos).
- **Sección perfil reparada** (HTML inválido preexistente): `btnGuardarPerfil` movido dentro de `.perfil-acciones`, eliminado un `</div>` huérfano, contenedor anidado correctamente.
- **Página compacta**: padding reducido en `.content`/`.card`/`.metrics`/`.stack` y gap de `.view` para que el dashboard quepa sin scroll de página.
- **Solo la tabla de productos hace scroll**: `#view-dashboard .table-wrap` acotada a `max-height: min(420px, 42vh)` con `overflow-y: auto`, y `thead th` sticky (cabecera fija al desplazarse). El resto de la página no scrollea.
- **Estilos de la caja de recomendaciones `.reco`** (faltaban por completo → se veía sin estilo): tarjeta, título, lista con `max-height: 170px` + scroll interno, items en grid `etiqueta · nombre · precio` y motivo.

## Archivos tocados
- `public/index.html`, `public/styles.css`.

## Verificación
- Balance HTML: 68 `<div>` / 68 `</div>`, 11 `<section>` / 11 `</section>`.
- `styles.css` sirve 32 880 bytes con `.hidden` y `.reco`; `index.html` 20 722 bytes con `?v=21`.

## Estado
- Commit `HASH` — hash real: ver `[[Changelog_Versionado]]` (fijado por sesión D05-Release).