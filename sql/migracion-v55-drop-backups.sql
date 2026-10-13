-- #V55 · Seguridad BD · Retirada de tablas de respaldo de QA expuestas
-- ---------------------------------------------------------------------------
-- 8 tablas *_test_bak_20261009 quedaron con RLS DESACTIVADO y con acceso
-- anon/authenticated (ERROR del Advisor de Supabase: cualquiera con la anon key
-- podía leer y escribir PII). Son copias de respaldo de una sesión de QA; los
-- datos reales viven en las tablas homónimas. Se eliminan.
--
-- Idempotente: DROP IF EXISTS (no CASCADE, para no ocultar dependencias).
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.clientes_test_bak_20261009;
DROP TABLE IF EXISTS public.mensajes_test_bak_20261009;
DROP TABLE IF EXISTS public.estado_chat_test_bak_20261009;
DROP TABLE IF EXISTS public.ventas_test_bak_20261009;
DROP TABLE IF EXISTS public.carritos_test_bak_20261009;
DROP TABLE IF EXISTS public.cliente_eventos_test_bak_20261009;
DROP TABLE IF EXISTS public.puntos_movimientos_test_bak_20261009;
DROP TABLE IF EXISTS public.webhook_events_test_bak_20261009;
