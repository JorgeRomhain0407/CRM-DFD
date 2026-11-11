-- ============================================================================
-- CRM DFD — #V93 · Cédulas de mostrador del TPV (ventas sin cliente real)
-- ============================================================================
-- Ejecutar UNA vez en el SQL Editor de Supabase, DESPUÉS de
-- `migracion-clientes-tpv.sql` y `migracion-ventas-tpv.sql`.
-- Idempotente (se puede repetir sin efectos secundarios).
--
-- Problema que resuelve:
--   El TPV cobra muchas ventas con un cliente "genérico" (V12345678, V123456).
--   Esas cédulas acumulan decenas de miles de facturas y NO son una persona.
--   Si alguien resolviera su ficha en la cola, TODO ese histórico entraría como
--   hábitos de un cliente falso.
--
-- Qué hace:
--   1) Crea `cedulas_mostrador` (lista ampliable con un INSERT) y el helper
--      `es_cedula_mostrador()`.
--   2) Blinda los dos RPC: una cédula de mostrador nunca crea ficha, nunca
--      entra en la cola y nunca genera hábitos.
--   3) Reclasifica el histórico: las facturas de esas cédulas pasan de
--      `sin_ficha` a `sin_cedula` (deja de reintentarlas para siempre).
--   4) Descarta de la cola las fichas pendientes de esas cédulas.
--
-- El CRM sigue sin vender, sin cobrar y sin tocar stock.
--
-- Todo el cambio va en UNA transacción: si algo falla, no queda a medias.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Cédulas de mostrador: ventas sin cliente identificado
--
--    El TPV usa un cliente "genérico" para cobrar sin identificar a nadie.
--    Esas cédulas acumulan decenas de miles de facturas y NO representan a una
--    persona: si se les creara ficha, todo ese histórico entraría como hábitos
--    de un cliente falso. La lista es una tabla para poder ampliarla sin tocar
--    código (basta un INSERT).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cedulas_mostrador (
  cedula      TEXT PRIMARY KEY,
  nota        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cedulas_mostrador ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cedulas_mostrador FROM anon, authenticated;
GRANT ALL ON public.cedulas_mostrador TO service_role;

COMMENT ON TABLE public.cedulas_mostrador IS
  '#V93 Cédulas genéricas del TPV que identifican ventas de mostrador (sin '
  'cliente real). No generan ficha ni hábitos.';

INSERT INTO public.cedulas_mostrador (cedula, nota) VALUES
  ('V12345678', 'cliente genérico del TPV (mostrador)'),
  ('V123456',   'cliente genérico del TPV (mostrador)')
ON CONFLICT (cedula) DO NOTHING;

CREATE OR REPLACE FUNCTION public.es_cedula_mostrador(p_cedula TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cedulas_mostrador
    WHERE cedula = upper(btrim(COALESCE(p_cedula, '')))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.es_cedula_mostrador(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_cedula_mostrador(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 1) RPC de fichas: nunca crea ficha para una cédula de mostrador
--    (sustituye la versión de migracion-clientes-tpv.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clientes_tpv_importar(
  p_tpv_cliente_id INTEGER,
  p_cedula         TEXT,
  p_nombre         TEXT,
  p_telefono       TEXT,
  p_ciudad         TEXT DEFAULT NULL,
  p_direccion      TEXT DEFAULT NULL,
  p_ultima_compra  TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (out_estado TEXT, out_telefono TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cedula       TEXT := NULLIF(upper(btrim(COALESCE(p_cedula, ''))), '');
  v_telefono     TEXT := NULLIF(btrim(COALESCE(p_telefono, '')), '');
  v_nombre       TEXT := NULLIF(btrim(COALESCE(p_nombre, '')), '');
  v_ciudad       TEXT := NULLIF(btrim(COALESCE(p_ciudad, '')), '');
  v_direccion    TEXT := NULLIF(btrim(COALESCE(p_direccion, '')), '');
  v_telefono_ok  BOOLEAN;
  v_ficha        public.clientes%ROWTYPE;
  v_por_telefono public.clientes%ROWTYPE;
  v_por_cedula   public.clientes%ROWTYPE;
BEGIN
  IF p_tpv_cliente_id IS NULL OR p_tpv_cliente_id <= 0 THEN
    RETURN QUERY SELECT 'omitido: sin id TPV'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_cedula IS NULL OR v_cedula !~ '^[A-Z]?[0-9]{5,9}$' THEN
    RETURN QUERY SELECT 'omitido: sin cedula valida'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Cédula de mostrador: no es una persona. Nunca se crea ficha y se retira
  -- de la cola si estaba pendiente (si no, al resolverla se importarían sus
  -- decenas de miles de facturas como hábitos de un cliente falso).
  IF public.es_cedula_mostrador(v_cedula) THEN
    UPDATE public.clientes_tpv_cola
       SET estado = 'descartado', resuelto_en = NOW(), updated_at = NOW()
     WHERE tpv_cliente_id = p_tpv_cliente_id AND estado = 'pendiente';

    RETURN QUERY SELECT 'omitido: cedula de mostrador'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  v_telefono_ok := v_telefono IS NOT NULL AND v_telefono ~ '^\+[1-9][0-9]{7,14}$';

  -- 1) Ficha ya enlazada a este cliente del TPV
  SELECT * INTO v_ficha
  FROM public.clientes
  WHERE tpv_cliente_id = p_tpv_cliente_id;

  IF FOUND THEN
    IF v_ficha.cedula IS NOT NULL AND v_ficha.cedula <> v_cedula THEN
      -- El TPV cambió la cédula de un id ya importado: no se toca la ficha.
      PERFORM public.clientes_tpv_encolar(
        p_tpv_cliente_id, v_cedula, v_nombre, v_telefono,
        v_ciudad, v_direccion, p_ultima_compra, 'cedula_duplicada'
      );
      RETURN QUERY SELECT 'conflicto: cedula distinta'::TEXT, v_ficha.telefono;
      RETURN;
    END IF;

    -- Si la ficha enlazada aún no tenía cédula y otra ficha ya la usa, no se
    -- puede mover el vínculo sin una decisión humana: a la cola.
    IF v_ficha.cedula IS NULL THEN
      SELECT * INTO v_por_cedula
      FROM public.clientes
      WHERE cedula = v_cedula;

      IF FOUND THEN
        PERFORM public.clientes_tpv_encolar(
          p_tpv_cliente_id, v_cedula, v_nombre, v_telefono,
          v_ciudad, v_direccion, p_ultima_compra, 'cedula_duplicada'
        );
        RETURN QUERY SELECT 'conflicto: cedula en otra ficha'::TEXT, v_ficha.telefono;
        RETURN;
      END IF;
    END IF;

    UPDATE public.clientes SET
      nombre = COALESCE(nombre, v_nombre),
      cedula = COALESCE(cedula, v_cedula),
      origen = 'tpv'
    WHERE telefono = v_ficha.telefono;

    UPDATE public.clientes_tpv_cola
       SET estado = 'resuelto', resuelto_en = NOW(), updated_at = NOW()
     WHERE tpv_cliente_id = p_tpv_cliente_id AND estado = 'pendiente';

    RETURN QUERY SELECT 'actualizada'::TEXT, v_ficha.telefono;
    RETURN;
  END IF;

  -- 2) Ficha por cédula (cliente que ya existía en el CRM)
  SELECT * INTO v_ficha
  FROM public.clientes
  WHERE cedula = v_cedula;

  IF FOUND THEN
    IF v_ficha.tpv_cliente_id IS NOT NULL AND v_ficha.tpv_cliente_id <> p_tpv_cliente_id THEN
      -- Dos clientes del TPV con la misma cédula: decide una persona.
      PERFORM public.clientes_tpv_encolar(
        p_tpv_cliente_id, v_cedula, v_nombre, v_telefono,
        v_ciudad, v_direccion, p_ultima_compra, 'cedula_duplicada'
      );
      RETURN QUERY SELECT 'conflicto: cedula en otro cliente TPV'::TEXT, v_ficha.telefono;
      RETURN;
    END IF;

    UPDATE public.clientes SET
      nombre = COALESCE(nombre, v_nombre),
      tpv_cliente_id = p_tpv_cliente_id,
      origen = 'tpv'
    WHERE telefono = v_ficha.telefono;

    UPDATE public.clientes_tpv_cola
       SET estado = 'resuelto', resuelto_en = NOW(), updated_at = NOW()
     WHERE tpv_cliente_id = p_tpv_cliente_id AND estado = 'pendiente';

    RETURN QUERY SELECT 'enriquecida'::TEXT, v_ficha.telefono;
    RETURN;
  END IF;

  -- 3) El teléfono ya está en el CRM
  IF v_telefono_ok THEN
    SELECT * INTO v_por_telefono
    FROM public.clientes
    WHERE telefono = v_telefono;

    IF FOUND THEN
      IF v_por_telefono.cedula IS NULL THEN
        -- Ficha creada por WhatsApp sin cédula: es la misma persona.
        UPDATE public.clientes SET
          cedula = v_cedula,
          nombre = COALESCE(nombre, v_nombre),
          tpv_cliente_id = p_tpv_cliente_id,
          origen = 'tpv'
        WHERE telefono = v_telefono;

        UPDATE public.clientes_tpv_cola
           SET estado = 'resuelto', resuelto_en = NOW(), updated_at = NOW()
         WHERE tpv_cliente_id = p_tpv_cliente_id AND estado = 'pendiente';

        RETURN QUERY SELECT 'enriquecida_por_telefono'::TEXT, v_telefono;
      ELSE
        PERFORM public.clientes_tpv_encolar(
          p_tpv_cliente_id, v_cedula, v_nombre, v_telefono,
          v_ciudad, v_direccion, p_ultima_compra, 'telefono_duplicado'
        );
        RETURN QUERY SELECT 'cola: telefono duplicado'::TEXT, v_por_telefono.telefono;
      END IF;
      RETURN;
    END IF;
  END IF;

  -- 4) Sin teléfono válido: no se crea ficha (nada de números inventados)
  IF NOT v_telefono_ok THEN
    PERFORM public.clientes_tpv_encolar(
      p_tpv_cliente_id, v_cedula, v_nombre, v_telefono,
      v_ciudad, v_direccion, p_ultima_compra,
      CASE WHEN v_telefono IS NULL THEN 'sin_telefono' ELSE 'telefono_invalido' END
    );
    RETURN QUERY SELECT 'cola: sin telefono'::TEXT, v_telefono;
    RETURN;
  END IF;

  -- 5) Alta nueva
  BEGIN
    INSERT INTO public.clientes (telefono, cedula, nombre, origen, tpv_cliente_id)
    VALUES (v_telefono, v_cedula, v_nombre, 'tpv', p_tpv_cliente_id);

    INSERT INTO public.estado_chat (telefono_cliente)
    VALUES (v_telefono)
    ON CONFLICT (telefono_cliente) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    -- Carrera: otra pasada creó la ficha entre el SELECT y el INSERT.
    SELECT * INTO v_ficha
    FROM public.clientes
    WHERE cedula = v_cedula OR telefono = v_telefono
    LIMIT 1;

    IF FOUND AND v_ficha.cedula = v_cedula THEN
      UPDATE public.clientes SET
        tpv_cliente_id = COALESCE(tpv_cliente_id, p_tpv_cliente_id),
        nombre = COALESCE(nombre, v_nombre),
        origen = 'tpv'
      WHERE telefono = v_ficha.telefono;

      RETURN QUERY SELECT 'enriquecida'::TEXT, v_ficha.telefono;
      RETURN;
    END IF;

    PERFORM public.clientes_tpv_encolar(
      p_tpv_cliente_id, v_cedula, v_nombre, v_telefono,
      v_ciudad, v_direccion, p_ultima_compra, 'telefono_duplicado'
    );
    RETURN QUERY SELECT 'cola: telefono duplicado'::TEXT, v_telefono;
    RETURN;
  END;

  UPDATE public.clientes_tpv_cola
     SET estado = 'resuelto', resuelto_en = NOW(), updated_at = NOW()
   WHERE tpv_cliente_id = p_tpv_cliente_id AND estado = 'pendiente';

  RETURN QUERY SELECT 'creada'::TEXT, v_telefono;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) RPC de ventas: registra la factura como no asociable y no toca hábitos
--    (sustituye la versión de migracion-ventas-tpv.sql)
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
-- 3) Histórico: facturas de cédulas de mostrador → `sin_cedula`
--    (salen del bucle de reintentos; NO se borra nada)
-- ---------------------------------------------------------------------------
UPDATE public.ventas_tpv AS v
   SET estado = 'sin_cedula',
       motivo = 'cedula de mostrador (venta sin cliente identificado)',
       telefono_cliente = NULL,
       updated_at = NOW()
 WHERE v.estado = 'sin_ficha'
   AND v.cedula IN (SELECT cedula FROM public.cedulas_mostrador);

-- ---------------------------------------------------------------------------
-- 4) Cola: las fichas pendientes de cédulas de mostrador se descartan
-- ---------------------------------------------------------------------------
UPDATE public.clientes_tpv_cola AS q
   SET estado = 'descartado',
       resuelto_en = NOW(),
       updated_at = NOW()
 WHERE q.estado = 'pendiente'
   AND upper(btrim(COALESCE(q.cedula, ''))) IN (SELECT cedula FROM public.cedulas_mostrador);

COMMIT;

-- ---------------------------------------------------------------------------
-- 5) Verificación (debe salir 0 en "sin ficha de mostrador")
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.cedulas_mostrador) AS cedulas_marcadas,
  (SELECT count(*) FROM public.ventas_tpv WHERE estado = 'sin_cedula'
     AND motivo = 'cedula de mostrador (venta sin cliente identificado)') AS facturas_mostrador,
  (SELECT count(*) FROM public.ventas_tpv v
     WHERE v.estado = 'sin_ficha'
       AND v.cedula IN (SELECT cedula FROM public.cedulas_mostrador)) AS sin_ficha_mostrador,
  (SELECT count(*) FROM public.clientes_tpv_cola q
     WHERE q.estado = 'pendiente'
       AND upper(btrim(COALESCE(q.cedula, ''))) IN (SELECT cedula FROM public.cedulas_mostrador)) AS cola_mostrador,
  (SELECT count(*) FROM public.clientes c
     WHERE c.cedula IN (SELECT cedula FROM public.cedulas_mostrador)) AS fichas_mostrador;

-- Rollback (deja los datos como estaban; el histórico se puede reintentar):
--   UPDATE public.ventas_tpv
--      SET estado = 'sin_ficha', motivo = 'no hay ficha del cliente en el CRM'
--    WHERE estado = 'sin_cedula'
--      AND motivo = 'cedula de mostrador (venta sin cliente identificado)';
--   DELETE FROM public.cedulas_mostrador;
--   DROP FUNCTION IF EXISTS public.es_cedula_mostrador(TEXT);
--   -- Después vuelve a ejecutar migracion-clientes-tpv.sql y migracion-ventas-tpv.sql.
