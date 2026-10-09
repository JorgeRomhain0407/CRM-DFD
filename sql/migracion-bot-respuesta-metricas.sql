-- =====================================================================
-- #V51 · Telemetría de respuesta del bot (CRM DFD)
-- Añade el tipo de evento `bot_respuesta` al CHECK de cliente_eventos.
-- Payload (anti-PII): { latency_ms, tools: [...], iterations, handoff }.
-- Idempotente: recrea el CHECK solo con la lista de tipos vigente.
-- Seguridad: la escritura sigue siendo vía service_role (RPC ya existente).
-- =====================================================================

DO $$
BEGIN
  -- DROP + ADD es idempotente y no rompe filas existentes (todas usan tipos
  -- ya permitidos; solo ampliamos la lista).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cliente_eventos_tipo_check'
      AND conrelid = 'public.cliente_eventos'::regclass
  ) THEN
    ALTER TABLE public.cliente_eventos
      DROP CONSTRAINT cliente_eventos_tipo_check;
  END IF;

  ALTER TABLE public.cliente_eventos
    ADD CONSTRAINT cliente_eventos_tipo_check
    CHECK (tipo IN (
      'mensaje_usuario', 'mensaje_asistente', 'mensaje_operador',
      'tool_call', 'producto_visto', 'carrito_accion',
      'compra', 'handoff', 'bot_respuesta'
    ));
END $$;
