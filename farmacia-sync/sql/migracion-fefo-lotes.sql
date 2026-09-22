-- CRM-DFD — FEFO: lotes con vencimiento + marca en el catálogo
-- VERSIÓN CANÓNICA (consolida las dos variantes divergentes entre sesiones:
-- esta usa sku+lote y recalcula productos.fecha_vencimiento, que es lo que
-- alimenta el tiebreaker FEFO del motor en tools.js).
-- Ejecutar en el SQL Editor del proyecto Supabase (una pasada, reutilizable).
--
-- Qué hace:
--   1) Añade marca y fecha_vencimiento (informativa) a productos.
--   2) Crea la tabla lotes (sku + lote + fecha_vencimiento + stock).
--   3) Crea el RPC lotes_tpv_upsert (upsert de lote + recalcula fecha_vencimiento
--      del producto como el MIN de sus lotes con stock > 0 → tiebreaker FEFO).
--   4) Amplía productos_tpv_upsert con p_marca SIN romper la llamada clásica
--      de 6 args (el nuevo parámetro va al final con DEFAULT NULL).
--
-- Nota: la columna fecha_vencimiento de productos es INFORMATIVA. La fuente de
-- verdad FEFO son los lotes; el tiebreaker del motor usa esa columna recalculada.
--
-- IMPORTANTE: si tu BD tiene una tabla lotes de un intento anterior con otro
-- esquema (p.ej. con producto_id/codigo), este CREATE TABLE IF NOT EXISTS la
-- saltará en silencio y los RPC fallarán en runtime. Limpia primero:
--   DROP FUNCTION IF EXISTS public.lotes_tpv_upsert(TEXT, TEXT, DATE, INTEGER);
--   DROP FUNCTION IF EXISTS public.lotes_tpv_upsert(TEXT, TEXT, DATE, INTEGER, BOOLEAN);
--   DROP TABLE IF EXISTS public.lotes CASCADE;

-- ---------------------------------------------------------------------------
-- 1) Columnas informativas en productos
-- ---------------------------------------------------------------------------
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS marca TEXT,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

CREATE INDEX IF NOT EXISTS idx_productos_fecha_vencimiento
  ON public.productos (fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

COMMENT ON COLUMN public.productos.marca IS
  'Marca del producto (sync desde el TPV; nullable).';
COMMENT ON COLUMN public.productos.fecha_vencimiento IS
  'Fecha de vencimiento más próxima entre los lotes activos con stock (FEFO). Informativa.';

-- ---------------------------------------------------------------------------
-- 2) Tabla de lotes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lotes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku               TEXT NOT NULL,
  lote              TEXT NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  stock             INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un único lote por (sku, lote). ON CONFLICT usa este índice.
CREATE UNIQUE INDEX IF NOT EXISTS lotes_sku_lote_unico
  ON public.lotes (sku, lote);

CREATE INDEX IF NOT EXISTS idx_lotes_fefo_por_vencer
  ON public.lotes (fecha_vencimiento)
  WHERE activo = TRUE AND stock > 0;

DROP TRIGGER IF EXISTS trg_lotes_updated_at ON public.lotes;
CREATE TRIGGER trg_lotes_updated_at
  BEFORE UPDATE ON public.lotes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) RPC de upsert de lotes (security definer, como el de productos)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lotes_tpv_upsert(TEXT, TEXT, DATE, INTEGER);
DROP FUNCTION IF EXISTS public.lotes_tpv_upsert(TEXT, TEXT, DATE, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION public.lotes_tpv_upsert(
  p_sku               TEXT,
  p_lote              TEXT,
  p_fecha_vencimiento DATE,
  p_stock             INTEGER
)
RETURNS TABLE (out_sku TEXT, out_lote TEXT, out_fecha_vencimiento DATE, out_stock INTEGER, out_mensaje TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_sku IS NULL OR p_sku = '' OR p_lote IS NULL OR p_lote = '' THEN
    RETURN QUERY SELECT NULL::TEXT, p_lote, p_fecha_vencimiento, p_stock,
                        'omitido: sin sku o lote';
    RETURN;
  END IF;

  INSERT INTO public.lotes (sku, lote, fecha_vencimiento, stock, activo)
  VALUES (p_sku, p_lote, p_fecha_vencimiento, p_stock, TRUE)
  ON CONFLICT (sku, lote) DO UPDATE SET
    fecha_vencimiento = EXCLUDED.fecha_vencimiento,
    stock             = EXCLUDED.stock,
    activo            = TRUE,
    updated_at        = NOW();

  -- Recalcula la fecha de vencimiento informativa del producto (FEFO): el MIN
  -- entre sus lotes activos con stock > 0. Si no hay lotes, queda NULL.
  UPDATE public.productos AS prod
  SET fecha_vencimiento = (
        SELECT MIN(l.fecha_vencimiento)
        FROM public.lotes AS l
        WHERE l.sku = prod.sku AND l.activo AND l.stock > 0
      )
  WHERE prod.sku = p_sku;

  RETURN QUERY SELECT p_sku, p_lote, p_fecha_vencimiento, p_stock, 'ok';
END;
$$;

GRANT EXECUTE ON FUNCTION public.lotes_tpv_upsert(TEXT, TEXT, DATE, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Ampliar productos_tpv_upsert con p_marca (al final, con DEFAULT para no
--    romper a los consumidores que aún llaman con 6 args).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.productos_tpv_upsert(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER);
DROP FUNCTION IF EXISTS public.productos_tpv_upsert(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.productos_tpv_upsert(
  p_sku          TEXT,
  p_nombre       TEXT,
  p_descripcion  TEXT,
  p_precio       NUMERIC,
  p_precio_usd   NUMERIC,
  p_stock        INTEGER,
  p_marca        TEXT DEFAULT NULL
)
RETURNS TABLE (out_id UUID, out_sku TEXT, out_nombre TEXT, out_actividad TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_sku IS NULL OR p_sku = '' OR p_nombre IS NULL OR p_nombre = '' THEN
    RETURN QUERY SELECT NULL::UUID, p_sku, p_nombre, 'omitido: sin sku o nombre';
    RETURN;
  END IF;

  INSERT INTO public.productos (sku, nombre, descripcion, precio, precio_usd, stock, activo, marca)
  VALUES (p_sku, p_nombre, p_descripcion, p_precio, p_precio_usd, p_stock, TRUE,
          NULLIF(btrim(COALESCE(p_marca, '')), ''))
  ON CONFLICT (sku) WHERE sku IS NOT NULL DO UPDATE SET
    nombre      = EXCLUDED.nombre,
    descripcion = COALESCE(EXCLUDED.descripcion, public.productos.descripcion),
    precio      = EXCLUDED.precio,
    precio_usd  = EXCLUDED.precio_usd,
    stock       = EXCLUDED.stock,
    marca       = COALESCE(EXCLUDED.marca, public.productos.marca),
    activo      = TRUE,
    updated_at  = NOW();

  RETURN QUERY SELECT pr.id, pr.sku, pr.nombre, 'ok'
               FROM public.productos pr
               WHERE pr.sku = p_sku;
END;
$$;

GRANT EXECUTE ON FUNCTION public.productos_tpv_upsert(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT) TO service_role;
