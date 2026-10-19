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
-- NOTA: `pg_trgm` se movió a `extensions` en la migración #V75
-- (migracion-v75-pg-trgm-extensions.sql), recreando los índices que usan
-- `gin_trgm_ops` (idx_productos_nombre_trgm, idx_kb_faq_trgm) con el opclass
-- cualificado. Ya no queda ningún aviso extension_in_public.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.es_e164(text) SET search_path = '';
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.touch_carrito() SET search_path = '';
ALTER FUNCTION public.touch_estado_chat() SET search_path = '';
ALTER FUNCTION public.fidelizacion_touch_updated_at() SET search_path = '';
ALTER FUNCTION public.analitica_conversaciones(integer) SET search_path = '';
