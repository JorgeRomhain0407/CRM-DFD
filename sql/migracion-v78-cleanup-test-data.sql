-- =====================================================================
-- #V78 · Limpieza de datos de prueba (rango reservado +349000000xx)
-- =====================================================================
-- Antes de la release 1.0.0 se purgan los datos de prueba/benchmark (teléfonos
-- del rango reservado español +349000000xx) de todas las tablas operativas.
-- Se hace BACKUP de las filas afectadas en tablas `*_test_bak_<fecha>` por si
-- hubiera que restaurar. Borrado hijos-antes-que-padre.
--
-- Idempotente (IF NOT EXISTS en los backups; DELETE es seguro si ya no hay filas).
-- =====================================================================

-- Backup (solo filas afectadas)
CREATE TABLE IF NOT EXISTS public.clientes_test_bak_20261019           AS SELECT * FROM public.clientes           WHERE telefono         LIKE '+349000000%';
CREATE TABLE IF NOT EXISTS public.cliente_habitos_test_bak_20261019    AS SELECT * FROM public.cliente_habitos    WHERE telefono_cliente LIKE '+349000000%';
CREATE TABLE IF NOT EXISTS public.carritos_test_bak_20261019           AS SELECT * FROM public.carritos           WHERE telefono_cliente LIKE '+349000000%';
CREATE TABLE IF NOT EXISTS public.carritos_temporales_test_bak_20261019 AS SELECT * FROM public.carritos_temporales WHERE telefono_cliente LIKE '+349000000%';
CREATE TABLE IF NOT EXISTS public.puntos_movimientos_test_bak_20261019 AS SELECT * FROM public.puntos_movimientos WHERE telefono_cliente LIKE '+349000000%';
CREATE TABLE IF NOT EXISTS public.ventas_test_bak_20261019             AS SELECT * FROM public.ventas             WHERE telefono_cliente LIKE '+349000000%';
CREATE TABLE IF NOT EXISTS public.estado_chat_test_bak_20261019        AS SELECT * FROM public.estado_chat        WHERE telefono_cliente LIKE '+349000000%';
CREATE TABLE IF NOT EXISTS public.mensajes_test_bak_20261019           AS SELECT * FROM public.mensajes           WHERE telefono_cliente LIKE '+349000000%';
CREATE TABLE IF NOT EXISTS public.cliente_eventos_test_bak_20261019    AS SELECT * FROM public.cliente_eventos    WHERE telefono_cliente LIKE '+349000000%';

-- Borrado
DELETE FROM public.mensajes            WHERE telefono_cliente LIKE '+349000000%';
DELETE FROM public.estado_chat         WHERE telefono_cliente LIKE '+349000000%';
DELETE FROM public.cliente_eventos     WHERE telefono_cliente LIKE '+349000000%';
DELETE FROM public.cliente_habitos     WHERE telefono_cliente LIKE '+349000000%';
DELETE FROM public.carritos            WHERE telefono_cliente LIKE '+349000000%';
DELETE FROM public.carritos_temporales WHERE telefono_cliente LIKE '+349000000%';
DELETE FROM public.puntos_movimientos  WHERE telefono_cliente LIKE '+349000000%';
DELETE FROM public.ventas              WHERE telefono_cliente LIKE '+349000000%';
DELETE FROM public.clientes            WHERE telefono         LIKE '+349000000%';
