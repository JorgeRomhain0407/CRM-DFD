---
tipo: cambiolog
inicio: 2026-09-08
tags: [versionado, changelog, trazabilidad]
---

# Changelog Versionado — #V1 → #V19+

> **Convención:** cada cambio que hago se etiqueta `#V{n}` y se registra aquí **con su hash git real** (la numeración humana queda en este archivo; `git log` es la verdad). Para referirte a cualquier cambio, dime p. ej. **"revierte #V13"** o **"qué tocó #V16"**.
> **Cómo crece:** al cerrar cada sesión hago `git add -A && git commit && git push`, pongo el `#V{n+1}` abajo de cabeza y actualizo [[Estado_Actual]].

## Progreso del cambiolog

| #V | Hash git | Qué hizo |
|----|----------|----------|
| **#V21** | `HASH` | **Panel: ajustes de layout + anti-caché** — página compacta (paddings/gaps), solo la tabla de productos hace scroll (max-height + thead sticky), estilos de la caja de recomendaciones `.reco`, perfil reparado (HTML inválido), header del dashboard sin hints `<kbd>`, y **cache-busting** `?v=21` en CSS/JS (cada release rompe la caché). Detalle: [[Mejoras_Panel_Layout_2026-09-22]]. |
| **#V20** | `6a891aa` | **Panel: mejoras integrales frontend** — `esc()` anti-XSS, polling con `setTimeout` recursivo, append optimista del operador, `label/aria` a11y, favicon+brand degradado, skeleton en métricas, badge de handoffs, UX de clave API (ojo/validar/recordar/probar), atajos de teclado, sugerencias de cliente, contador/limpiar/solo-agotados en productos, doble confirmación de pago y test del bot con timestamps/«escribiendo…»/reiniciar. Detalle: [[Mejoras_Panel_Frontend_2026-09-18]]. |
| **#V19** | `5404bd1` | **Panel: cablear caja de recomendaciones híbridas** en la ficha del cliente (llama `GET /clientes/:ident/recomendaciones` y pinta etiqueta+motivo). *HEAD anterior.* |
| #V18 | `47a6a06` | **API: ruta `GET /clientes/:ident/recomendaciones`** + import `getRecomendaciones` (expone el motor al panel y al bot). |
| #V17 | `278ece6` | **Fix customer: reparar sintaxis `getRecomendaciones`** (purga tokens corruptos) + motor híbrido íntegro. |
| #V16 | `fcab36f` | **Build 16: cédula venezolana** en clientes (UNIQUE parcial, inmutable) + teléfono editable + búsqueda por cédula/teléfono. |
| #V15 | `40ed2d3` | *(confirmar hash — piso #V15..#V1 en Commits reales de git)* |
| … | `git log --oneline` | Resto del historial (Build 1→15). |

## Ver la verdad
```bash
git log --oneline            # cambios reales, del más reciente al más antiguo
git show <hash>              # un #V específico completo
```

## Enlaces
- [[Estado_Actual]] · [[En_Progreso]] · [[Contexto_IA]]
