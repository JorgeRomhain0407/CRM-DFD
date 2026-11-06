'use strict';

/**
 * Driver SQL Server (mssql): lee el catálogo de la BD local del TPV.
 *
 * Config (config):
 *   server, port, user, password, database
 *   tabla / columnas / donde   (mapeo genérico de una tabla o vista)
 *   columnas.marca (opcional): columna de marca/fabricante
 *   perfil: 'soinfarma'        (opcional) — el driver lee la marca y los
 *                                lotes directamente de las tablas base del
 *                                TPV, sin necesidad de vistas.
 *   lotes (opcional): { tabla, donde, columnas: { sku, lote,
 *                      fechaVencimiento, stock } }
 *   trustServerCertificate: true   (instancias locales con cert no verificado)
 *
 *   leerClientes(config, { desde })  (solo perfil SOINFARMA)
 *     Lee CLIENTE (BACTIVO=1) para el alta masiva de fichas. Devuelve cédula,
 *     nombre, teléfono CRUDO del TPV y última compra. NO normaliza ni escribe:
 *     de eso se encarga el consumidor + el RPC clientes_tpv_importar.
 *
 *   leerVentas(config, { desde, limite })  (solo perfil SOINFARMA)
 *     Lee las facturas de FACTURACAB con ICODCLI + cédula (descarta las que no
 *     tienen cliente, nivel 1 del TPV) y sus líneas de FACTURADET. Devuelve la
 *     cédula y el teléfono CRUDOS del TPV; el consumidor los normaliza y el RPC
 *     ventas_tpv_importar los convierte en hábitos. Incremental por IFACTURA.
 *
 * Todas las lecturas van con READ UNCOMMITTED: el TPV está en producción y
 * un SELECT con bloqueos compartidos le provoca deadlocks (observado).
 *
 * Perfil SOINFARMA (requiere SELECT sobre PRODUCTO, FABRICANTE,
 * PRODUCTOLOTE e INVENTARIO — la cuenta de la app ya lo tiene):
 *   - marca:    PRODUCTO.IFABRICANTE -> FABRICANTE.VDESCRIPCION
 *   - lotes:    PRODUCTOLOTE (VLOTE, DFECHAEXP) + stock agregado de
 *               INVENTARIO (ICANTIDAD - IRESERVADO) por producto y lote.
 *               Normaliza los formatos de fecha ISO/AAAAMMDD/AAAAMM/MMAAAA
 *               a ISO y descarta centinelas ('5000-01-01', '').
 */

const PERFIL_SOINFARMA = 'soinfarma';

// READ UNCOMMITTED en TODAS las lecturas: el TPV está en producción y un
// SELECT con bloqueos compartidos choca con sus escrituras (de deadlock
// observado en caliente). Así leemos sin bloquear nada de la farmacia.
const SIN_BLOQUEO = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\n';

function esSofinfarma(config) {
  return String((config && config.perfil) || '').trim().toLowerCase() === PERFIL_SOINFARMA;
}

// El catálogo (v_catalogo_crm) trae el SKU como PRODUCTO.IPRODUCTO, que en
// algunos TPVs viene int y en otros varchar. Normalizamos a clave comparable.
function claveSku(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (/^-?\d+$/.test(s)) return String(Number(s));
  return s.toUpperCase();
}

function fechaISO(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v).trim());
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function fechaHoraISO(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v).trim());
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// El TPV guarda la cédula como "V12345678", pero también aparecen variantes
// con separadores ("V-12.345.678"). Se limpia aquí para que el consumidor
// decida si es válida; el RPC vuelve a validar el formato.
function limpiarCedula(v) {
  return String(v == null ? '' : v)
    .trim()
    .toUpperCase()
    .replace(/[\s.\-–—]+/g, '');
}

async function conectar(c = {}) {
  const mssql = require('mssql');
  return mssql.connect({
    server: c.server,
    port: Number(c.port) || 1433,
    user: c.user,
    password: c.password,
    database: c.database,
    options: {
      trustServerCertificate: c.trustServerCertificate != null ? !!c.trustServerCertificate : true,
      enableArithAbort: true,
      encrypt: false,
    },
  });
}

const SQL_MARCA_SOINFARMA = `
SELECT p.IPRODUCTO AS sku, f.VDESCRIPCION AS marca
FROM dbo.PRODUCTO AS p
JOIN dbo.FABRICANTE AS f ON f.IFABRICANTE = p.IFABRICANTE
WHERE f.VDESCRIPCION IS NOT NULL;`;

function sqlLotesSofinfarma(donde) {
  return (
    `
WITH limpios AS (
    SELECT pl.ILOTE, pl.IPRODUCTO, pl.BACTIVO,
           LTRIM(RTRIM(pl.VLOTE)) AS VLOTE,
           LTRIM(RTRIM(pl.DFECHAEXP)) AS FECHA
    FROM dbo.PRODUCTOLOTE AS pl
),
normalizados AS (
    SELECT ILOTE, IPRODUCTO, BACTIVO, VLOTE,
        CASE
            WHEN FECHA IS NULL OR FECHA = ''
              OR FECHA IN ('5000-01-01', '9999-12-31', '1900-01-01') THEN NULL
            WHEN LEN(FECHA) = 10 THEN CONVERT(varchar(10), TRY_CONVERT(date, FECHA, 23), 23)
            WHEN LEN(FECHA) = 8 THEN CONVERT(varchar(10), TRY_CONVERT(date,
                    LEFT(FECHA, 4) + '-' + SUBSTRING(FECHA, 5, 2) + '-' + RIGHT(FECHA, 2), 23), 23)
            WHEN LEN(FECHA) = 6 THEN CONVERT(varchar(10), TRY_CONVERT(date,
                    LEFT(FECHA, 4) + '-' + RIGHT(FECHA, 2) + '-01', 23), 23)
            ELSE NULL
        END AS fecha_vencimiento
    FROM limpios
),
stock_lote AS (
    SELECT i.IPRODUCTO, i.ILOTE, SUM(i.ICANTIDAD - i.IRESERVADO) AS stock
    FROM dbo.INVENTARIO AS i
    WHERE i.BACTIVO = 1
    GROUP BY i.IPRODUCTO, i.ILOTE
)
SELECT t.sku, t.lote, t.fecha_vencimiento, t.stock
FROM (
    SELECT p.IPRODUCTO AS sku,
           CASE WHEN n.VLOTE IS NULL OR n.VLOTE = '' THEN 'S/L' ELSE n.VLOTE END AS lote,
           n.fecha_vencimiento,
           s.stock
    FROM normalizados AS n
    JOIN dbo.PRODUCTO AS p ON p.IPRODUCTO = n.IPRODUCTO
    LEFT JOIN stock_lote AS s ON s.IPRODUCTO = n.IPRODUCTO AND s.ILOTE = n.ILOTE
    WHERE n.BACTIVO = 1
      AND n.fecha_vencimiento IS NOT NULL
      AND n.fecha_vencimiento BETWEEN '1990-01-01' AND '2100-12-31'
      AND ISNULL(s.stock, 0) > 0
) AS t` + (donde ? ` WHERE ${donde}` : '')
  );
}

async function leerProductos(config) {
  const c = config || {};
  const pool = await conectar(c);

  const col = c.columnas || {};
  const campos = [
    `${col.sku || 'sku'} AS sku`,
    `${col.nombre || 'nombre'} AS nombre`,
    col.descripcion ? `${col.descripcion} AS descripcion` : `NULL AS descripcion`,
    `${col.precio || 'precio'} AS precio`,
    `${col.precioUsd || 'precio_usd'} AS precio_usd`,
    `${col.stock || 'stock'} AS stock`,
    col.marca ? `${col.marca} AS marca` : `NULL AS marca`,
  ].join(', ');

  const sql = `SELECT ${campos} FROM ${c.tabla || 'productos'}` + (c.donde ? ` WHERE ${c.donde}` : '');

  try {
    const result = await pool.request().query(SIN_BLOQUEO + sql);
    const filas = result.recordset || [];

    // Si la vista no trae marca y el perfil es SOINFARMA, la cruzamos contra
    // las tablas base (misma conexión, solo SELECT).
    let marcas = null;
    if (!col.marca && esSofinfarma(c)) {
      marcas = new Map();
      const mr = await pool.request().query(SIN_BLOQUEO + SQL_MARCA_SOINFARMA);
      for (const r of mr.recordset || []) {
        const k = claveSku(r.sku);
        if (k && !marcas.has(k)) marcas.set(k, String(r.marca).trim());
      }
    }

    return filas.map((f) => ({
      sku: String(f.sku),
      nombre: String(f.nombre || '').trim(),
      descripcion: f.descripcion ? String(f.descripcion) : null,
      precio: Number(f.precio),
      precioUsd: f.precio_usd != null && Number.isFinite(Number(f.precio_usd)) ? Number(f.precio_usd) : null,
      stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
      marca: col.marca
        ? f.marca != null && String(f.marca).trim() !== '' ? String(f.marca).trim() : null
        : marcas
          ? marcas.get(claveSku(f.sku)) || null
          : null,
    }));
  } finally {
    await pool.close();
  }
}

async function leerLotes(config) {
  const c = config || {};
  const l = c.lotes || {};
  const perfil = esSofinfarma(c);
  // Config explícita de tabla de lotes gana; si no hay, el perfil decide.
  if (!l.tabla && !perfil) return [];
  const pool = await conectar(c);

  try {
    let result;
    if (l.tabla) {
      const col = l.columnas || {};
      const campos = [
        `${col.sku || 'sku'} AS sku`,
        `${col.lote || 'lote'} AS lote`,
        `${col.fechaVencimiento || 'fecha_vencimiento'} AS fecha_vencimiento`,
        `${col.stock || 'stock'} AS stock`,
      ].join(', ');
      const sql = `SELECT ${campos} FROM ${l.tabla}` + (l.donde ? ` WHERE ${l.donde}` : '');
      result = await pool.request().query(SIN_BLOQUEO + sql);
    } else {
      result = await pool.request().query(SIN_BLOQUEO + sqlLotesSofinfarma(l.donde));
    }

    return (result.recordset || [])
      .map((f) => ({
        sku: String(f.sku),
        lote: String(f.lote || '').trim(),
        fechaVencimiento: fechaISO(f.fecha_vencimiento),
        stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
      }))
      .filter((x) => x.sku !== '' && x.lote !== '' && x.fechaVencimiento);
  } finally {
    await pool.close();
  }
}

async function leerClientes(config, opciones = {}) {
  const c = config || {};
  if (!esSofinfarma(c)) {
    throw new Error(
      'leerClientes solo está implementado para el perfil SOINFARMA (FARMACIA_SYNC_PERFIL=soinfarma).'
    );
  }

  const mssql = require('mssql');
  const pool = await conectar(c);

  try {
    const req = pool.request();
    let donde = "c.BACTIVO = 1 AND LTRIM(RTRIM(ISNULL(c.VREFERENCIA, ''))) <> ''";

    // Pasada incremental por marca de agua (DACTREG/DULTSIN/DULTCOMPRA son
    // datetime del propio TPV): evita reenviar los ~8.200 clientes cada ciclo.
    if (opciones.desde) {
      const desde = opciones.desde instanceof Date ? opciones.desde : new Date(opciones.desde);
      if (isNaN(desde.getTime())) throw new Error('Fecha "desde" inválida para leerClientes.');
      req.input('desde', mssql.DateTime, desde);
      donde +=
        ' AND (c.DACTREG > @desde' +
        ' OR ISNULL(c.DULTSIN, c.DACTREG) > @desde' +
        ' OR ISNULL(c.DULTCOMPRA, c.DACTREG) > @desde)';
    }

    const sql = `
SELECT
  c.ICLIENTE AS tpv_cliente_id,
  LTRIM(RTRIM(c.VREFERENCIA)) AS cedula,
  LTRIM(RTRIM(c.VDESCRIPCION)) AS nombre,
  LTRIM(RTRIM(c.VTELEFONO)) AS telefono,
  LTRIM(RTRIM(c.VCIUDAD)) AS ciudad,
  LTRIM(RTRIM(c.VDIRECCION)) AS direccion,
  c.DULTCOMPRA AS ultima_compra,
  c.DACTREG AS creado_en,
  c.DULTSIN AS actualizado_en
FROM dbo.CLIENTE AS c
WHERE ${donde}
ORDER BY c.ICLIENTE;`;

    const result = await req.query(SIN_BLOQUEO + sql);
    return (result.recordset || [])
      .map((f) => {
        const fechas = [f.actualizado_en, f.creado_en, f.ultima_compra]
          .map(fechaHoraISO)
          .filter(Boolean)
          .map((iso) => new Date(iso).getTime());
        return {
          tpvClienteId: Number(f.tpv_cliente_id),
          cedula: limpiarCedula(f.cedula),
          nombre: String(f.nombre || '').trim(),
          telefono: String(f.telefono || '').trim(),
          ciudad: String(f.ciudad || '').trim() || null,
          direccion: String(f.direccion || '').trim() || null,
          ultimaCompra: fechaHoraISO(f.ultima_compra),
          actualizadoEn: fechas.length ? new Date(Math.max(...fechas)).toISOString() : null,
        };
      })
      .filter((x) => Number.isFinite(x.tpvClienteId) && x.tpvClienteId > 0);
  } finally {
    await pool.close();
  }
}

async function leerVentas(config, opciones = {}) {
  const c = config || {};
  if (!esSofinfarma(c)) {
    throw new Error(
      'leerVentas solo está implementado para el perfil SOINFARMA (FARMACIA_SYNC_PERFIL=soinfarma).'
    );
  }

  const mssql = require('mssql');
  const pool = await conectar(c);

  const desde = Number(opciones.desde);
  if (opciones.desde != null && (!Number.isSafeInteger(desde) || desde < 0)) {
    throw new Error('Parámetro "desde" inválido para leerVentas (usa un entero >= 0).');
  }
  const limite = Math.min(Math.max(Number.parseInt(opciones.limite, 10) || 500, 1), 2000);

  try {
    const req = pool.request();
    req.input('desde', mssql.BigInt, Number.isSafeInteger(desde) ? desde : 0);
    req.input('limite', mssql.Int, limite);

    // Solo facturas CON cliente (ICODCLI > 0) y cédula: son las únicas que se
    // pueden asociar a una ficha del CRM. La cédula puede venir en la cabecera
    // o, si ahí está vacía, en la ficha del cliente del TPV.
    const sqlCab = `
WITH cab AS (
  SELECT
    f.IFACTURA AS tpv_factura_id,
    f.ICODCLI AS tpv_cliente_id,
    COALESCE(
      NULLIF(LTRIM(RTRIM(f.VREFERENCIA)), ''),
      LTRIM(RTRIM(c.VREFERENCIA))
    ) AS cedula,
    LTRIM(RTRIM(c.VDESCRIPCION)) AS cliente_nombre,
    LTRIM(RTRIM(c.VTELEFONO)) AS telefono,
    f.DFECHA AS fecha,
    f.NMONTOTOTAL AS monto_total,
    f.NTASA AS tasa,
    f.IPUNTOSGENERADOS AS puntos_generados,
    f.IPUNTOSCONSUMIDOS AS puntos_consumidos
  FROM dbo.FACTURACAB AS f
  LEFT JOIN dbo.CLIENTE AS c ON c.ICLIENTE = f.ICODCLI
  WHERE f.IFACTURA > @desde
    AND ISNULL(f.ICODCLI, 0) > 0
)
SELECT TOP (@limite) *
FROM cab
WHERE cedula IS NOT NULL AND cedula <> ''
ORDER BY tpv_factura_id;`;

    const cab = await req.query(SIN_BLOQUEO + sqlCab);
    const facturas = (cab.recordset || [])
      .map((f) => {
        const id = Number(f.tpv_factura_id);
        return {
          tpvFacturaId: id,
          tpvClienteId: Number.isFinite(Number(f.tpv_cliente_id)) ? Number(f.tpv_cliente_id) : null,
          cedula: limpiarCedula(f.cedula),
          clienteNombre: String(f.cliente_nombre || '').trim() || null,
          telefono: String(f.telefono || '').trim() || null,
          fecha: fechaHoraISO(f.fecha),
          montoTotal: f.monto_total != null && Number.isFinite(Number(f.monto_total)) ? Number(f.monto_total) : null,
          tasa: f.tasa != null && Number.isFinite(Number(f.tasa)) ? Number(f.tasa) : null,
          puntosGenerados: f.puntos_generados != null && Number.isFinite(Number(f.puntos_generados)) ? Number(f.puntos_generados) : null,
          puntosConsumidos: f.puntos_consumidos != null && Number.isFinite(Number(f.puntos_consumidos)) ? Number(f.puntos_consumidos) : null,
          lineas: [],
        };
      })
      .filter((f) => Number.isSafeInteger(f.tpvFacturaId) && f.tpvFacturaId > 0);

    if (!facturas.length) return [];

    // Las líneas se piden por rango de facturas (≤ 500 ids por consulta) y se
    // reparten en JS. FACTURALOTE no se usa aquí: un producto puede estar en
    // varios lotes y multiplicaría las líneas; el hábito solo necesita el SKU.
    const porId = new Map(facturas.map((f) => [f.tpvFacturaId, f]));
    const ids = [...porId.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      const bloque = ids.slice(i, i + 500);
      // Los ids salen de IFACTURA (numérico) y ya se validaron con
      // Number.isSafeInteger: se pueden interpolar sin riesgo de inyección.
      const sqlDet = `
SELECT d.IFACTURA AS tpv_factura_id,
       d.IPRODUCTO AS sku,
       d.ICANTIDAD AS cantidad,
       d.VDESCRIPCION AS descripcion
FROM dbo.FACTURADET AS d
WHERE d.IFACTURA IN (${bloque.join(',')});`;
      const det = await pool.request().query(SIN_BLOQUEO + sqlDet);
      for (const r of det.recordset || []) {
        const factura = porId.get(Number(r.tpv_factura_id));
        if (!factura) continue;
        const sku = claveSku(r.sku);
        const cantidad = Number(r.cantidad);
        if (!sku || !Number.isFinite(cantidad) || cantidad <= 0) continue;
        factura.lineas.push({
          sku,
          cantidad: Math.floor(cantidad),
          descripcion: String(r.descripcion || '').trim() || null,
        });
      }
    }

    return facturas;
  } finally {
    await pool.close();
  }
}

module.exports = { leerProductos, leerLotes, leerClientes, leerVentas };
