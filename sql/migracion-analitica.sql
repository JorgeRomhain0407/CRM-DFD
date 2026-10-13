-- =====================================================================
-- #V54 · Analítica de conversación (CRM DFD)
-- Agrega los eventos de cliente_eventos en un único JSON por ventana de
-- días, para el panel (vista "Analítica"). Solo lectura; nada para anon.
--
-- Idempotente: se puede re-ejecutar (CREATE OR REPLACE / IF NOT EXISTS).
-- Seguridad (AGENTS.md): REVOKE explícito de anon/authenticated/PUBLIC,
-- GRANT solo a service_role. No usar REVOKE ALL global.
-- =====================================================================

-- 1) Índice por fecha: el panel siempre filtra por ventana temporal.
CREATE INDEX IF NOT EXISTS idx_cliente_eventos_ts
  ON public.cliente_eventos (created_at DESC);

-- 2) RPC · analitica_conversaciones(p_dias) -> JSONB ----------------
CREATE OR REPLACE FUNCTION public.analitica_conversaciones(p_dias INT DEFAULT 30)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $body$
WITH n AS (
  SELECT GREATEST(1, LEAST(365, COALESCE(p_dias, 30))) AS dias
),
ev AS (
  SELECT e.*
  FROM public.cliente_eventos e, n
  WHERE e.created_at >= NOW() - (n.dias || ' days')::interval
)
SELECT jsonb_build_object(
  'dias',                     (SELECT dias FROM n),
  'conversaciones',           (SELECT count(DISTINCT telefono_cliente) FROM ev WHERE tipo = 'mensaje_usuario'),
  'mensajes_usuario',         (SELECT count(*) FROM ev WHERE tipo = 'mensaje_usuario'),
  'mensajes_asistente',       (SELECT count(*) FROM ev WHERE tipo = 'mensaje_asistente'),
  'mensajes_operador',        (SELECT count(*) FROM ev WHERE tipo = 'mensaje_operador'),
  'turnos_bot',               (SELECT count(*) FROM ev WHERE tipo = 'bot_respuesta'),
  'fallback_turnos',          (SELECT count(*) FROM ev WHERE tipo = 'bot_respuesta' AND payload->>'intent' = 'general'),
  'escalados',                (SELECT count(*) FROM ev WHERE tipo = 'handoff'),
  'conversaciones_escaladas', (SELECT count(DISTINCT telefono_cliente) FROM ev WHERE tipo = 'handoff'),
  'compras',                  (SELECT count(*) FROM ev WHERE tipo = 'compra'),
  'carrito_acciones',         (SELECT count(*) FROM ev WHERE tipo = 'carrito_accion'),
  'productos_vistos',         (SELECT count(*) FROM ev WHERE tipo = 'producto_visto'),
  'latencia_prom', (SELECT COALESCE(round(avg((payload->>'latency_ms')::numeric)), 0)
                    FROM ev WHERE tipo = 'bot_respuesta' AND payload ? 'latency_ms'),
  'latencia_p50',  (SELECT COALESCE(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'latency_ms')::numeric)), 0)
                    FROM ev WHERE tipo = 'bot_respuesta' AND payload ? 'latency_ms'),
  'latencia_p95',  (SELECT COALESCE(round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'latency_ms')::numeric)), 0)
                    FROM ev WHERE tipo = 'bot_respuesta' AND payload ? 'latency_ms'),
  'por_intent', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'intent', COALESCE(t.intent, '(sin)'),
             'turnos', t.c,
             'escalados', t.esc
           ) ORDER BY t.c DESC)
    FROM (
      SELECT payload->>'intent' AS intent,
             count(*) AS c,
             count(*) FILTER (WHERE payload->>'handoff' = 'true') AS esc
      FROM ev WHERE tipo = 'bot_respuesta'
      GROUP BY 1
    ) t
  ), '[]'::jsonb),
  'por_causa', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('causa', t.causa, 'n', t.c) ORDER BY t.c DESC)
    FROM (
      SELECT COALESCE(payload->>'causa', 'desconocido') AS causa, count(*) AS c
      FROM ev WHERE tipo = 'handoff'
      GROUP BY 1
    ) t
  ), '[]'::jsonb),
  'tools', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('tool', tt.tool, 'n', tt.c) ORDER BY tt.c DESC)
    FROM (
      SELECT t.tool, count(*) AS c
      FROM ev, jsonb_array_elements_text(COALESCE(ev.payload->'tools', '[]'::jsonb)) AS t(tool)
      WHERE ev.tipo = 'bot_respuesta'
      GROUP BY t.tool
    ) tt
  ), '[]'::jsonb),
  'por_dia', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'dia', t.dia,
             'conversaciones', t.conv,
             'mensajes', t.msgs,
             'escalados', t.esc
           ) ORDER BY t.dia)
    FROM (
      SELECT created_at::date AS dia,
             count(DISTINCT telefono_cliente) FILTER (WHERE tipo = 'mensaje_usuario') AS conv,
             count(*) FILTER (WHERE tipo IN ('mensaje_usuario', 'mensaje_asistente')) AS msgs,
             count(*) FILTER (WHERE tipo = 'handoff') AS esc
      FROM ev
      GROUP BY 1
    ) t
  ), '[]'::jsonb)
);
$body$;

-- 3) Permisos: solo el backend (service_role) ejecuta la RPC ----------
REVOKE ALL ON FUNCTION public.analitica_conversaciones(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analitica_conversaciones(INT) TO service_role;
