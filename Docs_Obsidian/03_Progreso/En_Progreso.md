---
tipo: progreso
actualizado: 2026-09-08
tags: [progreso, backlog, pendientes, mejoras]
---

# En Progreso — CRM DFD

> **Regla de esta página:** solo tareas **pendientes de ejecutar** (que tú me entregas) y **mejoras opcionales para próximas versiones** (NO se ejecutan hasta que lo pidas). Cada ítem se enumera como `#V{n}` para que puedas referirte a él ("cierra #V20", "mueve #V22 a B3").
> **Leer junto con:** [[Estado_Actual]] y [[Contexto_IA]].

---

## PENDIENTES POR ENTREGAR (me los pasas tú — aquí los registro)

> *(Vacíos a propósito: no invento tareas. Los rellenas tú en sesión y yo los muevo a esta lista número a número.)*

| # | Tarea | Prioridad | Estado | Notas |
|---|-------|-----------|--------|-------|
| #V20 | *(Pendiente por entregar — teléfono del mostrador en compra, catálogo real TPV, etc.)* | | registrado | — |

---

## MEJORAS OPCIONALES — PRÓXIMAS VERSIONES (NO ejecutar hasta pedirlo)

| # | Mejora | Impacto | Coste | Notas |
|---|--------|---------|-------|-------|
| #V22 | **Catálogo real del TPV** (marcas, lotes, vencimientos) vía middleware `farmacia-sync` | Alto — recomendaciones con datos reales de vencimiento (FEFO real) | Medio | Motor ya lo espera (`lote`, `vencimiento`); falta conectar el sync |
| #V23 | **Eliminar datos de prueba**: `DELETE FROM productos WHERE nombre LIKE '[TEST]%'` y `habitos_consumo` residuales | Limpieza prod | Bajo | Un comando SQL |
| #V24 | **WhatsApp en producción** (webhook público VPS → validar end-to-end real) | Crítico — primer uso real | Alto | Depende de VPS + dominio |
| #V25 | **Cédula CHECK en BD**: `ALTER TABLE clientes ADD CONSTRAINT clientes_cedula_formato_check CHECK (cedula IS NULL OR cedula ~ '^[VE]?[0-9]{5,9}$')` | Integridad mostrador | Bajo | Validado "Success, No rows" — solo correr en Supabase |
| #V26 | Panel: botón **"Comprar en mostrador"** que haga `POST /api/ventas` desde la ficha | Alcance V2 | Medio | Hay caja de recomendaciones; falta el registro de venta directa |

---

## EN CURSO AHORA MISMO (en este momento del incidente)

- **#V19 (cerrado)** — Caja de recomendaciones híbridas cableada al panel (motor visible: hábitos → co-ocurrencia → contenido → populares, cada una con etiqueta + motivo en español).
- **#V18 (cerrado)** — Ruta `GET /clientes/:ident/recomendaciones` + `getRecomendaciones` en `customers.js`.
- **#V17 (cerrado)** — Cédula venezolana a clientes (UNIQUE parcial, inmutable, búsqueda por cédula/teléfono).

## Cómo actualizar
- Al cerrar cada sesión: "Actualiza la bóveda" → mover los `#V{n}` cerrados a [[Decision_Log_001]] / [[Estado_Actual]] y registrar el nuevo changelog en `04_Historial/`.
