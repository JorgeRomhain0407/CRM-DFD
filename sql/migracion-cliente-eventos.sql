-- =====================================================================
-- #V30 / #V47 · Capa de eventos del cliente (CRM DFD)
-- Ya DESPLEGADA en producción (Supabase, verificado 2026-10-01 por D06:
-- tabla cliente_eventos con filas, columnas clientes.perfil y
-- estado_chat.contexto_bot y RPCs operativas).
-- Este archivo VERSIONA esa estructura en el repo. Es idempotente:
-- cada objeto se crea SOLO si falta (DO $$ guards en pg_*), para poder
-- re-ejecutarse en un entorno nuevo sin pisar nada de producción.
--
-- IMPORTANTE (AGENTS.md): no terminar con REVOKE ALL global (el patrón
-- de farmacia-sync/sql/migracion-fefo-lotes.sql rompió estas RPCs).
-- Seguridad: solo el backend (service_role) consume; nada para anon.
-- =====================================================================

-- 1) Tabla append-only de eventos ------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_eventos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono_cliente TEXT NOT NULL
                   REFERENCES public.clientes (telefono)
                   ON UPDATE CASCADE
                   ON DELETE CASCADE,
  tipo             TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cliente_eventos_tipo_check'
      AND conrelid = 'public.cliente_eventos'::regclass
  ) THEN
    ALTER TABLE public.cliente_eventos
      ADD CONSTRAINT cliente_eventos_tipo_check
      CHECK (tipo IN (
        'mensaje_usuario', 'mensaje_asistente', 'mensaje_operador',
        'tool_call', 'producto_visto', 'carrito_accion',
        'compra', 'handoff'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cliente_eventos_tel_ts
  ON public.cliente_eventos (telefono_cliente, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cliente_eventos_tipo
  ON public.cliente_eventos (tipo);

-- 2) Perfil ágil del cliente + ventana rodante del bot ----------------
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS perfil JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.estado_chat
  ADD COLUMN IF NOT EXISTS contexto_bot JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3) RPC · registrar_evento_cliente ----------------------------------
-- Creada solo si falta (en producción ya existe: no se reemplaza).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'registrar_evento_cliente'
      AND n.nspname = 'public'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.registrar_evento_cliente(
        p_telefono TEXT,
        p_tipo     TEXT,
        p_payload  JSONB DEFAULT '{}'::jsonb
      )
      RETURNS UUID
      LANGUAGE plpgsql
      AS $body$
      DECLARE
        v_id UUID;
      BEGIN
        INSERT INTO public.cliente_eventos (telefono_cliente, tipo, payload)
        VALUES (p_telefono, p_tipo, COALESCE(p_payload, '{}'::jsonb))
        RETURNING id INTO v_id;
        RETURN v_id;
      END;
      $body$;
    $fn$;
  END IF;
END $$;

-- 4) RPC · contexto_cliente_snapshot ---------------------------------
-- Creada solo si falta. Devuelve { estado, cliente, eventos[] }
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'contexto_cliente_snapshot'
      AND n.nspname = 'public'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.contexto_cliente_snapshot(p_telefono TEXT)
      RETURNS JSONB
      LANGUAGE sql
      STABLE
      AS $body$
        SELECT jsonb_build_object(
          'estado',  to_jsonb(estado_chat.*),
          'cliente', to_jsonb(clientes.*),
          'eventos', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                       'tipo', e.tipo,
                       'payload', e.payload,
                       'created_at', e.created_at
                     ) ORDER BY e.created_at DESC)
             FROM (
               SELECT tipo, payload, created_at
               FROM public.cliente_eventos
               WHERE telefono_cliente = p_telefono
               ORDER BY created_at DESC
               LIMIT 30
             ) e),
            '[]'::jsonb)
        )
        FROM public.estado_chat
        FULL JOIN public.clientes ON clientes.telefono = estado_chat.telefono_cliente
        WHERE estado_chat.telefono_cliente = p_telefono
           OR clientes.telefono = p_telefono;
      $body$;
    $fn$;
  END IF;
END $$;

-- 5) Permisos: SOLO el backend (service_role) ejecuta las RPCs --------
-- (No revocar globalmente: patrón recomendado, allowlist explícita.)
REVOKE ALL ON FUNCTION public.registrar_evento_cliente(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contexto_cliente_snapshot(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_evento_cliente(TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.contexto_cliente_snapshot(TEXT) TO service_role;
