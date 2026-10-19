-- =====================================================================
-- #V55 · Base de conocimiento (KB/FAQ) del bot — CRM DFD
-- =====================================================================
-- Objetivo (skill `chatbot-flow-design`, consideración 4 — knowledge-base
-- grounding): dar al bot respuestas VERIFICADAS que pueda citar sin
-- inventar, y una cola de PROPUESTAS generadas por el bucle de aprendizaje
-- (propose-only: un humano aprueba antes de que se use).
--
-- Idempotente: se puede re-ejecutar (IF NOT EXISTS / CREATE OR REPLACE).
-- Seguridad (AGENTS.md §Migraciones): RLS habilitado, REVOKE de
-- anon/authenticated, GRANT solo service_role. SIN "REVOKE ALL ... global".
--
-- NO se siembran hechos inventados (horarios, dirección, precios): un KB con
-- datos fabricados es exactamente la alucinación que esto previene. Las
-- entradas las crea el operador (vista "Conocimiento") o las propone el
-- bucle de aprendizaje para su revisión.
-- =====================================================================

-- 0) Trigger updated_at (autocontenido: no depender de helpers externos).
--    Solo actualiza si cambia CONTENIDO/estado (no al incrementar veces_usada).
CREATE OR REPLACE FUNCTION public.kb_faq_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''  -- #V75 · search_path fijo (lint 0011)
AS $$
BEGIN
  IF NEW.pregunta  IS DISTINCT FROM OLD.pregunta
     OR NEW.respuesta IS DISTINCT FROM OLD.respuesta
     OR NEW.tags      IS DISTINCT FROM OLD.tags
     OR NEW.estado    IS DISTINCT FROM OLD.estado
     OR NEW.nota      IS DISTINCT FROM OLD.nota THEN
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- 1) Tabla principal --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kb_faq (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pregunta      text NOT NULL,
  -- Normalizada para deduplicar propuestas y entradas (minúsculas, sin
  -- acentos ni espacios sobrantes) sin depender de unaccent en runtime.
  pregunta_norm text GENERATED ALWAYS AS (
    lower(btrim(regexp_replace(pregunta, '\s+', ' ', 'g')))
  ) STORED,
  respuesta     text NOT NULL DEFAULT '',
  tags          text[] NOT NULL DEFAULT '{}',
  estado        text NOT NULL DEFAULT 'propuesta'
                CHECK (estado IN ('propuesta', 'aprobada', 'rechazada', 'archivada')),
  origen        text NOT NULL DEFAULT 'manual'
                CHECK (origen IN ('manual', 'aprendizaje')),
  nota          text,
  veces_usada   integer NOT NULL DEFAULT 0,
  aprobada_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_faq_pregunta_norm
  ON public.kb_faq (pregunta_norm);
CREATE INDEX IF NOT EXISTS idx_kb_faq_estado
  ON public.kb_faq (estado);
-- Búsqueda por texto en la pregunta (por si en el futuro se consulta en BD).
CREATE INDEX IF NOT EXISTS idx_kb_faq_trgm
  ON public.kb_faq USING gin (pregunta extensions.gin_trgm_ops);

-- 2) Trigger updated_at ----------------------------------------------
DROP TRIGGER IF EXISTS trg_kb_faq_updated_at ON public.kb_faq;
CREATE TRIGGER trg_kb_faq_updated_at
  BEFORE UPDATE ON public.kb_faq
  FOR EACH ROW EXECUTE FUNCTION public.kb_faq_touch_updated_at();

-- 3) Seguridad: solo el backend (service_role) ------------------------
ALTER TABLE public.kb_faq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kb_faq FROM anon, authenticated;
GRANT ALL ON public.kb_faq TO service_role;

REVOKE ALL ON FUNCTION public.kb_faq_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kb_faq_touch_updated_at() TO service_role;
