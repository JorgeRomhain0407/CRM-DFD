-- #V55 · Seguridad BD · Revocar EXECUTE a anon/authenticated en funciones del backend
-- ---------------------------------------------------------------------------
-- El Advisor de Supabase marca funciones ejecutables por anon/authenticated.
-- Las SECURITY DEFINER se saltan RLS: si anon llama al RPC vía PostgREST puede
-- escribir stock/ventas o leer datos de clientes. El único consumidor real es el
-- backend (service_role).
--
-- Patrón (AGENTS.md): REVOKE específico POR FIRMA + GRANT a service_role.
-- NUNCA "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public" (rompería las RPCs
-- de #V30: registrar_evento_cliente / contexto_cliente_snapshot).
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER que se saltan RLS
REVOKE EXECUTE ON FUNCTION public.actualizar_estado_carrito(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agregar_item_carrito(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cerrar_carrito_venta(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.contexto_cliente_snapshot(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lotes_tpv_upsert(text, text, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.obtener_carrito_activo(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.productos_tpv_upsert(text, text, text, numeric, numeric, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purgar_carritos_expirados() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purgar_eventos_antiguos(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.registrar_evento_cliente(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.registrar_venta_mostrador(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_purgar_carritos_expirados() FROM PUBLIC, anon, authenticated;

-- Helpers / funciones de trigger internas (no las llama el cliente)
REVOKE EXECUTE ON FUNCTION public.es_e164(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_carrito() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_estado_chat() FROM PUBLIC, anon, authenticated;

-- El backend (service_role) debe conservar acceso explícito
GRANT EXECUTE ON FUNCTION public.actualizar_estado_carrito(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agregar_item_carrito(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_carrito_venta(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.contexto_cliente_snapshot(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lotes_tpv_upsert(text, text, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.obtener_carrito_activo(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.productos_tpv_upsert(text, text, text, numeric, numeric, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.purgar_carritos_expirados() TO service_role;
GRANT EXECUTE ON FUNCTION public.purgar_eventos_antiguos(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_evento_cliente(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_venta_mostrador(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_fn_purgar_carritos_expirados() TO service_role;
GRANT EXECUTE ON FUNCTION public.es_e164(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_carrito() TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_estado_chat() TO service_role;
