-- CRM DFD — Persistir contexto de herramientas entre turnos
-- Ejecutar en el SQL Editor del proyecto Supabase (reutilizable).

ALTER TABLE public.estado_chat
  ADD COLUMN IF NOT EXISTS last_tool_context JSONB;

COMMENT ON COLUMN public.estado_chat.last_tool_context IS
  'Mapa nombre_normalizado -> {id, nombre} de los últimos productos consultados por el bot, para reutilizar el UUID entre turnos. Se actualiza en cada turno.';