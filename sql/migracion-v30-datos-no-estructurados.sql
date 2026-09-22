-- ============================================================================
-- CRM DFD — #V30 Datos ágiles NO estructurados (Supabase)
-- ============================================================================
-- Fuente de verdad: Docs_Obsidian/03_Progreso/Plan_V30_Datos_No_Estructurados.md
-- EJECUTAR en el SQL Editor del proyecto Supabase (una sola pasada, idempotente).
-- Aditivo: NO rompe nada existente. Rollback completo en el plan §9.
-- ============================================================================

-- 1) Perfil estructurado del cliente (sustituye gradualmente a habitos_consumo TEXT)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS perfil JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.clientes.perfil IS
  '#V30 Perfil ágil: {intereses: [], categorias: {}, alertas: []}. '
  'habitos_consumo (TEXT) queda como legado/provee habito inicial.';

CREATE INDEX IF NOT EXISTS idx_clientes_perfil_gin
  ON public.clientes USING gin (perfil);

-- 2) Contexto rodante del bot (se lee junto a estado_chat; 0 queries extra)
ALTER TABLE public.estado_chat
  ADD COLUMN IF NOT EXISTS contexto_bot JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.estado_chat.contexto_bot IS
  '#V30 Ventana rodante: {resumen, ultimos_intents: [], contadores: {}}. '
  'Evita releer N mensajes crudos por turno.';

-- 3) Eventos de cliente (append-only) — fuente única de señales para #V29/#V31/#V33/#V34/#V35
CREATE TABLE IF NOT EXISTS public.cliente_eventos (
  id               BIGSERIAL PRIMARY KEY,
  telefono_cliente TEXT NOT NULL
                   REFERENCES public.clientes (telefono)
                   ON UPDATE CASCADE
                   ON DELETE CASCADE,
  tipo             TEXT NOT NULL CHECK (tipo IN (
    'mensaje_usuario', 'mensaje_asistente', 'mensaje_operador',
    'tool_call', 'producto_visto', 'carrito_accion', 'compra', 'handoff'
  )),
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cliente_eventos_telefono
  ON public.cliente_eventos (telefono_cliente, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cliente_eventos_tipo
  ON public.cliente_eventos (tipo, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cliente_eventos_payload_gin
  ON public.cliente_eventos USING gin (payload);

-- 4) RPC de escritura ágil (1 round-trip, SECURITY DEFINER — patrón del repo:
--    agregar_item_carrito / obtener_carrito_activo)
CREATE OR REPLACE FUNCTION public.registrar_evento_cliente(
  p_telefono TEXT,
  p_tipo     TEXT,
  p_payload  JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO public.clientes (telefono) VALUES (p_telefono)
  ON CONFLICT (telefono) DO NOTHING;

  INSERT INTO public.cliente_eventos (telefono_cliente, tipo, payload)
  VALUES (p_telefono, p_tipo, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 5) RPC de snapshot para el bot (1 round-trip; objetivo p95 < 300 ms)
CREATE OR REPLACE FUNCTION public.contexto_cliente_snapshot(p_telefono TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'cliente', to_jsonb(c),
    'estado',  to_jsonb(e),
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tipo', ev.tipo, 'payload', ev.payload, 'created_at', ev.created_at)
                       ORDER BY ev.created_at DESC)
      FROM (
        SELECT tipo, payload, created_at
        FROM public.cliente_eventos
        WHERE telefono_cliente = p_telefono
        ORDER BY created_at DESC
        LIMIT 20
      ) ev
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.clientes c
  LEFT JOIN public.estado_chat e ON e.telefono_cliente = c.telefono
  WHERE c.telefono = p_telefono;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- 6) Retención: purga de eventos >180 días (patrón pg_cron existente)
CREATE OR REPLACE FUNCTION public.purgar_eventos_antiguos(p_dias INTEGER DEFAULT 180)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
WHERE created_at < NOW() - make_interval(days => p_dias);
  GET DIAGNOSTICS filas = ROW_COUNT;
  RETURN filas;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purgar-cliente-eventos';
    PERFORM cron.schedule(
      'purgar-cliente-eventos',
      '17 3 * * *',
      $cron$SELECT public.purgar_eventos_antiguos();$cron$
    );
  END IF;
END $$;

-- 7) RLS + permisos (mismo patrón que el resto del esquema)
ALTER TABLE public.cliente_eventos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cliente_eventos FROM anon, authenticated;
GRANT ALL ON public.cliente_eventos TO service_role;
-- ⚠️ Sin esto los inserts fallan: BIGSERIAL necesita permiso sobre la secuencia
GRANT USAGE, SELECT ON SEQUENCE public.cliente_eventos_id_seq TO service_role;

GRANT EXECUTE ON FUNCTION public.registrar_evento_cliente(TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.contexto_cliente_snapshot(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.purgar_eventos_antiguos(INTEGER) TO service_role;
