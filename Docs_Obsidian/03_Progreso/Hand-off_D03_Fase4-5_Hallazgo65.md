# Hand-off D03 → Departamentos | Fase 4/5 + Hallazgo #V65 7.5

- **Fecha:** 2026-10-16
- **Origen:** `dept/tester` (rama D03 QA, report-only; no toca `src/`, `sql/`, `public/`)
- **Build vivo verificado:** `217b69c` (#V65)

## 1) Fase 4 — BUG 6: stock nunca debe salir como cifra al LLM ("banda, nunca cifra") → **D01 (Backend, `src/services/tools.js` + SQL opcional)**

### 1.1 Focos de fuga (cifras exactas de stock hacia tools/LLM)
En `src/services/tools.js` se exponen `stock` (entero) al resultado devuelto por tools que consume el bot:

| Ubicación | Función/tool | Campo | Acción requerida |
|-----------|-------------|-------|-----------------|
| `tools.js:113-122` (JS path `consultarPrecioYStockJS`) | `consultar_precio_y_stock` (fallback JS) | `stock: p.stock`, `disponible: p.stock > 0` | **Eliminar `stock`**. Mantener solo indicador de disponibilidad (banda). Propuesta: `disponible: boolean` (OK), pero NO devolver entero `stock`. Alternativa: `disponibilidad: 'alta'|'media'|'baja'|'agotado'` si se quiere banda granular; **nunca cifra**. |
| `tools.js:551-563` | `recomendar_productos` | `stock: r.stock` (línea ~559) | **Eliminar `stock`**. Solo booleano `disponible` o `etiqueta`/`motivo`. |
| RPC passthrough `agregar_al_carrito` (línea ~191-195) | `agregar_al_carrito` → devuelve resultado de `rpc('agregar_item_carrito', ...)` | incluye `stock_restante` (INTEGER) en la respuesta de la función SQL (ver `sql/schema.sql` definición de `agregar_item_carrito` RETURNS TABLE con `stock_restante INTEGER`) | **Sanitizar respuesta** antes de devolver al LLM: no pasar `stock_restante`. Devolver únicamente lo operativo necesario (p.ej. `ok`, `mensaje`, `cantidad_en_carrito`) sin cifras de stock. Opcional: convertir a banda si se quiere feedback (“quedan pocas unidades”) — pero preferible **eliminar entero**. |
| RPC `buscar_productos_bot` (línea ~39-51 en `consultarPrecioYStock`) | tool `consultar_precio_y_stock` vía RPC | devuelve filas con `stock`, `disponible` (ver `sql/migracion-v57-busqueda.sql:226`: `'stock', r.stock, 'disponible', r.stock > 0`) | **Sanitizar en capa tools** (server-side) antes de devolver al ejecutor del LLM: mapear resultados para **quitar `stock`** (entero). No confiar solo en prompt: la sanitización debe ser **server-side** (herramientas). |

### 1.2 Reglas a aplicar (server-side)
1. **Nunca** devolver `stock` (número entero) en respuestas de herramientas consumidas por el LLM.  
2. **Solo banda**: `disponible: boolean` es aceptable como banda (no cifra). Si se necesita granularidad, usar etiquetas (`'agotado'|'baja'|'media'|'alta'`) sin valores numéricos.  
3. **Aplicar sanitización en `src/services/tools.js`** (punto único): mapear cada resultado de herramientas (`consultar_precio_y_stock`, `recomendar_productos`, `agregar_al_carrito`) para eliminar campos con cifras de stock. Esto evita filtrados en prompt y asegura cumplimiento incluso si cambia la RPC/SQL.  
4. **Coherencia carrito**: `agregar_al_carrito` puede devolver `cantidad_en_carrito` (operativo), pero **nunca** `stock_restante` (cifra).  
5. **Verificación obligatoria**: tras el fix, ninguna respuesta de esas herramientas debe contener claves `stock` o `stock_restante` con valor numérico.

### 1.3 Criterios de aceptación (D03 QA)
- `POST /api/bot/test` (gestor) preguntando “¿cuánto stock tienes de 5-HTP?” **NO** revela cifras (0,1,X). Debe responder con banda (“agotado/disponible…” o redirigir a búsqueda) sin números de stock.  
- `consultar_precio_y_stock` vía bot no devuelve `stock` numérico en el resultado serializado.  
- `recomendar_productos` (tool) no devuelve `stock`.  
- `agregar_al_carrito` (tool) no devuelve `stock_restante`.  
- Tests/manuales con evidencia `.gstack/qa-reports/evidencia-stock-*` (existentes) pasan con la nueva forma (banda).

---

## 2) Fase 5 — BUG 5: drift del prompt + mantener nombre BD → **D06 (Flujos IA, `src/prompts/system.txt`, `scripts/sync-prompt.js`)**

### 2.1 Estado actual
- BD `bot_config.system_prompt` (id=1): **11235** chars (updated_at `2026-09-28T18:36:15.787+00:00`). Contiene menciones de `stock`. Nombre: **“Defi”**.
- `src/prompts/system.txt`: **11748** chars (drift +423). También menciona `stock`, nombre **“Defi”**.
- `scripts/check-prompt-drift.js` (tester) detecta drift.

### 2.2 Decisión aprobada
- **Conservar el nombre de la BD** (“Defi”).  
- **Solo quitar el bloque de stock/cifras** del prompt.  
- **No sincronizar `system.txt → BD`** hasta alinear (diff intencional).

### 2.3 Acciones (D06)
1. Tomar BD como fuente o editar `system.txt` eliminando solo referencias/instrucciones que obliguen a devolver cifras de stock (sin cambiar “Defi”).  
2. Reemplazar por instrucciones de **banda** (“indica si está disponible o agotado; si hay pocas unidades, dilo cualitativamente, nunca con cifras”).  
3. Alinear `system.txt`; verificar con `scripts/check-prompt-drift.js`. Decidir sincronización con `sync-prompt.js` según política.

### 2.4 Criterios de aceptación (D03 QA)
- Drift esperado solo en líneas modificadas (stock).  
- Prompt no obliga a devolver cifras de stock (puede usar disponibilidad/banda).  
- Nombre permanece “Defi”.  
- Coherente con Fase 4 en `bot/test`.

---

## 3) Hallazgo #V65 7.5 → **D01/D02 (Backend + Frontend)**

`PUT /api/clientes` con `producto_id` inexistente devuelve **200** y **borra los hábitos previos** (`setClienteHabitos` delete+insert + filtro silencioso; `src/services/customers.js:185-`, `src/routes/api.js:171-183`). Panel no avisa.

### Acciones sugeridas
- **D01 (Backend):** validar existencia de **todos** los `producto_id` antes de borrar hábitos. Si alguno no existe → **400** (`Algunos hábitos no existen en el catálogo`) **sin** ejecutar delete+insert. Usar `EXISTS`/`IN` contra `productos(activo=true)`.
- **D02 (Frontend):** ante 400 por hábitos inválidos, mostrar aviso y **conservar** selección previa.

### Criterio de aceptación (D03 QA)
- `PUT /api/clientes/:id` con `producto_id` inexistente → **400**, **no borra** hábitos existentes. Mensaje claro.  
- Todos válidos → 200, hábitos reemplazados (7.3).

---

## 4) D05 — CI guard (refuerzo)
- `npm run check-tools` existente (Fase 2). Añadir job `guard` en `.github/workflows/deploy.yml` con:
  - `node scripts/check-tools-schema.js` sobre `src/lib/openai-tools.json` (exit 0)
  - `node scripts/check-openai.js --tools` (gate manual/CI según política; gate LLM real **manual** de release)
- `scripts/check-prompt-drift.js` (tester) puede ser **no bloqueante** hasta alinear tras Fase 5.

## Notas D03
- Líneas citadas sobre `main` (`217b69c`); `dept/tester` 39 commits detrás.  
- #V65 QA 13/13 PASS (`b57aaf4`).  
- `+34900000088` creado/eliminado (0 residuos).  
- Password gestor `.env` local obsoleto en prod (usado `prueba`).  

**Entrega D03:** este hand-off + `scripts/check-prompt-drift.js` (tester). Fixes → D01/D02/D06.