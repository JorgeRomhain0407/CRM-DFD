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
 * Perfil SOINFARMA (requiere SELECT sobre PRODUCTO, FABRICANTE,
 * PRODUCTOLOTE e INVENTARIO — la cuenta de la app ya lo tiene):
 *   - marca:    PRODUCTO.IFABRICANTE -> FABRICANTE.VDESCRIPCION
 *   - lotes:    PRODUCTOLOTE (VLOTE, DFECHAEXP) + stock agregado de
 *               INVENTARIO (ICANTIDAD - IRESERVADO) por producto y lote.
 *               Normaliza los formatos de fecha ISO/AAAAMMDD/AAAAMM/MMAAAA
 *               a ISO y descarta centinelas ('5000-01-01', '').
 */

const PERFIL_SOINFARMA = 'soinfarma';

function esSofinfarma(config) {
  return String((config && config.perfil) || '').trim().toLowerCase() === PERFIL_SOINFARMA;
}

// El SKU del catálogo puede venir como int (1) mientras PRODUCTO.VREFERENCIA
// es varchar ('001'): comparamos por clave normalizada para que ambos coincidan.
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
SELECT p.VREFERENCIA AS sku, f.VDESCRIPCION AS marca
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
            WHEN LEN(FECHA) = 6 THEN CONVERT(varchar(10), TRY_CONVERT(date,
                    RIGHT(FECHA, 2) + '-' + RIGHT(FECHA, 4) + '-01', 23), 23)
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
    SELECT p.VREFERENCIA AS sku,
           CASE WHEN n.VLOTE IS NULL OR n.VLOTE = '' THEN 'S/L' ELSE n.VLOTE END AS lote,
           n.fecha_vencimiento,
           s.stock
    FROM normalizados AS n
    JOIN dbo.PRODUCTO AS p ON p.IPRODUCTO = n.IPRODUCTO
    LEFT JOIN stock_lote AS s ON s.IPRODUCTO = n.IPRODUCTO AND s.ILOTE = n.ILOTE
    WHERE n.BACTIVO = 1
      AND n.fecha_vencimiento IS NOT NULL
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
    const result = await pool.request().query(sql);
    const filas = result.recordset || [];

    // Si la vista no trae marca y el perfil es SOINFARMA, la cruzamos contra
    // las tablas base (misma conexión, solo SELECT).
    let marcas = null;
    if (!col.marca && esSofinfarma(c)) {
      marcas = new Map();
      const mr = await pool.request().query(SQL_MARCA_SOINFARMA);
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
      result = await pool.request().query(sql);
    } else {
      result = await pool.request().query(sqlLotesSofinfarma(l.donde));
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

module.exports = { leerProductos, leerLotes };
