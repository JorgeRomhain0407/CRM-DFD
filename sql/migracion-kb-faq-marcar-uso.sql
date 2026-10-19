-- =====================================================================
-- #V55 · KB/FAQ — contador de uso atómico
-- =====================================================================
-- Incremento atómico de `veces_usada` para marcar las entradas de la KB que
-- se han inyectado al modelo (grounding de conocimiento verificado).
--
-- Idempotente. Seguridad (AGENTS.md §Migraciones): REVOKE de anon/authenticated
-- y GRANT solo a service_role (el backend). `search_path` fijo (#V75, lint 0011).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.kb_faq_marcar_uso(p_ids uuid[])
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  UPDATE public.kb_faq
  SET veces_usada = veces_usada + 1
  WHERE id = ANY(p_ids);
$$;

REVOKE ALL ON FUNCTION public.kb_faq_marcar_uso(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kb_faq_marcar_uso(uuid[]) TO service_role;
