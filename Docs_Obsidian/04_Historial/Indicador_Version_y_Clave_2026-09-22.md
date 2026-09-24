---
tipo: historial
fecha: 2026-09-22
tags: [historial, panel, frontend, version, clave, V22]
---

# #V22 · Indicador de versión + aviso de clave API (Frontend)

> Tras el feedback "los paneles siguen funcionando mal, al cambiar de vista no se ve bien".
> Diagnóstico con navegador real (Playwright/Edge, perfil limpio, contra el VPS):
> el cambio de vistas es **correcto** (cada clic deja una única vista visible), todos los endpoints responden **200** (`ventas/resumen`, `carritos`, `productos`, `bot/conversaciones`, `bot/config`) y no hay errores de JS. El síntoma que ve el usuario proviene de **una sesión/caché del navegador antigua**, no del código.

## Cambios (solo `public/`)
- **Indicador de versión visible** en el brand del sidebar (`#appVersion`, píldora "v22"): al ver el panel sabes al instante qué versión está desplegada y si estás ante caché vieja.
- **Aviso de clave API faltante** en el Dashboard (`#noKeyHint`, banner ámbar): si no hay `MOSTRADOR_API_KEY` cargada, el panel lo dice en vez de mostrar secciones vacías que parecen rotas.
- Cache-busting subido a `?v=22` en CSS/JS.

## Archivos tocados
- `public/index.html`, `public/app.js`, `public/styles.css`.

## Verificación
- `node --check public/app.js` OK; HTML sirve `appVersion`, `noKeyHint` y `?v=22`.
- Refactor menor: `.brand-sub` conserva su selector tras insertar las reglas nuevas.

## Estado
- Commit `8a89526` — ver `[[Changelog_Versionado]]`.