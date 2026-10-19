-- #V60 · D04/R5 (#V56) · Auditoría de mutaciones sensibles (append-only)
-- ---------------------------------------------------------------------------
-- Tabla de solo-inserción donde el backend (service_role) registra quién hizo
-- qué sobre qué entidad: cambios de config del bot, altas/ediciones de usuarios
-- y edición de fichas de cliente (PII). No guarda valores sensibles (contraseñas,
-- tokens) ni la PII completa: a lo sumo los NOMBRES de los campos modificados.
--
-- RLS activada y SIN políticas; se revoca a anon/authenticated. Solo service_role
-- (el backend) puede leer/escribir. Un trigger impide UPDATE/DELETE (append-only)
-- incluso desde service_role.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auditoria (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  accion         text NOT NULL,
  entidad        text NOT NULL,
  entidad_id     text,
  detalle        jsonb,
  usuario_id     uuid,
  usuario_nombre text,
  ip             text
);

CREATE INDEX IF NOT EXISTS idx_auditoria_created  ON public.auditoria (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad  ON public.auditoria (entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario  ON public.auditoria (usuario_id);

ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria FROM anon, authenticated;
GRANT ALL ON public.auditoria TO service_role;

-- Append-only: prohibir modificación y borrado.
CREATE OR REPLACE FUNCTION public.auditoria_solo_insercion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''  -- #V75 · search_path fijo (lint 0011)
AS $$
BEGIN
  RAISE EXCEPTION 'La tabla auditoria es append-only: no se permite % (revisa D04/#V56).', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_auditoria_append_only ON public.auditoria;
CREATE TRIGGER trg_auditoria_append_only
  BEFORE UPDATE OR DELETE ON public.auditoria
  FOR EACH ROW
  EXECUTE FUNCTION public.auditoria_solo_insercion();
