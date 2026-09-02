# farmacia-sync — Middleware TPV ⇄ CRM DFD

Conecta el **catálogo (productos + stock)** de la base de datos local del TPV de la
farmacia con la tabla `productos` de Supabase que consume el CRM ("Berta").

> **Trabaja en dos piezas:**
> 1. **servidor** (`src/servidor/`) — corre EN la farmacia, junto a la BD del TPV.
>    Lee el catálogo y lo expone por una pequeña API HTTP.
> 2. **consumidor** (`src/consumidor/`) — corre en el VPS/CRM. Llama a esa API y
>    sincroniza los productos en Supabase (upsert).

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

El servidor expone:
- `GET /health` → estado
- `GET /productos` → `{ "productos": [ { sku, nombre, descripcion, precio, stock } ] }`

Protege `GET /productos` con `FARMACIA_SYNC_TOKEN` (ponlo, sobre todo en producción)
y llama con cabecera `x-api-key: <token>`.

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

## 2. Lado consumidor (corre en el VPS/CRM)

### Instalación
```bash
cd farmacia-sync
npm install
```
Configura en `.env`:
```
CRM_SYNC_URL=http://IP-DE-LA-FARMACIA:4000
CRM_SYNC_TOKEN=<token del servidor farmacia>
SUPABASE_URL=<misma que el CRM>
SUPABASE_SERVICE_ROLE_KEY=<service_role del CRM>
CRM_SYNC_INTERVAL_MIN=15
```

### Migración previa en Supabase
Ejecuta **una vez** en el SQL Editor:
`sql/migracion-productos-sku.sql`
(añade la columna `sku` a `productos` y la función `productos_tpv_upsert`).

### Ejecución
```bash
node src/consumidor/sync.js        # una pasada
node src/consumidor/index.js       # proceso que sincroniza cada CRM_SYNC_INTERVAL_MIN
```

---

## 3. En producción (PM2)

Desde la raíz del repositorio:
```bash
pm2 start ecosystem-farmacia.config.js
pm2 save
```
Levanta `farmacia-sync` (servidor en la farmacia) y `farmacia-consumidor` (sincroniza
con Supabase cada X minutos).

---

## Flujo de datos

```
BD del TPV ──► (servidor farmacia-sync) ──HTTP /productos──► (consumidor CRM)
                                                              │
                                                              ▼
                                                        Supabase productos
                                                              │
                                              ┌───────────────┴───────────────┐
                                              ▼                               ▼
                                      Bot "Berta" (precio/stock)        Panel mostrador
```