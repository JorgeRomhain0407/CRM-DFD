-- #V59 · Auth/RBAC · tabla usuarios, atribución de ventas y RPCs con operador
-- ---------------------------------------------------------------------------
-- Prepara la base para el login del panel (cookie HttpOnly, Fase 2) y para que
-- cada venta quede atribuida al operador/gestor que la cerró.
--
-- Notas:
--  * `usuarios.rol`: 'operador' | 'gestor'.
--  * `password_hash`: hash derivado en el backend (crypto.scrypt), nunca en claro.
--  * `token_version`: permite invalidar sesiones al desactivar o cambiar password.
--  * Los RPC de venta ganan p_operador_id + p_operador_nombre (snapshot de nombre
--    para que el histórico sobreviva a borrados/renombrados). Se conservan las
--    firmas antiguas como wrapper con operador NULL (compatibilidad durante el
--    despliegue: el código viejo sigue funcionando).
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- 1) Usuarios del panel
CREATE TABLE IF NOT EXISTS public.usuarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario       text NOT NULL UNIQUE,
  nombre        text NOT NULL,
  rol           text NOT NULL DEFAULT 'operador' CHECK (rol IN ('operador', 'gestor')),
  password_hash text NOT NULL,
  activo        boolean NOT NULL DEFAULT true,
  token_version integer NOT NULL DEFAULT 0,
  creado_por    uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ultimo_login  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON public.usuarios (activo);

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usuarios FROM anon, authenticated;
GRANT ALL ON public.usuarios TO service_role;

-- 2) Atribución de ventas
ALTER TABLE public.ventas ADD COLUMN IF NOT EXISTS operador_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.ventas ADD COLUMN IF NOT EXISTS operador_nombre text;
CREATE INDEX IF NOT EXISTS idx_ventas_operador ON public.ventas (operador_id);

-- 3) registrar_venta_mostrador con operador (nueva firma de 5 args)
CREATE OR REPLACE FUNCTION public.registrar_venta_mostrador(
  p_telefono        TEXT,
  p_producto        UUID,
  p_cantidad        INTEGER,
  p_operador_id     UUID,
  p_operador_nombre TEXT
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

  INSERT INTO public.ventas
    (telefono_cliente, producto_id, cantidad, precio_unitario, canal, operador_id, operador_nombre)
  VALUES
    (p_telefono, p_producto, p_cantidad, v_prod.precio, 'mostrador', p_operador_id, p_operador_nombre);

  RETURN QUERY SELECT TRUE, 'Venta registrada.'::TEXT, v_prod.stock - p_cantidad;
END;
$$;

-- Wrapper de compatibilidad (firma antigua de 3 args, sin operador)
CREATE OR REPLACE FUNCTION public.registrar_venta_mostrador(
  p_telefono TEXT,
  p_producto UUID,
  p_cantidad INTEGER
)
RETURNS TABLE (ok BOOLEAN, mensaje TEXT, stock_restante INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.registrar_venta_mostrador(p_telefono, p_producto, p_cantidad, NULL::uuid, NULL::text);
$$;

-- 4) cerrar_carrito_venta con operador (nueva firma de 3 args)
CREATE OR REPLACE FUNCTION public.cerrar_carrito_venta(
  p_carrito         UUID,
  p_operador_id     UUID,
  p_operador_nombre TEXT
)
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

    INSERT INTO public.ventas
      (telefono_cliente, producto_id, cantidad, precio_unitario, canal, operador_id, operador_nombre)
    VALUES
      (v_telefono, v_linea.producto_id, v_linea.cantidad, v_linea.precio, 'whatsapp', p_operador_id, p_operador_nombre);

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

-- Wrapper de compatibilidad (firma antigua de 1 arg, sin operador)
CREATE OR REPLACE FUNCTION public.cerrar_carrito_venta(p_carrito UUID)
RETURNS TABLE (ok BOOLEAN, mensaje TEXT, num_lineas INTEGER, total NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.cerrar_carrito_venta(p_carrito, NULL::uuid, NULL::text);
$$;

-- 5) Permisos de los RPC (service_role únicamente)
REVOKE EXECUTE ON FUNCTION public.registrar_venta_mostrador(text, uuid, integer, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.registrar_venta_mostrador(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cerrar_carrito_venta(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cerrar_carrito_venta(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.registrar_venta_mostrador(text, uuid, integer, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_venta_mostrador(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_carrito_venta(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_carrito_venta(uuid) TO service_role;
