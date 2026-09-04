-- CRM DFD — Pedidos y estado del carrito
-- Ejecutar en el SQL Editor del proyecto Supabase (una sola pasada).
-- Añade cabecera de carrito por conversación y el estado del pedido.
-- Reutilizable (CREATE IF NOT EXISTS / OR REPLACE).

-- ---------------------------------------------------------------
-- 1) Tipo estado del pedido
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_carrito') THEN
    CREATE TYPE public.estado_carrito AS ENUM (
      'activo',              -- el cliente sigue añadiendo/quita artículos
      'pendiente_confirmacion', -- el bot pidió confirmar y espera
      'pedido',              -- el cliente confirmó: pedido en curso
      'completado',          -- despachado y pagado (venta cerrada)
      'cancelado'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 2) Cabecera del carrito (uno por conversación)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carritos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono_cliente TEXT NOT NULL
                   REFERENCES public.clientes (telefono)
                   ON UPDATE CASCADE
                   ON DELETE CASCADE,
  estado           public.estado_carrito NOT NULL DEFAULT 'activo',
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carritos_telefono ON public.carritos (telefono_cliente);
CREATE INDEX IF NOT EXISTS idx_carritos_estado ON public.carritos (estado, actualizado_en DESC);

CREATE OR REPLACE FUNCTION public.touch_carrito()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_carritos_touch ON public.carritos;
CREATE TRIGGER trg_carritos_touch
  BEFORE UPDATE ON public.carritos
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_carrito();

-- ---------------------------------------------------------------
-- 3) Vincular las líneas del carrito a su cabecera
-- ---------------------------------------------------------------
ALTER TABLE public.carritos_temporales
  ADD COLUMN IF NOT EXISTS carrito_id UUID
  REFERENCES public.carritos (id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_carritos_temporales_carrito
  ON public.carritos_temporales (carrito_id);

-- ---------------------------------------------------------------
-- 4) Obtener/crear el carrito activo de una conversación
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.obtener_carrito_activo(p_telefono TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM public.purgar_carritos_expirados();

  SELECT id INTO v_id
  FROM public.carritos
  WHERE telefono_cliente = p_telefono
    AND estado IN ('activo', 'pendiente_confirmacion', 'pedido')
  ORDER BY actualizado_en DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.clientes (telefono) VALUES (p_telefono) ON CONFLICT (telefono) DO NOTHING;
    INSERT INTO public.carritos (telefono_cliente) VALUES (p_telefono)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------
-- 5) Limpiar cabeceras huérfanas al purgar líneas caducadas
-- ---------------------------------------------------------------
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

  DELETE FROM public.carritos AS c
  WHERE c.estado = 'activo'
    AND NOT EXISTS (
      SELECT 1 FROM public.carritos_temporales ct WHERE ct.carrito_id = c.id
    )
    AND c.actualizado_en < (NOW() - INTERVAL '24 hours');

  RETURN filas_eliminadas;
END;
$$;

-- ---------------------------------------------------------------
-- 6) agregar_item_carrito usa la cabecera activa
-- ---------------------------------------------------------------
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
  v_stock   INTEGER;
  v_qty     INTEGER;
  v_carrito UUID;
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

  v_carrito := public.obtener_carrito_activo(p_telefono);

  INSERT INTO public.carritos_temporales (telefono_cliente, producto_id, cantidad, carrito_id)
  VALUES (p_telefono, p_producto, p_cantidad, v_carrito)
  ON CONFLICT (telefono_cliente, producto_id)
  DO UPDATE SET cantidad = public.carritos_temporales.cantidad + EXCLUDED.cantidad,
               carrito_id = EXCLUDED.carrito_id
  RETURNING cantidad INTO v_qty;

  RETURN QUERY SELECT TRUE, 'Añadido al carrito.'::TEXT, v_qty, v_stock;
END;
$$;

-- ---------------------------------------------------------------
-- 7) Cambiar estado del carrito activo de una conversación
--    (lo usa el bot: pendiente_confirmacion -> pedido)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.actualizar_estado_carrito(
  p_telefono TEXT,
  p_estado   TEXT
)
RETURNS TABLE (ok BOOLEAN, mensaje TEXT, estado public.estado_carrito)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_estado NOT IN ('pendiente_confirmacion', 'pedido', 'completado', 'cancelado') THEN
    RETURN QUERY SELECT FALSE, 'Estado inválido.'::TEXT, 'activo'::public.estado_carrito;
    RETURN;
  END IF;

  SELECT id INTO v_id
  FROM public.carritos
  WHERE carritos.telefono_cliente = p_telefono
    AND carritos.estado IN ('activo', 'pendiente_confirmacion', 'pedido')
  ORDER BY carritos.actualizado_en DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'No hay un carrito activo.'::TEXT, 'activo'::public.estado_carrito;
    RETURN;
  END IF;

  UPDATE public.carritos SET estado = p_estado::public.estado_carrito
  WHERE id = v_id;

  RETURN QUERY SELECT TRUE, 'Estado del pedido actualizado.'::TEXT, p_estado::public.estado_carrito;
END;
$$;

-- ---------------------------------------------------------------
-- 8) Cerrar el carrito como venta (despacho en mostrador)
--    Crea una línea de venta por producto (canal 'whatsapp'),
--    decrementa stock y marca el carrito 'completado'.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cerrar_carrito_venta(p_carrito UUID)
RETURNS TABLE (ok BOOLEAN, mensaje TEXT, num_lineas INTEGER, total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_telefono TEXT;
  v_estado   public.estado_carrito;
  v_linea    RECORD;
  v_ventas   INTEGER := 0;
  v_total    NUMERIC := 0;
BEGIN
  SELECT telefono_cliente, estado INTO v_telefono, v_estado
  FROM public.carritos
  WHERE id = p_carrito
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Carrito no encontrado.'::TEXT, 0, 0;
    RETURN;
  END IF;

  IF v_estado = 'completado' THEN
    RETURN QUERY SELECT FALSE, 'Este carrito ya se cerró como venta.'::TEXT, 0, 0;
    RETURN;
  END IF;

  FOR v_linea IN
    SELECT ct.producto_id, ct.cantidad, p.nombre, p.precio, p.stock
    FROM public.carritos_temporales ct
    JOIN public.productos p ON p.id = ct.producto_id
    WHERE ct.carrito_id = p_carrito
  LOOP
    IF v_linea.stock < v_linea.cantidad THEN
      RETURN QUERY SELECT FALSE,
        format('Stock insuficiente para %s. Disponible: %s.', v_linea.nombre, v_linea.stock)::TEXT,
        v_ventas, v_total;
      RETURN;
    END IF;

    UPDATE public.productos SET stock = stock - v_linea.cantidad
    WHERE id = v_linea.producto_id;

    INSERT INTO public.ventas (telefono_cliente, producto_id, cantidad, precio_unitario, canal)
    VALUES (v_telefono, v_linea.producto_id, v_linea.cantidad, v_linea.precio, 'whatsapp');

    v_ventas := v_ventas + 1;
    v_total := v_total + (v_linea.precio * v_linea.cantidad);
  END LOOP;

  IF v_ventas = 0 THEN
    RETURN QUERY SELECT FALSE, 'El carrito está vacío.'::TEXT, 0, 0;
    RETURN;
  END IF;

  DELETE FROM public.carritos_temporales WHERE carrito_id = p_carrito;
  UPDATE public.carritos SET estado = 'completado' WHERE id = p_carrito;

  RETURN QUERY SELECT TRUE, 'Venta despachada correctamente.'::TEXT, v_ventas, v_total;
END;
$$;

-- ---------------------------------------------------------------
-- 9) Seguridad: RLS y permisos
-- ---------------------------------------------------------------
ALTER TABLE public.carritos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.carritos FROM anon, authenticated;
GRANT ALL ON public.carritos TO service_role;

GRANT EXECUTE ON FUNCTION public.obtener_carrito_activo(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_estado_carrito(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_carrito_venta(UUID) TO service_role;