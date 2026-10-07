-- =====================================================================
-- #V36 · Programa de fidelización por puntos — CRM DFD
-- =====================================================================
-- EJECUTAR EN EL SQL EDITOR DE SUPABASE (producción). Idempotente: se
-- puede re-ejecutar sin efectos duplicados (las funciones se sustituyen
-- con DROP + CREATE para tolerar cambios de firma; las tablas y columnas
-- usan IF NOT EXISTS).
--
-- DISEÑO (decidido con el usuario 2026-10-01)
--   · Base de cálculo: precio en USD (precio_usd). Motivo: los precios del
--     catálogo están en Bs y el país es inflacionario; el punto vale
--     estable. Si un producto no tiene precio_usd, esa línea NO otorga
--     puntos y queda reportada en el motivo (no se inventa una conversión).
--   · Alcance: TODA compra otorga puntos base. El bonus multiplicador solo
--     se aplica a productos con categoría ASIGNADA A MANO por el operador
--     (productos.categoria_id). Nunca por heurística automática sobre el
--     nombre: medido sobre el catálogo real, el clasificador por palabras
--     clave daba falsos positivos graves ("BETAMER CREMA" → parafarmacia,
--     "FLUOXETINA CAPS" → dermocosmética) y el dinero no puede depender
--     de eso. scripts/proponer-categorias.js solo SUGIERE para revisión.
--   · Canje: el saldo nunca se edita a mano; se mueve con asientos en
--     puntos_movimientos (append-only). El canje lo inicia el operador
--     desde el panel (el bot solo INFORMA). Tope de descuento en % del
--     pedido, configurable.
--   · Flag de seguridad: fidelizacion_config.activo arranca en FALSE. Hasta
--     que el operador lo active, acumular_puntos no otorga nada (devuelve
--     programa_inactivo) y no se toca ningún saldo.
--
-- LÍMITES CONOCIDOS (documentados a propósito, no ocultos)
--   · La caducidad (vigencia_dias) se marca por asiento (vence_en) y se
--     excluye del saldo canjeable; no hay consumo FIFO por asiento. Con el
--     valor por defecto 0 (no caduca) el saldo es exacto.
--   · No existe campo de descuento en el TPV: el canje calcula y registra
--     el descuento, y el operador lo aplica al cobrar.
--
-- SEGURIDAD (patrón del proyecto, AGENTS.md §Migraciones)
--   RLS habilitado + sin policies para anon/authenticated + service_role.
--   SIN "REVOKE EXECUTE ON ALL FUNCTIONS ... FROM PUBLIC" global: ese
--   patrón (farmacia-sync/sql/migracion-fefo-lotes.sql) rompió las RPCs de
--   #V30. Aquí solo se otorga service_role.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Trigger genérico de updated_at (autocontenido: no depender de que
--    public.set_updated_at() exista en este entorno).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fidelizacion_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 1) Configuración del programa (una sola fila, id = 1)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fidelizacion_config (
  id                     SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  activo                 BOOLEAN     NOT NULL DEFAULT FALSE,
  puntos_por_usd         NUMERIC(10,2) NOT NULL DEFAULT 50 CHECK (puntos_por_usd >= 0),
  bonificacion_categoria NUMERIC(10,2) NOT NULL DEFAULT 2  CHECK (bonificacion_categoria >= 1),
  canje_minimo_puntos    INTEGER     NOT NULL DEFAULT 100 CHECK (canje_minimo_puntos >= 0),
  canje_max_porcentaje   NUMERIC(5,2)  NOT NULL DEFAULT 10  CHECK (canje_max_porcentaje >= 0 AND canje_max_porcentaje <= 100),
  vigencia_dias          INTEGER     NOT NULL DEFAULT 0   CHECK (vigencia_dias >= 0),
  nota                   TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.fidelizacion_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_fidelizacion_config ON public.fidelizacion_config;
CREATE TRIGGER trg_fidelizacion_config
  BEFORE UPDATE ON public.fidelizacion_config
  FOR EACH ROW EXECUTE FUNCTION public.fidelizacion_touch_updated_at();

-- ---------------------------------------------------------------------
-- 2) Categorías (curadas por el operador) + vínculo con productos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fidelizacion_categorias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL UNIQUE,
  -- Multiplicador propio opcional. Si es NULL, manda la config
  -- (fidelizacion_config.bonificacion_categoria), que es lo que edita el
  -- operador desde el panel. La categoría solo decide QUIÉN tiene bonus.
  multiplicador NUMERIC(10,2) CHECK (multiplicador IS NULL OR multiplicador >= 1),
  activa        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_fidelizacion_categorias ON public.fidelizacion_categorias;
CREATE TRIGGER trg_fidelizacion_categorias
  BEFORE UPDATE ON public.fidelizacion_categorias
  FOR EACH ROW EXECUTE FUNCTION public.fidelizacion_touch_updated_at();

-- Categorías base del backlog #V36 (idempotente por nombre).
-- multiplicador NULL = usa el bonus de la config del panel.
INSERT INTO public.fidelizacion_categorias (nombre, multiplicador) VALUES
  ('Parafarmacia',   NULL),
  ('Vitaminas',      NULL),
  ('Dermocosmética', NULL)
ON CONFLICT (nombre) DO NOTHING;

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS categoria_id UUID
  REFERENCES public.fidelizacion_categorias (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 3) Recompensas y ofertas (las crea/edita el operador desde el panel)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fidelizacion_recompensas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: hace idempotente el seed de arranque (ON CONFLICT (nombre)) y
  -- evita dos recompensas con el mismo texto en el panel.
  nombre        TEXT NOT NULL UNIQUE,
  descripcion   TEXT,
  tipo          TEXT NOT NULL DEFAULT 'descuento'
                CHECK (tipo IN ('descuento', 'producto', 'envio', 'otro')),
  puntos_costo  INTEGER NOT NULL CHECK (puntos_costo > 0),
  valor         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
  unidad        TEXT NOT NULL DEFAULT 'bs'
                CHECK (unidad IN ('bs', 'porcentaje', 'puntos')),
  limite        INTEGER CHECK (limite IS NULL OR limite > 0),
  activa        BOOLEAN NOT NULL DEFAULT TRUE,
  orden         INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fid_recompensas_activas
  ON public.fidelizacion_recompensas (activa, orden);

DROP TRIGGER IF EXISTS trg_fidelizacion_recompensas ON public.fidelizacion_recompensas;
CREATE TRIGGER trg_fidelizacion_recompensas
  BEFORE UPDATE ON public.fidelizacion_recompensas
  FOR EACH ROW EXECUTE FUNCTION public.fidelizacion_touch_updated_at();

-- Recompensas de arranque (idempotentes por nombre; requiere el UNIQUE de arriba).
INSERT INTO public.fidelizacion_recompensas (nombre, descripcion, tipo, puntos_costo, valor, unidad)
VALUES
  ('10 Bs de descuento',   'Descuento de 10 Bs en tu próxima compra.', 'descuento', 100, 10,   'bs'),
  ('5% de descuento',      '5% de descuento en tu próxima compra (tope 10% del pedido).', 'descuento', 250, 5, 'porcentaje')
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4) Libro mayor de puntos (append-only; el saldo es la suma)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.puntos_movimientos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono_cliente TEXT NOT NULL
                   REFERENCES public.clientes (telefono)
                   ON UPDATE CASCADE ON DELETE CASCADE,
  tipo             TEXT NOT NULL
                   CHECK (tipo IN ('acumulacion', 'canje', 'ajuste', 'anulacion')),
  puntos           INTEGER NOT NULL CHECK (puntos <> 0),
  referencia       TEXT NOT NULL,
  saldo_despues    INTEGER NOT NULL,
  recompensa_id    UUID REFERENCES public.fidelizacion_recompensas (id) ON DELETE SET NULL,
  motivo           TEXT,
  vence_en         TIMESTAMPTZ,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotencia: una compra (o un canje) no se asienta dos veces.
  CONSTRAINT puntos_movimientos_unico UNIQUE (telefono_cliente, tipo, referencia)
);

CREATE INDEX IF NOT EXISTS idx_puntos_mov_tel_fecha
  ON public.puntos_movimientos (telefono_cliente, created_at DESC);

-- ---------------------------------------------------------------------
-- 5) RPC · fidelity_config_upsert (el operador edita las reglas)
--    SECURITY DEFINER: solo service_role tiene EXECUTE.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fidelizacion_config_upsert(
  BOOLEAN, NUMERIC, NUMERIC, INTEGER, NUMERIC, INTEGER, TEXT);

CREATE FUNCTION public.fidelizacion_config_upsert(
  p_activo               BOOLEAN,
  p_puntos_por_usd       NUMERIC,
  p_bonificacion_categoria NUMERIC,
  p_canje_minimo_puntos  INTEGER,
  p_canje_max_porcentaje NUMERIC,
  p_vigencia_dias        INTEGER,
  p_nota                 TEXT DEFAULT NULL
)
RETURNS public.fidelizacion_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.fidelizacion_config;
BEGIN
  IF p_activo AND (p_puntos_por_usd IS NULL OR p_puntos_por_usd < 0) THEN
    RAISE EXCEPTION 'puntos_por_usd debe ser >= 0 para activar el programa';
  END IF;

  UPDATE public.fidelizacion_config
  SET activo                 = COALESCE(p_activo, activo),
      puntos_por_usd         = COALESCE(p_puntos_por_usd, puntos_por_usd),
      bonificacion_categoria = COALESCE(p_bonificacion_categoria, bonificacion_categoria),
      canje_minimo_puntos    = COALESCE(p_canje_minimo_puntos, canje_minimo_puntos),
      canje_max_porcentaje   = COALESCE(p_canje_max_porcentaje, canje_max_porcentaje),
      vigencia_dias          = COALESCE(p_vigencia_dias, vigencia_dias),
      nota                   = COALESCE(p_nota, nota)
  WHERE id = 1
  RETURNING * INTO v_cfg;

  RETURN v_cfg;
END;
$$;

-- ---------------------------------------------------------------------
-- 6) RPC · fidelizacion_saldo
--    Devuelve saldo total, saldo canjeable (sin caducados), últimos
--    movimientos y recompensas activas con affordability.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fidelizacion_saldo(TEXT);

CREATE FUNCTION public.fidelizacion_saldo(p_telefono TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE(c.vigencia_dias, 0) AS vigencia_dias,
           COALESCE(c.canje_minimo_puntos, 0) AS canje_minimo_puntos
    FROM public.fidelizacion_config c
    WHERE c.id = 1
  ),
  movs AS (
    SELECT m.tipo, m.puntos, m.referencia, m.saldo_despues, m.motivo,
           m.created_at, m.vence_en, m.recompensa_id,
           (cfg.vigencia_dias > 0 AND m.vence_en IS NOT NULL
              AND m.vence_en < NOW()) AS caducado
    FROM public.puntos_movimientos m
    CROSS JOIN cfg
    WHERE m.telefono_cliente = p_telefono
  ),
  agg AS (
    SELECT COALESCE(SUM(puntos), 0)::int AS saldo,
           COALESCE(SUM(puntos) FILTER (WHERE NOT caducado), 0)::int AS saldo_canjeable
    FROM movs
  )
  SELECT jsonb_build_object(
    'saldo',            agg.saldo,
    'saldo_canjeable',  agg.saldo_canjeable,
    'caducados',        COALESCE((SELECT SUM(puntos) FROM movs WHERE caducado), 0)::int,
    'canje_minimo',     cfg.canje_minimo_puntos,
    'programa_activo',  COALESCE((SELECT activo FROM public.fidelizacion_config WHERE id = 1), FALSE),
    'ultimo_movimiento', (
      SELECT jsonb_build_object(
               'tipo', tipo, 'puntos', puntos, 'motivo', motivo,
               'created_at', created_at, 'caducado', caducado)
      FROM movs ORDER BY created_at DESC LIMIT 1
    ),
    'movimientos', COALESCE((
      SELECT jsonb_agg(x.obj ORDER BY x.created_at DESC)
      FROM (
        SELECT created_at,
               jsonb_build_object(
                 'tipo', tipo, 'puntos', puntos, 'motivo', motivo,
                 'created_at', created_at, 'caducado', caducado) AS obj
        FROM movs LIMIT 20
      ) x
    ), '[]'::jsonb),
    'recompensas', COALESCE((
      SELECT jsonb_agg(r.obj ORDER BY r.orden, r.nombre)
      FROM (
        SELECT rr.orden, rr.nombre,
               jsonb_build_object(
                 'id', rr.id, 'nombre', rr.nombre, 'descripcion', rr.descripcion,
                 'tipo', rr.tipo, 'puntos_costo', rr.puntos_costo,
                 'valor', rr.valor, 'unidad', rr.unidad,
                 'alcanzable', (agg.saldo_canjeable >= rr.puntos_costo
                                AND agg.saldo_canjeable >= cfg.canje_minimo_puntos)) AS obj
        FROM public.fidelizacion_recompensas rr
        WHERE rr.activa
      ) r
    ), '[]'::jsonb)
  )
  FROM agg CROSS JOIN cfg;
$$;

-- ---------------------------------------------------------------------
-- 7) RPC · fidelizacion_acumular
--    p_items: [{ "producto_id": "<uuid>", "cantidad": 2 }, ...]
--    Un asiento agregado por compra; idempotente por
--    (telefono, tipo, referencia).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fidelizacion_acumular(TEXT, TEXT, JSONB, TEXT);

CREATE FUNCTION public.fidelizacion_acumular(
  p_telefono   TEXT,
  p_referencia TEXT,
  p_items      JSONB,
  p_canal      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg      public.fidelizacion_config;
  v_item     JSONB;
  v_prod     public.productos%ROWTYPE;
  v_cantidad INTEGER;
  v_mult     NUMERIC(10,2);
  v_puntos   INTEGER;
  v_total    INTEGER := 0;
  v_saldo    INTEGER;
  v_lineas   JSONB := '[]'::jsonb;
  v_sin_precio TEXT[] := ARRAY[]::TEXT[];
  v_id       UUID;
  v_vence    TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_cfg FROM public.fidelizacion_config WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'sin_config', 'puntos', 0);
  END IF;

  -- Cerrojo por cliente ANTES de leer el saldo: serializa las compras
  -- simultáneas del mismo cliente. Sin esto, dos compras concurrentes
  -- leerían el mismo saldo y la segunda grabaría un saldo_despues erroneo.
  -- La fila existe porque el movimiento tiene FK a clientes(telefono).
  PERFORM 1 FROM public.clientes WHERE telefono = p_telefono FOR UPDATE;

  -- Saldo actual (para responder aunque el programa esté inactivo).
  SELECT COALESCE(SUM(puntos), 0)::int INTO v_saldo
  FROM public.puntos_movimientos
  WHERE telefono_cliente = p_telefono;

  IF NOT COALESCE(v_cfg.activo, FALSE) THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'programa_inactivo',
                              'puntos', 0, 'saldo', v_saldo);
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'items_vacios', 'puntos', 0, 'saldo', v_saldo);
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    -- UUID inválido: se salta la línea en vez de tumbar toda la compra.
    IF (v_item ->> 'producto_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_sin_precio := v_sin_precio || ('producto_id_invalido:' || COALESCE(v_item ->> 'producto_id', '?'));
      CONTINUE;
    END IF;

    v_cantidad := GREATEST(1, COALESCE((v_item ->> 'cantidad')::int, 1));

    SELECT * INTO v_prod FROM public.productos WHERE id = (v_item ->> 'producto_id')::uuid;
    IF NOT FOUND THEN
      v_sin_precio := v_sin_precio || ('producto_inexistente:' || (v_item ->> 'producto_id'));
      CONTINUE;
    END IF;

    IF v_prod.precio_usd IS NULL OR v_prod.precio_usd <= 0 THEN
      v_sin_precio := v_sin_precio || ('sin_precio_usd:' || v_prod.nombre);
      CONTINUE;
    END IF;

    -- Multiplicador: si el producto está en una categoría curada y activa,
    -- se aplica el bonus de la config (bonificacion_categoria); si no, 1.
    v_mult := 1;
    IF v_prod.categoria_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.fidelizacion_categorias fc
        WHERE fc.id = v_prod.categoria_id AND fc.activa
      ) THEN
        v_mult := COALESCE(v_cfg.bonificacion_categoria, 1);
      END IF;
    END IF;

    v_puntos := ROUND(v_prod.precio_usd * v_cantidad * v_cfg.puntos_por_usd * COALESCE(v_mult, 1))::int;

    v_lineas := v_lineas || jsonb_build_object(
      'producto_id', v_prod.id,
      'nombre',      LEFT(v_prod.nombre, 80),
      'cantidad',    v_cantidad,
      'precio_usd',  v_prod.precio_usd,
      'multiplicador', COALESCE(v_mult, 1),
      'puntos',      v_puntos
    );
    v_total := v_total + COALESCE(v_puntos, 0);
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'ok', TRUE, 'motivo', 'sin_puntos', 'puntos', 0, 'saldo', v_saldo,
      'detalle', v_sin_precio
    );
  END IF;

  -- Idempotencia: si el asiento ya existe, no se duplica.
  INSERT INTO public.puntos_movimientos (
    telefono_cliente, tipo, puntos, referencia, saldo_despues,
    motivo, vence_en, metadata
  )
  VALUES (
    p_telefono, 'acumulacion', v_total, p_referencia, v_saldo + v_total,
    'Compra ' || COALESCE(p_canal, 'sin canal'),
    CASE WHEN v_cfg.vigencia_dias > 0
         THEN NOW() + (v_cfg.vigencia_dias || ' days')::interval
         ELSE NULL END,
    jsonb_build_object('canal', p_canal, 'total_puntos', v_total, 'lineas', v_lineas)
  )
  ON CONFLICT (telefono_cliente, tipo, referencia) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'motivo', 'duplicado',
                              'puntos', 0, 'saldo', v_saldo);
  END IF;

  v_saldo := v_saldo + v_total;
  v_vence := CASE WHEN v_cfg.vigencia_dias > 0
                  THEN NOW() + (v_cfg.vigencia_dias || ' days')::interval
                  ELSE NULL END;

  -- Espejo en clientes.perfil.puntos (para el snapshot de #V30).
  UPDATE public.clientes
  SET perfil = jsonb_set(COALESCE(perfil, '{}'::jsonb), '{puntos}', to_jsonb(v_saldo), TRUE)
  WHERE telefono = p_telefono;

  RETURN jsonb_build_object(
    'ok', TRUE, 'motivo', 'acumulado', 'puntos', v_total, 'saldo', v_saldo,
    'vence_en', v_vence, 'detalle', v_sin_precio
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 8) RPC · fidelizacion_canjear
--    Lo inicia el operador (panel). Calcula el descuento respetando el
--    tope de % del pedido y descuenta los puntos con asiento.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fidelizacion_canjear(TEXT, UUID, TEXT, NUMERIC);

CREATE FUNCTION public.fidelizacion_canjear(
  p_telefono      TEXT,
  p_recompensa    UUID,
  p_referencia    TEXT,
  p_monto_pedido  NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg   public.fidelizacion_config;
  v_rec   public.fidelizacion_recompensas%ROWTYPE;
  v_saldo INTEGER;
  v_saldo_canjeable INTEGER;
  v_tope  NUMERIC;
  v_desc  NUMERIC := 0;
  v_id    UUID;
  v_usados INTEGER;
BEGIN
  SELECT * INTO v_cfg FROM public.fidelizacion_config WHERE id = 1;
  IF NOT FOUND OR NOT COALESCE(v_cfg.activo, FALSE) THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'programa_inactivo');
  END IF;

  SELECT * INTO v_rec FROM public.fidelizacion_recompensas
  WHERE id = p_recompensa AND activa;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'recompensa_no_disponible');
  END IF;

  -- Cerrojo por cliente ANTES de leer el saldo: evita que un canje y una
  -- compra simultáneos del mismo cliente compitan por el saldo.
  PERFORM 1 FROM public.clientes WHERE telefono = p_telefono FOR UPDATE;

  -- El movimiento tiene FK a clientes(telefono): si el cliente no existe,
  -- se avisa claro en vez de reventar con un error de FK.
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE telefono = p_telefono) THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'cliente_no_existe');
  END IF;

  -- Saldo canjeable (excluye caducados).
  SELECT COALESCE(SUM(puntos), 0)::int INTO v_saldo
  FROM public.puntos_movimientos WHERE telefono_cliente = p_telefono;

  SELECT COALESCE(SUM(puntos), 0)::int INTO v_saldo_canjeable
  FROM public.puntos_movimientos
  WHERE telefono_cliente = p_telefono
    AND (vence_en IS NULL OR vence_en >= NOW() OR tipo <> 'acumulacion');

  IF v_saldo_canjeable < v_cfg.canje_minimo_puntos THEN
    RETURN jsonb_build_object(
      'ok', FALSE, 'motivo', 'minimo_no_alcanzado',
      'saldo_canjeable', v_saldo_canjeable,
      'minimo', v_cfg.canje_minimo_puntos
    );
  END IF;

  IF v_saldo_canjeable < v_rec.puntos_costo THEN
    RETURN jsonb_build_object(
      'ok', FALSE, 'motivo', 'puntos_insuficientes',
      'saldo_canjeable', v_saldo_canjeable, 'requeridos', v_rec.puntos_costo
    );
  END IF;

  -- Límite de usos (si la recompensa está acotada).
  IF v_rec.limite IS NOT NULL THEN
    SELECT COUNT(*) INTO v_usados
    FROM public.puntos_movimientos
    WHERE recompensa_id = v_rec.id AND tipo = 'canje';
    IF v_usados >= v_rec.limite THEN
      RETURN jsonb_build_object('ok', FALSE, 'motivo', 'recompensa_agotada',
                                'limite', v_rec.limite);
    END IF;
  END IF;

  -- Descuento según unidad.
  IF v_rec.unidad = 'bs' THEN
    v_desc := v_rec.valor;
  ELSIF v_rec.unidad = 'porcentaje' THEN
    IF COALESCE(p_monto_pedido, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', FALSE, 'motivo', 'monto_pedido_requerido');
    END IF;
    v_desc := ROUND(COALESCE(p_monto_pedido, 0) * v_rec.valor / 100, 2);
  END IF;

  -- Tope global de descuento en % del pedido.
  IF COALESCE(p_monto_pedido, 0) > 0 THEN
    v_tope := ROUND(COALESCE(p_monto_pedido, 0) * v_cfg.canje_max_porcentaje / 100, 2);
    IF v_desc > v_tope THEN v_desc := v_tope; END IF;
  END IF;

  INSERT INTO public.puntos_movimientos (
    telefono_cliente, tipo, puntos, referencia, saldo_despues,
    recompensa_id, motivo, metadata
  )
  VALUES (
    p_telefono, 'canje', -v_rec.puntos_costo, p_referencia,
    v_saldo - v_rec.puntos_costo, v_rec.id,
    v_rec.nombre,
    jsonb_build_object('descuento', v_desc, 'unidad', v_rec.unidad,
                       'valor', v_rec.valor, 'monto_pedido', p_monto_pedido,
                       'tope_aplicado', COALESCE(p_monto_pedido, 0) > 0
                                     AND v_desc = ROUND(COALESCE(p_monto_pedido, 0)
                                         * v_cfg.canje_max_porcentaje / 100, 2))
  )
  ON CONFLICT (telefono_cliente, tipo, referencia) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'motivo', 'duplicado', 'saldo', v_saldo);
  END IF;

  UPDATE public.clientes
  SET perfil = jsonb_set(COALESCE(perfil, '{}'::jsonb), '{puntos}',
                         to_jsonb(v_saldo - v_rec.puntos_costo), TRUE)
  WHERE telefono = p_telefono;

  RETURN jsonb_build_object(
    'ok', TRUE, 'motivo', 'canjeado',
    'descuento', v_desc, 'unidad', v_rec.unidad,
    'puntos_usados', v_rec.puntos_costo,
    'saldo', v_saldo - v_rec.puntos_costo,
    'recompensa', v_rec.nombre
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 9) RPC · fidelizacion_ajuste (operador): suma o resta puntos a mano
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fidelizacion_ajuste(TEXT, INTEGER, TEXT, TEXT);

CREATE FUNCTION public.fidelizacion_ajuste(
  p_telefono TEXT,
  p_puntos   INTEGER,
  p_motivo   TEXT,
  p_referencia TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo INTEGER;
  v_ref   TEXT;
  v_id    UUID;
BEGIN
  IF COALESCE(p_puntos, 0) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'puntos_cero');
  END IF;

  -- Cerrojo por cliente ANTES de leer el saldo (ver fidelizacion_acumular).
  PERFORM 1 FROM public.clientes WHERE telefono = p_telefono FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE telefono = p_telefono) THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'cliente_no_existe');
  END IF;

  SELECT COALESCE(SUM(puntos), 0)::int INTO v_saldo
  FROM public.puntos_movimientos WHERE telefono_cliente = p_telefono;

  v_ref := COALESCE(NULLIF(p_referencia, ''),
                    'ajuste:' || to_char(NOW(), 'YYYYMMDDHH24MISS') || ':' || p_telefono);

  IF (v_saldo + p_puntos) < 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'motivo', 'saldo_insuficiente',
                              'saldo', v_saldo);
  END IF;

  INSERT INTO public.puntos_movimientos (
    telefono_cliente, tipo, puntos, referencia, saldo_despues, motivo
  )
  VALUES (
    p_telefono, 'ajuste', p_puntos, v_ref, v_saldo + p_puntos,
    COALESCE(p_motivo, 'Ajuste manual del operador')
  )
  ON CONFLICT (telefono_cliente, tipo, referencia) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'motivo', 'duplicado', 'saldo', v_saldo);
  END IF;

  UPDATE public.clientes
  SET perfil = jsonb_set(COALESCE(perfil, '{}'::jsonb), '{puntos}',
                         to_jsonb(v_saldo + p_puntos), TRUE)
  WHERE telefono = p_telefono;

  RETURN jsonb_build_object('ok', TRUE, 'motivo', 'ajustado',
                            'puntos', p_puntos, 'saldo', v_saldo + p_puntos);
END;
$$;

-- ---------------------------------------------------------------------
-- 10) Seguridad: RLS + permisos solo para service_role
-- ---------------------------------------------------------------------
ALTER TABLE public.fidelizacion_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fidelizacion_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fidelizacion_recompensas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_movimientos      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fidelizacion_config     FROM anon, authenticated;
REVOKE ALL ON public.fidelizacion_categorias FROM anon, authenticated;
REVOKE ALL ON public.fidelizacion_recompensas FROM anon, authenticated;
REVOKE ALL ON public.puntos_movimientos      FROM anon, authenticated;

GRANT ALL ON public.fidelizacion_config     TO service_role;
GRANT ALL ON public.fidelizacion_categorias TO service_role;
GRANT ALL ON public.fidelizacion_recompensas TO service_role;
GRANT ALL ON public.puntos_movimientos      TO service_role;

REVOKE ALL ON FUNCTION public.fidelizacion_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fidelizacion_config_upsert(BOOLEAN, NUMERIC, NUMERIC, INTEGER, NUMERIC, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fidelizacion_saldo(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fidelizacion_acumular(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fidelizacion_canjear(TEXT, UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fidelizacion_ajuste(TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fidelizacion_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.fidelizacion_config_upsert(BOOLEAN, NUMERIC, NUMERIC, INTEGER, NUMERIC, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fidelizacion_saldo(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fidelizacion_acumular(TEXT, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fidelizacion_canjear(TEXT, UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.fidelizacion_ajuste(TEXT, INTEGER, TEXT, TEXT) TO service_role;

-- =====================================================================
-- FIN. Después de pegarlo:
--   1. Verificar que existe: SELECT * FROM fidelizacion_config;
--      → activo = false (el programa NO acumula hasta que se active).
--   2. Probar en caliente desde el panel → vista Fidelización.
--   3. Activar el programa con la tasa que elija el operador.
-- =====================================================================
