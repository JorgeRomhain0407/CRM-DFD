-- farmacia-sync — Añadir identificador del TPV (sku) a productos
-- Ejecutar en el SQL Editor del proyecto Supabase (una sola pasada).

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS sku TEXT;

-- Precio de venta en dólares (estable) del TPV, además del precio en Bs (precio).
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS precio_usd NUMERIC;

-- Índice único PARCIAL (ignora filas sin sku) para el upsert del middleware.
-- Importante: el ON CONFLICT de la función DEBE incluir "WHERE sku IS NOT NULL"
-- para casar con este índice parcial.
CREATE UNIQUE INDEX IF NOT EXISTS productos_sku_unico
  ON public.productos (sku)
  WHERE sku IS NOT NULL;

-- Función de upsert usada por el middleware (farmacia-sync consumidor).
DROP FUNCTION IF EXISTS public.productos_tpv_upsert(TEXT, TEXT, TEXT, NUMERIC, INTEGER);

CREATE OR REPLACE FUNCTION public.productos_tpv_upsert(
  p_sku           TEXT,
  p_nombre        TEXT,
  p_descripcion   TEXT,
  p_precio        NUMERIC,
  p_precio_usd    NUMERIC,
  p_stock         INTEGER
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

  INSERT INTO public.productos (sku, nombre, descripcion, precio, precio_usd, stock, activo)
  VALUES (p_sku, p_nombre, p_descripcion, p_precio, COALESCE(p_precio_usd, 0), p_stock, TRUE)
  ON CONFLICT (sku) WHERE sku IS NOT NULL DO UPDATE SET
    nombre      = EXCLUDED.nombre,
    descripcion = COALESCE(EXCLUDED.descripcion, public.productos.descripcion),
    precio      = EXCLUDED.precio,
    precio_usd  = EXCLUDED.precio_usd,
    stock       = EXCLUDED.stock,
    activo      = TRUE,
    updated_at  = NOW();

  RETURN QUERY SELECT pr.id, pr.sku, pr.nombre, 'ok'
               FROM public.productos pr
               WHERE pr.sku = p_sku;
END;
$$;

GRANT EXECUTE ON FUNCTION public.productos_tpv_upsert(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER) TO service_role;
