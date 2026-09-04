-- CRM DFD — Fix ambigüedad 'estado' en actualizar_estado_carrito (42702)
-- Ejecutar en el SQL Editor del proyecto Supabase (reutilizable).

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

GRANT EXECUTE ON FUNCTION public.actualizar_estado_carrito(TEXT, TEXT) TO service_role;