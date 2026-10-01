-- Fix: RLS deshabilitada en tabla public.lotes (hallazgo del Supabase Advisor, CRITICAL).
--
-- Contexto:
--   La migración FEFO canónica (farmacia-sync/sql/migracion-fefo-lotes.sql) crea la
--   tabla `lotes` CON RLS + solo service_role, pero termina con un
--   `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated`
--   global. Aplicarla tal cual revoca los permisos de las RPCs de #V30
--   (registrar_evento_cliente / contexto_cliente_snapshot) y rompe el bot.
--   Por eso NO se re-aplica la FEFO canérica: el bot usa service_role (no le
--   afectan los revokes) pero el frontend/panel nunca llama RPCs directos, así
--   que el problema real es ÚNICAMENTE que `lotes` quedó sin RLS.
--
-- Qué hace (mínimo y quirúrgico):
--   1) Activa RLS en public.lotes (defensa en profundidad: aunque el backend ya
--      usa service_role, sin RLS la tabla queda expuesta si alguien reutiliza la
--      anon key por error).
--   2) Restringe lotes a service_role (la app es la única consumidora).
--   3) NO toca RPCs ni otras tablas -> no puede romper #V28/#V30.
--
-- Ejecutar en el SQL Editor de Supabase (idempotente, una pasada).
-- Verificación: el Advisor debe dejar de reportar "RLS Disabled in Public" en lotes.

-- 1) Activar RLS en lotes
ALTER TABLE public.lotes ENABLE ROW LEVEL SECURITY;

-- 2) Acceso exclusivo de service_role (patrón de schema.sql / cliente_eventos)
REVOKE ALL ON public.lotes FROM anon, authenticated;
GRANT ALL ON public.lotes TO service_role;

-- Si la tabla lotes tiene RLS activo pero sin ninguna policy, service_role la
-- sigue viendo (bypasea RLS), pero por higiene dejamos constancia de que el
-- acceso es service_role-only y no hay policies para anon/authenticated.
-- (No creamos policies: el único consumidor es el backend con service_role.)
