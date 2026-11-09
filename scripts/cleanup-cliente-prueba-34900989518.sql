-- =====================================================================
-- D03 · Limpieza de UN cliente de prueba residual
-- Teléfono: +34900989518  ("QA Ficha")
-- Fecha:    2026-11-09
-- =====================================================================
-- Por qué: el rango que purga `sql/migracion-v78-cleanup-test-data.sql`
-- es `+349000000%` y este teléfono NO cae en él, así que quedó vivo.
--
-- Cómo ejecutarlo:
--   1) Supabase → proyecto "CRM DFD" → SQL Editor
--   2) Pegar TODO este archivo y ejecutar
--   3) Verificar con:  node scripts/check-cliente.js +34900989518
--      (debe devolver "existe": false y todos los conteos a 0)
--
-- Es idempotente: se puede ejecutar dos veces sin error.
-- Deja backup de las filas afectadas en tablas *_test_bak_20261109.
-- =====================================================================

begin;

-- ---------------------------------------------------------------
-- 0) PRE-CHECK (opcional: ver qué hay antes de borrar)
-- ---------------------------------------------------------------
select 'clientes'            as tabla, count(*) from public.clientes            where telefono         = '+34900989518'
union all
select 'mensajes',                    count(*) from public.mensajes            where telefono_cliente = '+34900989518'
union all
select 'estado_chat',                 count(*) from public.estado_chat         where telefono_cliente = '+34900989518'
union all
select 'cliente_eventos',             count(*) from public.cliente_eventos     where telefono_cliente = '+34900989518'
union all
select 'cliente_habitos',             count(*) from public.cliente_habitos     where telefono_cliente = '+34900989518'
union all
select 'carritos',                    count(*) from public.carritos            where telefono_cliente = '+34900989518'
union all
select 'carritos_temporales',         count(*) from public.carritos_temporales where telefono_cliente = '+34900989518'
union all
select 'puntos_movimientos',          count(*) from public.puntos_movimientos  where telefono_cliente = '+34900989518'
union all
select 'ventas',                      count(*) from public.ventas              where telefono_cliente = '+34900989518';

-- ---------------------------------------------------------------
-- 1) BACKUP (solo las filas afectadas)
-- ---------------------------------------------------------------
create table if not exists public.clientes_test_bak_20261109            as select * from public.clientes            where telefono         = '+34900989518';
create table if not exists public.mensajes_test_bak_20261109            as select * from public.mensajes            where telefono_cliente = '+34900989518';
create table if not exists public.estado_chat_test_bak_20261109         as select * from public.estado_chat         where telefono_cliente = '+34900989518';
create table if not exists public.cliente_eventos_test_bak_20261109     as select * from public.cliente_eventos     where telefono_cliente = '+34900989518';
create table if not exists public.cliente_habitos_test_bak_20261109     as select * from public.cliente_habitos     where telefono_cliente = '+34900989518';
create table if not exists public.carritos_test_bak_20261109            as select * from public.carritos            where telefono_cliente = '+34900989518';
create table if not exists public.carritos_temporales_test_bak_20261109 as select * from public.carritos_temporales where telefono_cliente = '+34900989518';
create table if not exists public.puntos_movimientos_test_bak_20261109  as select * from public.puntos_movimientos  where telefono_cliente = '+34900989518';
create table if not exists public.ventas_test_bak_20261109              as select * from public.ventas              where telefono_cliente = '+34900989518';

-- ---------------------------------------------------------------
-- 2) BORRADO (hijos antes que padre)
-- ---------------------------------------------------------------
delete from public.mensajes            where telefono_cliente = '+34900989518';
delete from public.estado_chat         where telefono_cliente = '+34900989518';
delete from public.cliente_eventos     where telefono_cliente = '+34900989518';
delete from public.cliente_habitos     where telefono_cliente = '+34900989518';
delete from public.carritos            where telefono_cliente = '+34900989518';
delete from public.carritos_temporales where telefono_cliente = '+34900989518';
delete from public.puntos_movimientos  where telefono_cliente = '+34900989518';
delete from public.ventas              where telefono_cliente = '+34900989518';
delete from public.clientes            where telefono         = '+34900989518';

commit;

-- ---------------------------------------------------------------
-- 3) POST-CHECK (todo debe salir en 0)
-- ---------------------------------------------------------------
select 'clientes'            as tabla, count(*) from public.clientes            where telefono         = '+34900989518'
union all
select 'mensajes',                    count(*) from public.mensajes            where telefono_cliente = '+34900989518'
union all
select 'estado_chat',                 count(*) from public.estado_chat         where telefono_cliente = '+34900989518'
union all
select 'cliente_eventos',             count(*) from public.cliente_eventos     where telefono_cliente = '+34900989518'
union all
select 'cliente_habitos',             count(*) from public.cliente_habitos     where telefono_cliente = '+34900989518'
union all
select 'carritos',                    count(*) from public.carritos            where telefono_cliente = '+34900989518'
union all
select 'carritos_temporales',         count(*) from public.carritos_temporales where telefono_cliente = '+34900989518'
union all
select 'puntos_movimientos',          count(*) from public.puntos_movimientos  where telefono_cliente = '+34900989518'
union all
select 'ventas',                      count(*) from public.ventas              where telefono_cliente = '+34900989518';

-- =====================================================================
-- ROLLBACK (si hiciera falta restaurar; ejecutar a mano)
-- =====================================================================
-- insert into public.clientes            select * from public.clientes_test_bak_20261109            on conflict do nothing;
-- insert into public.mensajes            select * from public.mensajes_test_bak_20261109            on conflict do nothing;
-- insert into public.estado_chat         select * from public.estado_chat_test_bak_20261109         on conflict do nothing;
-- insert into public.cliente_eventos     select * from public.cliente_eventos_test_bak_20261109     on conflict do nothing;
-- insert into public.cliente_habitos     select * from public.cliente_habitos_test_bak_20261109     on conflict do nothing;
-- insert into public.carritos            select * from public.carritos_test_bak_20261109            on conflict do nothing;
-- insert into public.carritos_temporales select * from public.carritos_temporales_test_bak_20261109 on conflict do nothing;
-- insert into public.puntos_movimientos  select * from public.puntos_movimientos_test_bak_20261109  on conflict do nothing;
-- insert into public.ventas              select * from public.ventas_test_bak_20261109              on conflict do nothing;
