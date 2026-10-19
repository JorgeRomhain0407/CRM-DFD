-- =====================================================================
-- cleanup_test_data_20261009 · Limpieza histórica de datos de prueba
-- =====================================================================
-- Migración aplicada en prod (version 20261009161230). Se conserva en el repo
-- para PARIDAD repo↔prod (#V79). En su momento dejó como única "real" la fila
-- del teléfono +34687502302 y purgó el resto, con backups `*_test_bak_20261009`
-- (que más tarde se soltaron en v55_drop_backups_qa /
-- migracion-v55-drop-backups.sql).
-- =====================================================================

CREATE TABLE IF NOT EXISTS clientes_test_bak_20261009           AS SELECT * FROM clientes           WHERE telefono         <> '+34687502302';
CREATE TABLE IF NOT EXISTS mensajes_test_bak_20261009           AS SELECT * FROM mensajes           WHERE telefono_cliente <> '+34687502302';
CREATE TABLE IF NOT EXISTS estado_chat_test_bak_20261009        AS SELECT * FROM estado_chat        WHERE telefono_cliente <> '+34687502302';
CREATE TABLE IF NOT EXISTS ventas_test_bak_20261009             AS SELECT * FROM ventas             WHERE telefono_cliente <> '+34687502302';
CREATE TABLE IF NOT EXISTS carritos_test_bak_20261009           AS SELECT * FROM carritos           WHERE telefono_cliente <> '+34687502302';
CREATE TABLE IF NOT EXISTS cliente_eventos_test_bak_20261009    AS SELECT * FROM cliente_eventos    WHERE telefono_cliente <> '+34687502302';
CREATE TABLE IF NOT EXISTS puntos_movimientos_test_bak_20261009 AS SELECT * FROM puntos_movimientos WHERE telefono_cliente <> '+34687502302';
CREATE TABLE IF NOT EXISTS webhook_events_test_bak_20261009     AS SELECT * FROM webhook_events     WHERE wa_message_id = 'wamid.DIAGTEST123';

DELETE FROM mensajes            WHERE telefono_cliente <> '+34687502302';
DELETE FROM estado_chat         WHERE telefono_cliente <> '+34687502302';
DELETE FROM carritos_temporales WHERE telefono_cliente <> '+34687502302';
DELETE FROM ventas              WHERE telefono_cliente <> '+34687502302';
DELETE FROM carritos            WHERE telefono_cliente <> '+34687502302';
DELETE FROM clientes_habitos    WHERE telefono_cliente <> '+34687502302';
DELETE FROM cliente_eventos     WHERE telefono_cliente <> '+34687502302';
DELETE FROM puntos_movimientos  WHERE telefono_cliente <> '+34687502302';
DELETE FROM clientes            WHERE telefono         <> '+34687502302';
DELETE FROM webhook_events      WHERE wa_message_id = 'wamid.DIAGTEST123';
