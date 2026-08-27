-- CRM DFD — esquema de producción (Supabase / PostgreSQL)
-- Ejecutar en el SQL Editor del proyecto Supabase.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_conversacion') THEN
    CREATE TYPE public.estado_conversacion AS ENUM (
      'bot_activo',
      'esperando_operador',
      'humano_activo'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.es_e164(p_telefono TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_telefono ~ '^\+[1-9][0-9]{7,14}$';
$$;

CREATE TABLE IF NOT EXISTS public.clientes (
  telefono          TEXT PRIMARY KEY CHECK (public.es_e164(telefono)),
  nombre            TEXT,
  edad              SMALLINT CHECK (edad IS NULL OR (edad BETWEEN 0 AND 120)),
  habitos_consumo   TEXT,
  fecha_registro    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clientes_nombre_no_vacio CHECK (nombre IS NULL OR length(btrim(nombre)) > 0)
);

CREATE TABLE IF NOT EXISTS public.productos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  descripcion   TEXT,
  precio        NUMERIC(12, 2) NOT NULL CHECK (precio >= 0),
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT productos_nombre_unico UNIQUE (nombre)
);

CREATE INDEX IF NOT EXISTS idx_productos_nombre_trgm
  ON public.productos USING gin (nombre gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_productos_activos
  ON public.productos (activo) WHERE activo = TRUE;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_productos_updated_at ON public.productos;
CREATE TRIGGER trg_productos_updated_at
  BEFORE UPDATE ON public.productos
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.estado_chat (
  telefono_cliente     TEXT PRIMARY KEY
                       REFERENCES public.clientes (telefono)
                       ON UPDATE CASCADE
                       ON DELETE CASCADE,
  estado               public.estado_conversacion NOT NULL DEFAULT 'bot_activo',
  ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  motivo_handoff       TEXT,
  silenciado_desde     TIMESTAMPTZ,
  openai_thread_id     TEXT
);

CREATE INDEX IF NOT EXISTS idx_estado_chat_estado ON public.estado_chat (estado);

CREATE OR REPLACE FUNCTION public.touch_estado_chat()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.ultima_actualizacion := NOW();
  IF TG_OP = 'UPDATE'
     AND NEW.estado IN ('esperando_operador', 'humano_activo')
     AND (OLD.estado IS DISTINCT FROM NEW.estado) THEN
    NEW.silenciado_desde := COALESCE(NEW.silenciado_desde, NOW());
  END IF;
  IF NEW.estado = 'bot_activo' THEN
    NEW.silenciado_desde := NULL;
    NEW.motivo_handoff := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estado_chat_touch ON public.estado_chat;
CREATE TRIGGER trg_estado_chat_touch
  BEFORE INSERT OR UPDATE ON public.estado_chat
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_estado_chat();

CREATE TABLE IF NOT EXISTS public.carritos_temporales (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono_cliente TEXT NOT NULL
                   REFERENCES public.clientes (telefono)
                   ON UPDATE CASCADE
                   ON DELETE CASCADE,
  producto_id      UUID NOT NULL
                   REFERENCES public.productos (id)
                   ON UPDATE CASCADE
                   ON DELETE RESTRICT,
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  fecha_agregado   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_carrito_cliente_producto UNIQUE (telefono_cliente, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_carritos_telefono ON public.carritos_temporales (telefono_cliente);
CREATE INDEX IF NOT EXISTS idx_carritos_fecha ON public.carritos_temporales (fecha_agregado);

CREATE TABLE IF NOT EXISTS public.ventas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono_cliente TEXT NOT NULL
                   REFERENCES public.clientes (telefono)
                   ON UPDATE CASCADE
                   ON DELETE RESTRICT,
  producto_id      UUID NOT NULL
                   REFERENCES public.productos (id)
                   ON UPDATE CASCADE
                   ON DELETE RESTRICT,
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario  NUMERIC(12, 2) NOT NULL CHECK (precio_unitario >= 0),
  canal            TEXT NOT NULL DEFAULT 'mostrador'
                   CHECK (canal IN ('mostrador', 'whatsapp')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ventas_telefono ON public.ventas (telefono_cliente, created_at DESC);

CREATE TABLE IF NOT EXISTS public.webhook_events (
  wa_message_id TEXT PRIMARY KEY,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.purgar_carritos_expirados()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  filas_eliminadas INTEGER;
BEGIN
  DELETE FROM public.carritos_temporales AS ct
  USING (
    SELECT telefono_cliente
    FROM public.carritos_temporales
    GROUP BY telefono_cliente
    HAVING MIN(fecha_agregado) < (NOW() - INTERVAL '24 hours')
  ) AS exp
  WHERE ct.telefono_cliente = exp.telefono_cliente;

  GET DIAGNOSTICS filas_eliminadas = ROW_COUNT;
  RETURN filas_eliminadas;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_purgar_carritos_expirados()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.purgar_carritos_expirados();
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_purgar_carritos_expirados ON public.carritos_temporales;
CREATE TRIGGER trg_purgar_carritos_expirados
  AFTER INSERT OR UPDATE OR DELETE ON public.carritos_temporales
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_fn_purgar_carritos_expirados();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'purgar-carritos-temporales';

    PERFORM cron.schedule(
      'purgar-carritos-temporales',
      '*/15 * * * *',
      $$SELECT public.purgar_carritos_expirados();$$
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.agregar_item_carrito(
  p_telefono   TEXT,
  p_producto   UUID,
  p_cantidad   INTEGER
)
RETURNS TABLE (
  ok BOOLEAN,
  mensaje TEXT,
  cantidad_en_carrito INTEGER,
  stock_restante INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock INTEGER;
  v_qty   INTEGER;
BEGIN
  PERFORM public.purgar_carritos_expirados();

  IF p_cantidad IS NULL OR p_cantidad < 1 THEN
    RETURN QUERY SELECT FALSE, 'Cantidad inválida.'::TEXT, NULL::INTEGER, NULL::INTEGER;
    RETURN;
  END IF;

  SELECT stock INTO v_stock
  FROM public.productos
  WHERE id = p_producto AND activo = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Producto no encontrado o inactivo.'::TEXT, NULL::INTEGER, NULL::INTEGER;
    RETURN;
  END IF;

  SELECT COALESCE(cantidad, 0) INTO v_qty
  FROM public.carritos_temporales
  WHERE telefono_cliente = p_telefono AND producto_id = p_producto;

  IF v_stock < COALESCE(v_qty, 0) + p_cantidad THEN
    RETURN QUERY SELECT FALSE,
      format('Stock insuficiente. Disponible: %s.', v_stock)::TEXT,
      v_qty, v_stock;
    RETURN;
  END IF;

  INSERT INTO public.clientes (telefono)
  VALUES (p_telefono)
  ON CONFLICT (telefono) DO NOTHING;

  INSERT INTO public.carritos_temporales (telefono_cliente, producto_id, cantidad)
  VALUES (p_telefono, p_producto, p_cantidad)
  ON CONFLICT (telefono_cliente, producto_id)
  DO UPDATE SET cantidad = public.carritos_temporales.cantidad + EXCLUDED.cantidad
  RETURNING cantidad INTO v_qty;

  RETURN QUERY SELECT TRUE, 'Añadido al carrito.'::TEXT, v_qty, v_stock;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_venta_mostrador(
  p_telefono   TEXT,
  p_producto   UUID,
  p_cantidad   INTEGER
)
RETURNS TABLE (
  ok BOOLEAN,
  mensaje TEXT,
  stock_restante INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod public.productos%ROWTYPE;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad < 1 THEN
    RETURN QUERY SELECT FALSE, 'Cantidad inválida.'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  INSERT INTO public.clientes (telefono)
  VALUES (p_telefono)
  ON CONFLICT (telefono) DO NOTHING;

  SELECT * INTO v_prod
  FROM public.productos
  WHERE id = p_producto AND activo = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Producto no encontrado o inactivo.'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  IF v_prod.stock < p_cantidad THEN
    RETURN QUERY SELECT FALSE,
      format('Stock insuficiente. Disponible: %s.', v_prod.stock)::TEXT,
      v_prod.stock;
    RETURN;
  END IF;

  UPDATE public.productos
  SET stock = stock - p_cantidad
  WHERE id = p_producto;

  INSERT INTO public.ventas (telefono_cliente, producto_id, cantidad, precio_unitario, canal)
  VALUES (p_telefono, p_producto, p_cantidad, v_prod.precio, 'mostrador');

  RETURN QUERY SELECT TRUE, 'Venta registrada.'::TEXT, v_prod.stock - p_cantidad;
END;
$$;

ALTER TABLE public.clientes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carritos_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estado_chat         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS productos_select_activos ON public.productos;
CREATE POLICY productos_select_activos
  ON public.productos FOR SELECT
  TO authenticated
  USING (activo = TRUE);

REVOKE ALL ON public.clientes, public.carritos_temporales, public.estado_chat,
  public.ventas, public.webhook_events
  FROM anon, authenticated;
GRANT SELECT ON public.productos TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.purgar_carritos_expirados() TO service_role;
GRANT EXECUTE ON FUNCTION public.agregar_item_carrito(TEXT, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_venta_mostrador(TEXT, UUID, INTEGER) TO service_role;
