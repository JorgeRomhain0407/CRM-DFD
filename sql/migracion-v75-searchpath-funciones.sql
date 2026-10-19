-- =====================================================================
-- #V75 · Endurecimiento D04 — search_path fijo en funciones restantes
-- =====================================================================
-- Cierra el aviso `function_search_path_mutable` (lint 0011) de las 3 últimas
-- funciones sin `search_path` fijo. Sus cuerpos referencian objetos ya
-- cualificados (public.*) o solo pg_catalog, por lo que un search_path vacío
-- es seguro.
--   * auditoria_solo_insercion(): trigger append-only, solo RAISE.
--   * kb_faq_marcar_uso(uuid[]): UPDATE public.kb_faq (cualificado).
--   * kb_faq_touch_updated_at(): trigger, solo NEW.* y NOW() (pg_catalog).
-- Idempotente.
-- =====================================================================

ALTER FUNCTION public.auditoria_solo_insercion() SET search_path = '';
ALTER FUNCTION public.kb_faq_marcar_uso(uuid[]) SET search_path = '';
ALTER FUNCTION public.kb_faq_touch_updated_at() SET search_path = '';
