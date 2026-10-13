---
tipo: equipo
creado: 2026-09-08
tags: [equipo, organigrama, departamentos, sesiones]
---

# Organigrama del Proyecto — CRM DFD

> **Modelo empresa:** el proyecto se divide en 6 departamentos. Cada departamento es **una sesión de opencode independiente** que arrancas con su comando. Cada uno trabaja en su **rama `dept/*`** (ver [[Ramas_por_Departamento]]) — **nadie escribe directo en `main`**; Release integra.

## Mesa directiva (usa esto como referencia cruzada)
- [[Changelog_Versionado]] (lo que está #V1..#V60) · [[Estado_Actual]] (qué ha pasado) · [[En_Progreso]] (qué falta).

---

## 0 · Project Manager — Rol: Coordinador / Arquitecto (mando principal)
- **Sesión:** *"Continuación CRM farmacia con IA"* · **Rama:** `dept/proyect-manager`.
- **Alcance:** orden y arquitectura del proyecto. La mayoría de tareas pasan por él **primero** (priorización #V, planificación, bóveda). Las decisiones **finales** las toma junto al **usuario**.
- **NO toca:** implementación de capas ajenas (delega en cada departamento).

## 1 · Desarrollo Backend — Rol: Engineering Manager
- **Comando de sesión:** arranca en su worktree `C:\Users\Aleja\Projects\CRM-DFD-backend` (rama `dept/backend`).
- **Alcance:** motor de recomendaciones, rutas API (`customers.js`, `api.js`), Supabase, middleware TPV, FEFO, integraciones (bot/panel). Decide por otras sesiones cuando tocan su capa.
- **NO toca:** estilos/HTML (lo lleva Diseño), pruebas (QA), seguridad/despliegue (CSO/Release).

## 2 · Mejoras Gráficas / Frontend — Rol: Senior Designer
- **Alcance:** panel (`public/index.html`, `app.js`, CSS), botones, paleta, UX del panel de mostrador. Mejora visual sin romper la caja de recomendaciones #V19.
- **NO toca:** motor de recomendaciones (Backend), rutas (Backend).

## 3 · Tester — Rol: QA Lead
- **Alcance:** pruebas end-to-end del flujo (buscar cliente → caja #V19 → compra mostrador → venta). Reporta bugs con `#V` de referencia y repro. Ejecuta `node --check` antes/después.
- **NO toca código** sin pasar antes por Backend/Diseño (según capa).

## 4 · Ciberseguridad — Rol: Chief Security Officer
- **Alcance:** `x-api-key` en rutas, validación de cédula/telefono (regex `^[VE]?[0-9]{5,9}$`), datos sensibles (cédula inmutable), sanitización, control de acceso al panel (**sesión/roles** desde #V59; `MOSTRADOR_API_KEY` obsoleta). Auditoría de los demás departamentos.
- **NO deployed a producción** sin su visto bueno.

## 5 · Lanzamiento / Despliegue — Rol: Release Manager
- **Alcance:** control de versiones (**GitHub**), merges, auditoría de si el proyecto **sale a producción o sigue** (gate `pm2` + `git pull` en VPS), changelog #V, etiquetas. Decide sobre **desplegar o no**.

---

## Regla de oro
- **Solo Release Manager decide desplegar**. Los demás trabajan en su rama `dept/*` y proponen; Release integra en `main` (merge) + deploy + escribe el `#V`.
- **Siempre** cierra cada sesión actualizando la bóveda ([[Estado_Actual]] + [[Changelog_Versionado]] + [[En_Progreso]]).
