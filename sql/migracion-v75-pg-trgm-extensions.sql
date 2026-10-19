-- =====================================================================
-- #V75 · pg_trgm fuera de `public` (lint 0014 · extension_in_public)
-- =====================================================================
-- Mueve la extensión pg_trgm a `extensions`. Como su opclass `gin_trgm_ops`
-- está usado por dos índices, hay que soltarlos, mover la extensión y
-- recrearlos con el opclass CUALIFICADO (extensions.gin_trgm_ops).
--
-- Seguro: ninguna función propia usa operadores/funciones de pg_trgm
-- (la búsqueda usa ILIKE, que es pg_catalog). Idempotente.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS extensions;

DROP INDEX IF EXISTS public.idx_productos_nombre_trgm;
DROP INDEX IF EXISTS public.idx_kb_faq_trgm;

ALTER EXTENSION pg_trgm SET SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_productos_nombre_trgm
  ON public.productos USING gin (nombre extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kb_faq_trgm
  ON public.kb_faq USING gin (pregunta extensions.gin_trgm_ops);
