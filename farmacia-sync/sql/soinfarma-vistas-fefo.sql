/* ============================================================
   SOINFARMA → CRM-DFD : vistas de integración FEFO (D01)
   ------------------------------------------------------------
   Ejecutar en SSMS / sqlcmd con un usuario ADMIN de SOINFARMA.

   SOLO LECTURA: no modifica ni una tabla del fabricante. Crea
   únicamente dos vistas nuevas (si ya existen, se reemplazan).

   Qué expone cada vista (contrato que espera farmacia-sync):
     dbo.v_catalogo_crm_fefo : sku, nombre, descripcion, precio,
                              precio_usd, stock, marca
     dbo.v_lotes_crm        : sku, lote, fecha_vencimiento (ISO), stock

   Decisiones de diseño (verificadas contra el TPV real):
     - v_catalogo_crm se ENVUELVE, no se rehace: precios y stock siguen
       saliendo de la vista que ya usa el CRM hoy (cero regresión).
       Solo se le agrega `marca` via PRODUCTO.IFABRICANTE.
     - El stock por lote se aggregationa sobre INVENTARIO porque un
       mismo (producto, lote) tiene una fila por ubicación/almacén:
         stock = SUM(ICANTIDAD - IRESERVADO) con BACTIVO = 1
     - PRODUCTOLOTE.DFECHAEXP es varchar con formatos mezclados
       ('2024-08-01', '20240801', '202408', '082024') y centinelas
       ('5000-01-01', '') para "sin caducidad" → se normaliza a ISO
       y los centinelas se descartan (un producto sin fecha real no
       debe reportarse como vencimiento en el año 5000).
     - Solo se emiten lotes con fecha válida y stock > 0: son los que
       alimentan el FEFO. El resto es ruido para el CRM.
     - Lote vacío/vacío-espacios → 'S/L' (sin lote) para no perder la
       fecha de caducidad de productos que no tienen código de lote.
   ============================================================ */


/* ------------------------------------------------------------
   1) Lotes con vencimiento (FEFO)
   ------------------------------------------------------------ */
IF OBJECT_ID('dbo.v_lotes_crm', 'V') IS NOT NULL
    DROP VIEW dbo.v_lotes_crm;
GO

CREATE VIEW dbo.v_lotes_crm
AS
WITH limpios AS (
    SELECT
        pl.ILOTE,
        pl.IPRODUCTO,
        pl.BACTIVO,
        LTRIM(RTRIM(pl.VLOTE))      AS VLOTE,
        LTRIM(RTRIM(pl.DFECHAEXP))  AS FECHA
    FROM dbo.PRODUCTOLOTE AS pl
),
normalizados AS (
    SELECT
        ILOTE,
        IPRODUCTO,
        BACTIVO,
        VLOTE,
        CASE
            -- sin fecha / centinelas de "nunca caduca"
            WHEN FECHA IS NULL OR FECHA = ''
              OR FECHA IN ('5000-01-01', '9999-12-31', '1900-01-01') THEN NULL
            -- 2024-08-01
            WHEN LEN(FECHA) = 10
                 THEN CONVERT(varchar(10), TRY_CONVERT(date, FECHA, 23), 23)
            -- 20240831
            WHEN LEN(FECHA) = 8
                 THEN CONVERT(varchar(10), TRY_CONVERT(date,
                        LEFT(FECHA, 4) + '-' + SUBSTRING(FECHA, 5, 2) + '-' + RIGHT(FECHA, 2), 23), 23)
            -- 202408  (YYYYMM)
            WHEN LEN(FECHA) = 6
                 THEN CONVERT(varchar(10), TRY_CONVERT(date,
                        LEFT(FECHA, 4) + '-' + RIGHT(FECHA, 2) + '-01', 23), 23)
            -- 082024  (MMYYYY)
            WHEN LEN(FECHA) = 6
                 THEN CONVERT(varchar(10), TRY_CONVERT(date,
                        RIGHT(FECHA, 2) + '-' + RIGHT(FECHA, 4) + '-01', 23), 23)
            ELSE NULL
        END AS fecha_vencimiento
    FROM limpios
),
stock_lote AS (
    SELECT
        i.IPRODUCTO,
        i.ILOTE,
        SUM(i.ICANTIDAD - i.IRESERVADO) AS stock
    FROM dbo.INVENTARIO AS i
    WHERE i.BACTIVO = 1
    GROUP BY i.IPRODUCTO, i.ILOTE
)
SELECT
    p.VREFERENCIA AS sku,
    CASE WHEN n.VLOTE IS NULL OR n.VLOTE = '' THEN 'S/L' ELSE n.VLOTE END AS lote,
    n.fecha_vencimiento,
    s.stock
FROM normalizados AS n
JOIN dbo.PRODUCTO AS p
  ON p.IPRODUCTO = n.IPRODUCTO
LEFT JOIN stock_lote AS s
  ON s.IPRODUCTO = n.IPRODUCTO
 AND s.ILOTE = n.ILOTE
WHERE n.BACTIVO = 1
  AND n.fecha_vencimiento IS NOT NULL
  AND ISNULL(s.stock, 0) > 0;
GO


/* ------------------------------------------------------------
   2) Catálogo con marca (envuelve la vista que el CRM ya usa)
   ------------------------------------------------------------ */
IF OBJECT_ID('dbo.v_catalogo_crm_fefo', 'V') IS NOT NULL
    DROP VIEW dbo.v_catalogo_crm_fefo;
GO

CREATE VIEW dbo.v_catalogo_crm_fefo
AS
SELECT
    c.sku,
    c.nombre,
    c.descripcion,
    c.precio,
    c.precio_usd,
    c.stock,
    (
        SELECT TOP 1 f.VDESCRIPCION
        FROM dbo.PRODUCTO AS p
        JOIN dbo.FABRICANTE AS f
          ON f.IFABRICANTE = p.IFABRICANTE
        WHERE p.VREFERENCIA = c.sku
        ORDER BY p.IPRODUCTO
    ) AS marca
FROM dbo.v_catalogo_crm AS c;
GO


/* ============================================================
   3) VERIFICACIÓN (solo lectura) — correr después de crear las vistas
   ============================================================ */
PRINT '--- productos con marca (esperado: > 0 y alto %) ---';
SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN marca IS NOT NULL THEN 1 ELSE 0 END) AS con_marca,
    ROUND(100.0 * SUM(CASE WHEN marca IS NOT NULL THEN 1 ELSE 0 END)
          / NULLIF(COUNT(*), 0), 1) AS pct_con_marca
FROM dbo.v_catalogo_crm_fefo;

PRINT '--- muestra de productos ---';
SELECT TOP 10 sku, nombre, precio, precio_usd, stock, marca
FROM dbo.v_catalogo_crm_fefo
ORDER BY sku;

PRINT '--- si con_marca = 0: el sku de v_catalogo_crm NO es PRODUCTO.VREFERENCIA ---';
PRINT '--- muestra de la vista original para comparar ---';
SELECT TOP 5 * FROM dbo.v_catalogo_crm;

PRINT '--- lotes FEFO: total y fecha más próxima ---';
SELECT COUNT(*) AS lotes, MIN(fecha_vencimiento) AS fefo_mas_proximo
FROM dbo.v_lotes_crm;

PRINT '--- muestra de lotes ---';
SELECT TOP 10 sku, lote, fecha_vencimiento, stock
FROM dbo.v_lotes_crm
ORDER BY fecha_vencimiento;

PRINT '--- productos con 2+ lotes: el FEFO elegirá el de fecha más próxima ---';
SELECT TOP 10 sku, COUNT(*) AS lotes, MIN(fecha_vencimiento) AS fefo, SUM(stock) AS stock_total
FROM dbo.v_lotes_crm
GROUP BY sku
HAVING COUNT(*) > 1
ORDER BY fefo;

PRINT '--- alertas de datos (todo en 0 = sano) ---';
SELECT
    SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END)        AS lotes_stock_no_positivo,
    SUM(CASE WHEN fecha_vencimiento IS NULL THEN 1 ELSE 0 END) AS lotes_sin_fecha,
    SUM(CASE WHEN stock < 0 THEN 1 ELSE 0 END)          AS lotes_stock_negativo
FROM dbo.v_lotes_crm;
