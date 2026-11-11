-- ============================================================================
-- CRM DFD — #V89 · Fichas de cliente desde el TPV SOINFARMA (solo lectura)
-- ============================================================================
-- Ejecutar UNA vez en el SQL Editor de Supabase. Idempotente (se puede repetir).
--
-- Qué hace:
--   1) Añade a `clientes` la trazabilidad del TPV (`tpv_cliente_id`, `origen`).
--   2) Crea `clientes_tpv_cola` para las fichas del TPV que NO se pueden crear
--      todavía (sin teléfono válido, teléfono duplicado o cédula duplicada).
--   3) Crea los RPC `clientes_tpv_importar` y `clientes_tpv_encolar` que usa
--      farmacia-sync (service_role) para el alta masiva y las pasadas
--      incrementales.
--
-- Reglas de negocio (acordadas con el owner):
--   - Sin cédula válida NO se importa: no habría match con las ventas del TPV.
--   - Sin teléfono válido NO se crea ficha: el teléfono es la PK del CRM y no
--     se inventan números. La ficha entra en la cola para completarla.
--   - Si la cédula ya existe en el CRM, se enriquece esa ficha (no se duplica).
--   - Si el teléfono ya existe en una ficha SIN cédula, se enriquece esa ficha.
--   - Si el teléfono ya existe en una ficha CON otra cédula, va a la cola
--     (`telefono_duplicado`): decide una persona, no el sincronizador.
--   - NUNCA se cambia el teléfono de una ficha existente: es PK con
--     ON UPDATE CASCADE hacia mensajes/estado y podría partir el chat.
--   - El CRM no escribe nada en el TPV; esto solo importa datos.
--   - Las cédulas de mostrador (`V12345678`, `V123456`…) NO son personas: no
--     se les crea ficha ni se encolan. Ver `cedulas_mostrador`.
-- ============================================================================

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
-- 1) Trazabilidad del origen en `clientes`
-- ---------------------------------------------------------------------------
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tpv_cliente_id INTEGER,
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clientes_origen_check'
      AND conrelid = 'public.clientes'::regclass
  ) THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_origen_check
      CHECK (origen IN ('manual', 'tpv'));
  END IF;
END $$;

-- Un cliente del TPV solo puede apuntar a una ficha del CRM (y viceversa).
CREATE UNIQUE INDEX IF NOT EXISTS clientes_tpv_cliente_id_unico
  ON public.clientes (tpv_cliente_id)
  WHERE tpv_cliente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_origen
  ON public.clientes (origen);

COMMENT ON COLUMN public.clientes.tpv_cliente_id IS
  'ICLIENTE de la tabla CLIENTE del TPV SOINFARMA (NULL si la ficha nació en el CRM).';
COMMENT ON COLUMN public.clientes.origen IS
  'manual = alta en el CRM; tpv = importada desde el TPV (farmacia-sync).';

-- ---------------------------------------------------------------------------
-- 2) Cola de fichas del TPV pendientes de completar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clientes_tpv_cola (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tpv_cliente_id  INTEGER NOT NULL UNIQUE,
  cedula          TEXT,
  nombre          TEXT,
  telefono_tpv    TEXT,
  ciudad          TEXT,
  direccion       TEXT,
  ultima_compra   TIMESTAMPTZ,
  motivo          TEXT NOT NULL DEFAULT 'sin_telefono'
    CHECK (motivo IN ('sin_telefono', 'telefono_invalido', 'telefono_duplicado', 'cedula_duplicada')),
  estado          TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'resuelto', 'descartado')),
  telefono_asignado TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelto_en     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_clientes_tpv_cola_pendientes
  ON public.clientes_tpv_cola (motivo, updated_at DESC)
  WHERE estado = 'pendiente';

ALTER TABLE public.clientes_tpv_cola ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clientes_tpv_cola FROM anon, authenticated;
GRANT ALL ON public.clientes_tpv_cola TO service_role;

DROP TRIGGER IF EXISTS trg_clientes_tpv_cola_updated_at ON public.clientes_tpv_cola;
CREATE TRIGGER trg_clientes_tpv_cola_updated_at
  BEFORE UPDATE ON public.clientes_tpv_cola
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.clientes_tpv_cola IS
  '#V89 Fichas del TPV que no se pudieron crear solas (sin teléfono válido, '
  'teléfono o cédula duplicados). Se resuelven desde el panel (solo gestor).';

-- ---------------------------------------------------------------------------
-- 3) Helper: encolar/actualizar una ficha pendiente (idempotente por id TPV)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clientes_tpv_encolar(
  p_tpv_cliente_id INTEGER,
  p_cedula         TEXT,
  p_nombre         TEXT,
  p_telefono       TEXT,
  p_ciudad         TEXT,
  p_direccion      TEXT,
  p_ultima_compra  TIMESTAMPTZ,
  p_motivo         TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.clientes_tpv_cola AS q (
    tpv_cliente_id, cedula, nombre, telefono_tpv, ciudad, direccion,
    ultima_compra, motivo, estado, updated_at
  )
  VALUES (
    p_tpv_cliente_id,
    NULLIF(upper(btrim(COALESCE(p_cedula, ''))), ''),
    NULLIF(btrim(COALESCE(p_nombre, '')), ''),
    NULLIF(btrim(COALESCE(p_telefono, '')), ''),
    NULLIF(btrim(COALESCE(p_ciudad, '')), ''),
    NULLIF(btrim(COALESCE(p_direccion, '')), ''),
    p_ultima_compra,
    p_motivo,
    'pendiente',
    NOW()
  )
  ON CONFLICT (tpv_cliente_id) DO UPDATE SET
    cedula         = EXCLUDED.cedula,
    nombre         = EXCLUDED.nombre,
    telefono_tpv   = EXCLUDED.telefono_tpv,
    ciudad         = EXCLUDED.ciudad,
    direccion      = EXCLUDED.direccion,
    ultima_compra  = COALESCE(EXCLUDED.ultima_compra, q.ultima_compra),
    motivo         = EXCLUDED.motivo,
    estado         = 'pendiente',
    resuelto_en    = NULL,
    updated_at     = NOW();
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) RPC principal: importar UNA ficha del TPV (idempotente)
--    El teléfono llega YA normalizado a E.164 (+58...) desde farmacia-sync.
--
--    out_estado:
--      creada | enriquecida | enriquecida_por_telefono | actualizada |
--      cola: sin telefono | cola: telefono duplicado |
--      conflicto: cedula distinta | conflicto: cedula en otro cliente TPV |
--      omitido: sin id TPV | omitido: sin cedula valida
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
-- 5) Permisos: solo el backend (service_role). Nunca anon/authenticated.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.clientes_tpv_encolar(INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clientes_tpv_importar(INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clientes_tpv_importar(INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Verificación rápida (debe devolver 2 filas)
-- ---------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'clientes'
  AND column_name IN ('tpv_cliente_id', 'origen')
ORDER BY column_name;

-- Rollback:
--   DROP FUNCTION IF EXISTS public.clientes_tpv_importar(INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS public.clientes_tpv_encolar(INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT);
--   DROP TABLE IF EXISTS public.clientes_tpv_cola;
--   DROP INDEX IF EXISTS public.clientes_tpv_cliente_id_unico;
--   ALTER TABLE public.clientes DROP CONSTRAINT IF EXISTS clientes_origen_check;
--   ALTER TABLE public.clientes DROP COLUMN IF EXISTS tpv_cliente_id, DROP COLUMN IF EXISTS origen;
