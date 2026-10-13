# farmacia-sync — Middleware TPV ⇄ CRM DFD

Conecta el **catálogo (productos + stock)** de la base de datos local del TPV de la
farmacia con la tabla `productos` de Supabase que consume el CRM ("Berta").

> **Trabaja en dos piezas, ambas en el PC de la farmacia:**
> 1. **servidor** (`src/servidor/`) — corre EN la farmacia, junto a la BD del TPV.
>    Lee el catálogo y lo expone por una pequeña API HTTP en `127.0.0.1` (no sale a la red).
> 2. **consumidor** (`src/consumidor/`) — corre en el MISMO PC. Llama a esa API por
>    localhost y sincroniza productos y lotes en Supabase (solo HTTPS saliente).

Las ventas de WhatsApp **se registran solo en el CRM**, no se envían de vuelta al TPV
(por ahora solo importamos catálogo).

---

## 1. Lado servidor (corre en la farmacia)

### Requisitos
- Node.js ≥ 18 instalado en el PC de la farmacia.

### Instalación
```bash
cd farmacia-sync
npm install
cp farmacia.env .env
# Abre .env y configura la BD del TPV (seccion FARMACIA_SYNC_*)
node src/servidor/index.js
```

El servidor expone (solo en `127.0.0.1`, configurable con `FARMACIA_SYNC_HOST`):
- `GET /health` → estado
- `GET /productos` → `{ "productos": [ { sku, nombre, descripcion, precio, precioUsd, marca, stock } ], "lotes": [ { sku, lote, fechaVencimiento, stock } ] | null }`

`lotes` es `null` si no hay lotes configurados; con el perfil `soinfarma` (o
`FARMACIA_SYNC_LOTES_TABLA`) devuelve los lotes con vencimiento, fecha
normalizada a `YYYY-MM-DD` y solo con `stock > 0`.

Protege `GET /productos` con `FARMACIA_SYNC_TOKEN` (ponlo, sobre todo si algún
día expones el puerto) y llama con cabecera `x-api-key: <token>`.

### Perfil `soinfarma` (TPV SOINFARMA, sin permisos de escritura)

```env
FARMACIA_SYNC_DB_TIPO=mssql
FARMACIA_SYNC_DB_TABLA=v_catalogo_crm
FARMACIA_SYNC_PERFIL=soinfarma
# no hace falta FARMACIA_SYNC_COL_MARCA ni FARMACIA_SYNC_LOTES_TABLA
```

Con `FARMACIA_SYNC_PERFIL=soinfarma` el driver mssql **no usa vistas** (el usuario
del TPV solo tiene permisos de `SELECT`; no se escribe nada en la BD del TPV):

- **marca**: `PRODUCTO → FABRICANTE.VDESCRIPCION`, unido al catálogo por
  `PRODUCTO.IPRODUCTO`.
- **lotes**: `PRODUCTOLOTE + INVENTARIO`, agregando
  `SUM(ICANTIDAD - IRESERVADO)` por (producto, lote). Las fechas admiten
  ISO `YYYY-MM-DD`, `YYYYMMDD`, `MMYYYY` y `MMYY`; los centinelas vacíos o fuera
  del rango `1990–2100` se descartan. Lote vacío → `"S/L"`.

**El `sku` del catálogo es `PRODUCTO.IPRODUCTO`** (clave interna), no
`VREFERENCIA` (código con guiones, ej. `00911-1`).


### Drivers de BD del TPV
| `FARMACIA_SYNC_DB_TIPO` | Motor | Driver npm |
|---|---|---|
| `sqlite` | Archivo `.db/.sqlite` | `sqlite3` |
| `mssql` | SQL Server | `mssql` |
| `mysql` | MySQL / MariaDB | `mysql2` |
| `postgres` | PostgreSQL | `pg` |

Configura el mapeo de columnas en el `.env` (`FARMACIA_SYNC_COL_*`): el TPV usa sus
propios nombres de columna (`codigo`, `pvpu`, `stock`, etc.). `sku` debe ser un
código único e inmutable de cada artículo.

> Si el TPV no expone una BD accesible, se puede sustituir `src/drivers/*` por un
> driver que lea un CSV/Excel del TPV. La API no cambia.

---

## 2. Lado consumidor (corre en el mismo PC de la farmacia)

Solo necesita **salida HTTPS a Supabase**: no abre puertos ni requiere IP pública.
Los datos sensibles (service_role) viven en el `.env` de la farmacia.

### Instalación
```bash
cd farmacia-sync
npm install
```
Configura en `.env` (añade estas líneas a las de arriba):
```
CRM_SYNC_URL=http://127.0.0.1:4000
CRM_SYNC_TOKEN=<token del servidor farmacia, vacío si no hay>
SUPABASE_URL=<misma que el CRM>
SUPABASE_SERVICE_ROLE_KEY=<service_role del CRM>
CRM_SYNC_INTERVAL_MIN=15
```

### Migración previa en Supabase
Ejecuta **una vez** en el SQL Editor:
1. `sql/migracion-productos-sku.sql`
   (añade la columna `sku` a `productos` y la función `productos_tpv_upsert`).
2. `sql/migracion-fefo-lotes.sql`
   (crea `lotes`, `lotes_tpv_upsert`, `marca` + `fecha_vencimiento` informativas
   y amplía `productos_tpv_upsert` con `p_marca`).
   > ⚠️ Su última línea revoca `EXECUTE` a `anon/authenticated` en todo el
   > esquema `public`. Aquí no afecta (toda la app usa `service_role`), pero no
   > la copies en un proyecto donde el frontend llame RPCs con la anon key.

Comprueba el estado con:
```bash
node herramientas/verificar-supabase.js   # esquema + RPCs (solo lectura)
node herramientas/verificar-fefo.js       # servidor HTTP + driver directo
```

### Ejecución
```bash
node src/consumidor/sync.js        # una pasada (la recomendada para empezar)
node src/consumidor/index.js       # proceso que sincroniza cada CRM_SYNC_INTERVAL_MIN
```

---

## 3. Dejarlo corriendo en la farmacia

**Así está desplegado (recomendado): tarea programada de Windows.**

1. Copiar al PC de la farmacia `iniciar-farmacia-sync.ps1` y `registrar-tarea.ps1`
   a `C:\farmacia-sync` (opcional: `iniciar-farmacia-sync.cmd` para doble clic).
2. Prueba inmediata:
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\farmacia-sync\iniciar-farmacia-sync.ps1
   ```
3. Arranque automático al iniciar sesión (crea la tarea `FarmaciaSync`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\farmacia-sync\registrar-tarea.ps1
   Start-ScheduledTask -TaskName FarmaciaSync
   ```

`iniciar-farmacia-sync.ps1` mata restos de servidor/consumidor y arranca ambos
ocultos con logs en `server.out.log` / `consumidor.out.log` (stderr en los
`.err.log`). Cerrar ventanas de PowerShell no los afecta; tras un reinicio
vuelven solos con la tarea. Reinicio manual: `Start-ScheduledTask -TaskName FarmaciaSync`.

Alternativa manual (dos ventanas de PowerShell):
```powershell
node src\servidor\index.js       # ventana 1
node src\consumidor\index.js     # ventana 2 (una pasada + cada N minutos)
```

> ⚠️ **No mezclar PM2 con la tarea `FarmaciaSync`**: los dos quieren el puerto
> 4000 y se matan mutuamente (`EADDRINUSE`). Si quedó pm2 de una instalación
> anterior: `pm2 delete all`, `pm2 save --force`, `pm2 kill`.
> `ecosystem-farmacia.config.js` queda como referencia para quien prefiera pm2
> puro, pero nunca junto con la tarea.

---

## Flujo de datos

```
BD del TPV ──► servidor farmacia-sync ──HTTP 127.0.0.1──► consumidor farmacia-sync
   (SOINFARMA)      (sin escrituras)                      │
                                                          ▼
                                                   Supabase (solo saliente)
                                                          │
                                       ┌──────────────────┴──────────────────┐
                                       ▼                                     ▼
                               Bot "Berta" (precio/stock)            Panel mostrador
```
