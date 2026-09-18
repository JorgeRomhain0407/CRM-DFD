---
tipo: equipo
creado: 2026-09-08
tags: [equipo, organigrama, departamentos, sesiones]
---

# Organigrama del Proyecto — CRM DFD

> **Modelo empresa:** el proyecto se divide en 5 departamentos. Cada departamento es **una sesión de opencode independiente** que arrancas con su comando. Las 5 pueden correr en paralelo sobre el MISMO repo (`C:\Users\Aleja\AppData\Local\Temp\opencode\CRM-DFD`) — cada una respeta su alcance y escribe solo en su área.

## Mesa directiva (usa esto como referencia cruzada)
- [[Changelog_Versionado]] (lo que está #V1..#V19) · [[Estado_Actual]] (qué ha pasado) · [[En_Progreso]] (qué falta).

---

## 1 · Desarrollo Backend — Rol: Engineering Manager
- **Comando de sesión:** `cd "C:\Users\Aleja\AppData\Local\Temp\opencode\CRM-DFD" && start "Backend" ... npm`
- **Alcance:** motor de recomendaciones, rutas API (`customers.js`, `api.js`), Supabase, middleware TPV, FEFO, integraciones (bot/panel). Decide por otras sesiones cuando tocan su capa.
- **NO toca:** estilos/HTML (lo lleva Diseño), pruebas (QA), seguridad/despliegue (CSO/Release).

## 2 · Mejoras Gráficas / Frontend — Rol: Senior Designer
- **Alcance:** panel (`public/index.html`, `app.js`, CSS), botones, paleta, UX del panel de mostrador. Mejora visual sin romper la caja de recomendaciones #V19.
- **NO toca:** motor de recomendaciones (Backend), rutas (Backend).

## 3 · Tester — Rol: QA Lead
- **Alcance:** pruebas end-to-end del flujo (buscar cliente → caja #V19 → compra mostrador → venta). Reporta bugs con `#V` de referencia y repro. Ejecuta `node --check` antes/después.
- **NO toca código** sin pasar antes por Backend/Diseño (según capa).

## 4 · Ciberseguridad — Rol: Chief Security Officer
- **Alcance:** `x-api-key` en rutas, validación de cédula/telefono (regex `^[VE]?[0-9]{5,9}$`), datos sensibles (cédula inmutable), sanitización, control de acceso al panel (`MOSTRADOR_API_KEY`). Auditoría de las otras 4.
- **NO deployed a producción** sin su visto bueno.

## 5 · Lanzamiento / Despliegue — Rol: Release Manager
- **Alcance:** control de versiones (**GitHub**), merges, auditoría de si el proyecto **sale a producción o sigue** (gate `pm2` + `git pull` en VPS), changelog #V, etiquetas. Decide sobre **desplegar o no**.

---

## Regla de oro
- **Solo Release Manager decide desplegar**. Los demás proponen y hacen commit a `main`; Release hace merge + deploy + escribe el `#V`.
- **Siempre** cierra cada sesión actualizando la bóveda ([[Estado_Actual]] + [[Changelog_Versionado]] + [[En_Progreso]]).
