-- ============================================================================
-- CRM DFD — Importación de ventas del TPV SOINFARMA → hábitos de consumo
-- ============================================================================
-- Ejecutar UNA vez en el SQL Editor de Supabase, DESPUÉS de
-- `migracion-clientes-tpv.sql` (usa `clientes.tpv_cliente_id`).
-- Idempotente (se puede repetir).
--
-- Qué hace:
--   1) Crea `ventas_tpv`: espejo mínimo de las facturas del TPV para
--      idempotencia y trazabilidad (NO es la tabla `ventas` del mostrador).
--   2) Crea el RPC `ventas_tpv_importar`: recibe UNA factura con sus líneas y
--      añade a los hábitos del cliente los productos comprados
--      (`origen='compra'`), sin pisar hábitos manuales.
--
-- Reglas de negocio (acordadas con el owner):
--   - La venta se escanea UNA sola vez en el TPV; el CRM solo lee.
--   - El CRM no vende, no cobra y no toca stock ni puntos.
--   - Si el cliente aún no tiene ficha en el CRM (`sin ficha`), la factura
--     queda registrada y se puede reintentar cuando la ficha exista.
--   - Sin cédula válida no se importa: no habría forma de asociarla.
--   - Idempotente por `tpv_factura_id`: repetir una factura no duplica hábitos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Espejo de facturas del TPV
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ventas_tpv (
  tpv_factura_id     BIGINT PRIMARY KEY,
  tpv_cliente_id     INTEGER,
  cedula             TEXT,
  telefono_cliente   TEXT REFERENCES public.clientes (telefono)
                     ON UPDATE CASCADE ON DELETE SET NULL,
  fecha              TIMESTAMPTZ,
  monto_total        NUMERIC(14, 2),
  tasa               NUMERIC(14, 4),
  puntos_generados   INTEGER,
  puntos_consumidos  INTEGER,
  lineas             JSONB NOT NULL DEFAULT '[]'::jsonb,
  estado             TEXT NOT NULL DEFAULT 'importada'
                     CHECK (estado IN ('importada', 'sin_ficha', 'sin_cedula')),
  motivo             TEXT,
  habitos_agregados  INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ventas_tpv_fecha
  ON public.ventas_tpv (fecha DESC);

CREATE INDEX IF NOT EXISTS idx_ventas_tpv_telefono
  ON public.ventas_tpv (telefono_cliente, fecha DESC)
  WHERE telefono_cliente IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_tpv_pendientes
  ON public.ventas_tpv (updated_at DESC)
  WHERE estado = 'sin_ficha';

ALTER TABLE public.ventas_tpv ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ventas_tpv FROM anon, authenticated;
GRANT ALL ON public.ventas_tpv TO service_role;

DROP TRIGGER IF EXISTS trg_ventas_tpv_updated_at ON public.ventas_tpv;
CREATE TRIGGER trg_ventas_tpv_updated_at
  BEFORE UPDATE ON public.ventas_tpv
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.ventas_tpv IS
  'Espejo de facturas del TPV SOINFARMA importadas por farmacia-sync (#V91). '
  'NO es la tabla ventas del mostrador: sirve para idempotencia, trazabilidad '
  'y para saber qué facturas no tenían ficha de cliente.';
COMMENT ON COLUMN public.ventas_tpv.lineas IS
  'Líneas de FACTURADET: [{sku, cantidad, descripcion}].';

-- ---------------------------------------------------------------------------
-- 2) RPC: importar UNA factura (idempotente por tpv_factura_id)
--
--    out_estado:
--      importada | ya importada | sin ficha | sin cedula | sin cedula (mostrador)
--      | omitido: sin factura
--    out_telefono: teléfono de la ficha usada (NULL si no hubo match)
--    out_habitos:  hábitos nuevos insertados en esta llamada
--    out_sin_producto: líneas cuyo SKU no existe en el catálogo del CRM
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ventas_tpv_importar(
  p_tpv_factura_id    BIGINT,
  p_tpv_cliente_id    INTEGER,
  p_cedula            TEXT,
  p_telefono          TEXT,
  p_fecha             TIMESTAMPTZ,
  p_monto_total       NUMERIC DEFAULT NULL,
  p_tasa              NUMERIC DEFAULT NULL,
  p_puntos_generados  INTEGER DEFAULT NULL,
  p_puntos_consumidos INTEGER DEFAULT NULL,
  p_lineas            JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  out_estado       TEXT,
  out_telefono     TEXT,
  out_habitos      INTEGER,
  out_sin_producto INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cedula       TEXT := NULLIF(upper(btrim(COALESCE(p_cedula, ''))), '');
  v_telefono     TEXT := NULLIF(btrim(COALESCE(p_telefono, '')), '');
  v_lineas       JSONB;
  v_ficha        public.clientes%ROWTYPE;
  v_prev_estado  TEXT;
  v_habitos      INTEGER := 0;
  v_sin_producto INTEGER := 0;
BEGIN
  -- 1) Factura válida
  IF p_tpv_factura_id IS NULL OR p_tpv_factura_id <= 0 THEN
    RETURN QUERY SELECT 'omitido: sin factura'::TEXT, NULL::TEXT, 0, 0;
    RETURN;
  END IF;

  IF v_telefono IS NOT NULL AND v_telefono !~ '^\+[1-9][0-9]{7,14}$' THEN
    v_telefono := NULL;
  END IF;

  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' THEN
    v_lineas := '[]'::jsonb;
  ELSE
    v_lineas := p_lineas;
  END IF;

  -- 2) Ya importada: no se repite trabajo (los hábitos ya están puestos).
  SELECT v.estado INTO v_prev_estado
  FROM public.ventas_tpv AS v
  WHERE v.tpv_factura_id = p_tpv_factura_id;

  IF v_prev_estado = 'importada' THEN
    RETURN QUERY
      SELECT 'ya importada'::TEXT,
             (SELECT v.telefono_cliente FROM public.ventas_tpv AS v
               WHERE v.tpv_factura_id = p_tpv_factura_id),
             0,
             0;
    RETURN;
  END IF;

  -- 2b) Cédula de mostrador: no es una persona. Se registra como no asociable
  --     y NO se generan hábitos. Sin este corte, resolver la ficha del cliente
  --     genérico del TPV metería decenas de miles de facturas como hábitos de
  --     un cliente que no existe.
  IF v_cedula IS NOT NULL AND public.es_cedula_mostrador(v_cedula) THEN
    INSERT INTO public.ventas_tpv AS v (
      tpv_factura_id, tpv_cliente_id, cedula, telefono_cliente, fecha,
      monto_total, tasa, puntos_generados, puntos_consumidos, lineas,
      estado, motivo, habitos_agregados, updated_at
    )
    VALUES (
      p_tpv_factura_id, p_tpv_cliente_id, v_cedula, NULL, p_fecha,
      p_monto_total, p_tasa, p_puntos_generados, p_puntos_consumidos, v_lineas,
      'sin_cedula', 'cedula de mostrador (venta sin cliente identificado)',
      0, NOW()
    )
    ON CONFLICT (tpv_factura_id) DO UPDATE SET
      tpv_cliente_id    = EXCLUDED.tpv_cliente_id,
      cedula            = EXCLUDED.cedula,
      telefono_cliente  = NULL,
      fecha             = COALESCE(EXCLUDED.fecha, v.fecha),
      monto_total       = COALESCE(EXCLUDED.monto_total, v.monto_total),
      tasa              = COALESCE(EXCLUDED.tasa, v.tasa),
      puntos_generados  = COALESCE(EXCLUDED.puntos_generados, v.puntos_generados),
      puntos_consumidos = COALESCE(EXCLUDED.puntos_consumidos, v.puntos_consumidos),
      lineas            = EXCLUDED.lineas,
      estado            = EXCLUDED.estado,
      motivo            = EXCLUDED.motivo,
      updated_at        = NOW();

    RETURN QUERY SELECT 'sin cedula (mostrador)'::TEXT, NULL::TEXT, 0, 0;
    RETURN;
  END IF;

  -- 3) Buscar la ficha: id TPV → cédula → teléfono
  IF p_tpv_cliente_id IS NOT NULL AND p_tpv_cliente_id > 0 THEN
    SELECT * INTO v_ficha
    FROM public.clientes
    WHERE tpv_cliente_id = p_tpv_cliente_id;
  END IF;

  IF v_ficha.telefono IS NULL AND v_cedula IS NOT NULL THEN
    SELECT * INTO v_ficha
    FROM public.clientes
    WHERE cedula = v_cedula;
  END IF;

  IF v_ficha.telefono IS NULL AND v_telefono IS NOT NULL THEN
    SELECT * INTO v_ficha
    FROM public.clientes
    WHERE telefono = v_telefono;
  END IF;

  -- Sin ficha: se registra la factura para poder reintentarla luego.
  IF v_ficha.telefono IS NULL THEN
    INSERT INTO public.ventas_tpv AS v (
      tpv_factura_id, tpv_cliente_id, cedula, fecha, monto_total, tasa,
      puntos_generados, puntos_consumidos, lineas, estado, motivo,
      habitos_agregados, updated_at
    )
    VALUES (
      p_tpv_factura_id, p_tpv_cliente_id, v_cedula, p_fecha, p_monto_total,
      p_tasa, p_puntos_generados, p_puntos_consumidos, v_lineas,
      CASE WHEN v_cedula IS NULL THEN 'sin_cedula' ELSE 'sin_ficha' END,
      CASE WHEN v_cedula IS NULL
           THEN 'la factura no trae cédula válida'
           ELSE 'no hay ficha del cliente en el CRM' END,
      0, NOW()
    )
    ON CONFLICT (tpv_factura_id) DO UPDATE SET
      tpv_cliente_id    = EXCLUDED.tpv_cliente_id,
      cedula            = EXCLUDED.cedula,
      fecha             = COALESCE(EXCLUDED.fecha, v.fecha),
      monto_total       = COALESCE(EXCLUDED.monto_total, v.monto_total),
      tasa              = COALESCE(EXCLUDED.tasa, v.tasa),
      puntos_generados  = COALESCE(EXCLUDED.puntos_generados, v.puntos_generados),
      puntos_consumidos = COALESCE(EXCLUDED.puntos_consumidos, v.puntos_consumidos),
      lineas            = EXCLUDED.lineas,
      estado            = EXCLUDED.estado,
      motivo            = EXCLUDED.motivo,
      updated_at        = NOW();

    RETURN QUERY
      SELECT CASE WHEN v_cedula IS NULL THEN 'sin cedula' ELSE 'sin ficha' END,
             NULL::TEXT, 0, 0;
    RETURN;
  END IF;

  -- 4) Enriquecer el vínculo TPV de la ficha si aún no lo tenía.
  IF v_ficha.tpv_cliente_id IS NULL
     AND p_tpv_cliente_id IS NOT NULL AND p_tpv_cliente_id > 0 THEN
    BEGIN
      UPDATE public.clientes
         SET tpv_cliente_id = p_tpv_cliente_id
       WHERE telefono = v_ficha.telefono;
    EXCEPTION WHEN unique_violation THEN
      -- Otra ficha ya reclamó ese id TPV: decide una persona, no el sync.
      NULL;
    END;
  END IF;

  -- 5) Hábitos: cada SKU comprado entra con origen 'compra'. No pisa
  --    hábitos manuales/legacy (ON CONFLICT DO NOTHING).
  WITH lineas AS (
    SELECT DISTINCT btrim(l->>'sku') AS sku
    FROM jsonb_array_elements(v_lineas) AS l
    WHERE btrim(COALESCE(l->>'sku', '')) <> ''
  )
  INSERT INTO public.cliente_habitos (telefono_cliente, producto_id, origen)
  SELECT v_ficha.telefono, p.id, 'compra'
  FROM lineas AS l
  JOIN public.productos AS p ON p.sku = l.sku
  ON CONFLICT (telefono_cliente, producto_id) DO NOTHING;

  GET DIAGNOSTICS v_habitos = ROW_COUNT;

  -- 6) Líneas cuyo SKU no existe en el catálogo del CRM (solo diagnóstico)
  WITH lineas AS (
    SELECT DISTINCT btrim(l->>'sku') AS sku
    FROM jsonb_array_elements(v_lineas) AS l
    WHERE btrim(COALESCE(l->>'sku', '')) <> ''
  )
  SELECT count(*) INTO v_sin_producto
  FROM lineas AS l
  WHERE NOT EXISTS (SELECT 1 FROM public.productos AS p WHERE p.sku = l.sku);

  -- 7) Registrar la factura como importada (idempotente)
  INSERT INTO public.ventas_tpv AS v (
    tpv_factura_id, tpv_cliente_id, cedula, telefono_cliente, fecha,
    monto_total, tasa, puntos_generados, puntos_consumidos, lineas,
    estado, motivo, habitos_agregados, updated_at
  )
  VALUES (
    p_tpv_factura_id, p_tpv_cliente_id, v_cedula, v_ficha.telefono, p_fecha,
    p_monto_total, p_tasa, p_puntos_generados, p_puntos_consumidos, v_lineas,
    'importada', NULL, v_habitos, NOW()
  )
  ON CONFLICT (tpv_factura_id) DO UPDATE SET
    tpv_cliente_id    = EXCLUDED.tpv_cliente_id,
    cedula            = COALESCE(EXCLUDED.cedula, v.cedula),
    telefono_cliente  = EXCLUDED.telefono_cliente,
    fecha             = COALESCE(EXCLUDED.fecha, v.fecha),
    monto_total       = COALESCE(EXCLUDED.monto_total, v.monto_total),
    tasa              = COALESCE(EXCLUDED.tasa, v.tasa),
    puntos_generados  = COALESCE(EXCLUDED.puntos_generados, v.puntos_generados),
    puntos_consumidos = COALESCE(EXCLUDED.puntos_consumidos, v.puntos_consumidos),
    lineas            = EXCLUDED.lineas,
    estado            = 'importada',
    motivo            = NULL,
    habitos_agregados = EXCLUDED.habitos_agregados,
    updated_at        = NOW();

  RETURN QUERY SELECT 'importada'::TEXT, v_ficha.telefono, v_habitos, v_sin_producto;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Permisos: solo el backend (service_role). Nunca anon/authenticated.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.ventas_tpv_importar(
  BIGINT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, INTEGER, INTEGER, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ventas_tpv_importar(
  BIGINT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, INTEGER, INTEGER, JSONB
) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Verificación rápida
-- ---------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ventas_tpv'
ORDER BY ordinal_position;

-- Rollback:
--   DROP FUNCTION IF EXISTS public.ventas_tpv_importar(
--     BIGINT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, INTEGER, INTEGER, JSONB
--   );
--   DROP TABLE IF EXISTS public.ventas_tpv;
