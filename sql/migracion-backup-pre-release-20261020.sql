-- #V82 · Snapshot pre-release v1.0.0 (2026-10-20)
-- Backup lógico dentro de la BD (no hay pg_dump disponible en el entorno).
-- Schema aislado: anon/authenticated NO tienen USAGE → no accesible por la API
-- pública; solo service_role puede leerlo.
--
-- Nota de paridad (#V79): este archivo refleja la migración ya aplicada
-- `backup_pre_release_20261020` en el proyecto Supabase.

create schema if not exists backup_release_20261020;

revoke all on schema backup_release_20261020 from public;
revoke all on schema backup_release_20261020 from anon;
revoke all on schema backup_release_20261020 from authenticated;
grant usage on schema backup_release_20261020 to service_role;

create table if not exists backup_release_20261020.clientes            as select * from public.clientes;
create table if not exists backup_release_20261020.cliente_habitos     as select * from public.cliente_habitos;
create table if not exists backup_release_20261020.carritos            as select * from public.carritos;
create table if not exists backup_release_20261020.carritos_temporales as select * from public.carritos_temporales;
create table if not exists backup_release_20261020.ventas              as select * from public.ventas;
create table if not exists backup_release_20261020.mensajes            as select * from public.mensajes;
create table if not exists backup_release_20261020.cliente_eventos     as select * from public.cliente_eventos;
create table if not exists backup_release_20261020.estado_chat         as select * from public.estado_chat;
create table if not exists backup_release_20261020.usuarios            as select * from public.usuarios;
create table if not exists backup_release_20261020.bot_config          as select * from public.bot_config;
create table if not exists backup_release_20261020.fidelizacion_config as select * from public.fidelizacion_config;
create table if not exists backup_release_20261020.fidelizacion_recompensas as select * from public.fidelizacion_recompensas;
create table if not exists backup_release_20261020.fidelizacion_categorias  as select * from public.fidelizacion_categorias;
create table if not exists backup_release_20261020.puntos_movimientos  as select * from public.puntos_movimientos;
create table if not exists backup_release_20261020.kb_faq              as select * from public.kb_faq;
create table if not exists backup_release_20261020.auditoria           as select * from public.auditoria;
create table if not exists backup_release_20261020.webhook_events      as select * from public.webhook_events;
create table if not exists backup_release_20261020.productos           as select * from public.productos;
create table if not exists backup_release_20261020.lotes               as select * from public.lotes;
