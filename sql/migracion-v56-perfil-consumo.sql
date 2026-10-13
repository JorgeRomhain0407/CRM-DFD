-- =====================================================================
-- #V56 · Perfil de consumo (clientes.perfil) — CRM DFD
-- =====================================================================
-- EJECUTAR EN EL SQL EDITOR DE SUPABASE (o por apply_migration). Idempotente.
--
-- QUÉ HACE
--   · Añade una única RPC `clientes_perfil_merge(p_telefono, p_patch)` que
--     fusiona (jsonb `||`) un parche en `clientes.perfil` de forma ATÓMICA.
--     Motivo: el perfil JSONB ya lo escriben otros flujos (fidelización pone
--     `puntos`; el backfill #V30 pone `habitos`/`edad`). Un read-modify-write
--     desde Node podría pisar esos campos si dos flujos corren a la vez; el
--     `||` en la BD los preserva siempre.
--   · El constructor de perfil (`construirPerfilConsumo`, en customers.js)
--     deriva `intereses` (top productos comprados) y `categorias`
--     (conteo por categoría curada de `productos.categoria_id`) del historial
--     de `ventas` y los envía como parche. NO toca `puntos`/`habitos`/`edad`.
--   · Anti-PII: solo se guardan nombres de catálogo (producto/categoría), no
--     texto de mensajes.
--
-- SEGURIDAD (patrón del proyecto): SECURITY DEFINER + search_path fijo;
-- REVOKE anon/authenticated/PUBLIC; GRANT solo a service_role.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.clientes_perfil_merge(
  p_telefono TEXT,
  p_patch    JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil JSONB;
BEGIN
  IF p_telefono IS NULL OR p_telefono = '' OR p_patch IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.clientes
  SET perfil = COALESCE(perfil, '{}'::jsonb) || p_patch
  WHERE telefono = p_telefono
  RETURNING perfil INTO v_perfil;

  -- Si el teléfono no existe, no se crea ficha aquí (evita basura): NULL.
  RETURN v_perfil;
END;
$$;

REVOKE ALL ON FUNCTION public.clientes_perfil_merge(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clientes_perfil_merge(TEXT, JSONB) TO service_role;

-- =====================================================================
-- FIN. Verificar: SELECT public.clientes_perfil_merge('<telefono>', '{}'::jsonb);
-- =====================================================================
