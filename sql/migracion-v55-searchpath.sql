-- #V55 · Seguridad BD · Fijar search_path en funciones auxiliares
-- ---------------------------------------------------------------------------
-- WARN del Advisor (function_search_path_mutable). Ninguna es SECURITY DEFINER,
-- así que el riesgo era bajo, pero se fija igual:
--   * es_e164: regex pura (IMMUTABLE).
--   * set_updated_at / touch_carrito / touch_estado_chat / fidelizacion_touch_updated_at:
--     triggers que solo tocan NEW (no resuelven nombres de tabla).
--   * analitica_conversaciones: SQL con referencias YA calificadas (public.*);
--     pg_catalog sigue resolviéndose siempre, así que search_path vacío es seguro.
-- Idempotente.
--
-- NOTA (defer): `pg_trgm` sigue en `public` (WARN extension_in_public). Moverlo a
-- otro schema obliga a recrear el índice `idx_productos_nombre_trgm`
-- (gin_trgm_ops): cambio aparte, más delicado, no incluido aquí.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.es_e164(text) SET search_path = '';
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.touch_carrito() SET search_path = '';
ALTER FUNCTION public.touch_estado_chat() SET search_path = '';
ALTER FUNCTION public.fidelizacion_touch_updated_at() SET search_path = '';
ALTER FUNCTION public.analitica_conversaciones(integer) SET search_path = '';
