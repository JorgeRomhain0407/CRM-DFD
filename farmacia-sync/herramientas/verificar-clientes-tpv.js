'use strict';

/*
 * Verificación (SOLO LECTURA) de la importación de fichas del TPV.
 *
 * Corre en el PC de la farmacia, desde la carpeta de farmacia-sync:
 *   node herramientas\verificar-clientes-tpv.js
 *
 * Qué comprueba:
 *   1) La migración está aplicada y el RPC responde.
 *   2) Cuántas fichas hay en el CRM y cuántas son de origen TPV.
 *   3) Cuántas fichas del TPV se quedaron en la cola y por qué motivo.
 *   4) Cuántos clientes del TPV hay en total y cuántos son importables
 *      (cédula válida + teléfono normalizable).
 *
 * No escribe en el TPV ni en Supabase.
 */

const fs = require('fs');
require('dotenv').config({ path: fs.existsSync('.env') ? '.env' : 'farmacia.env' });

const { createClient } = require('@supabase/supabase-js');
const drivers = require('../src/drivers');
const { normalizarCedulaTpv, normalizarTelefonoTpv } = require('../src/consumidor/sync');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function contar(sb, tabla, filtro) {
  let q = sb.from(tabla).select('*', { count: 'exact', head: true });
  if (filtro) q = filtro(q);
  const { count, error } = await q;
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return count || 0;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ROLE) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el .env del consumidor.');
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('== RPC clientes_tpv_importar ==');
  const { data, error } = await sb.rpc('clientes_tpv_importar', {
    p_tpv_cliente_id: 0,
    p_cedula: null,
    p_nombre: null,
    p_telefono: null,
  });
  if (error) {
    throw new Error(
      `El RPC no responde (${error.message}). ¿Ejecutaste sql/migracion-clientes-tpv.sql?`
    );
  }
  const fila = Array.isArray(data) ? data[0] : data;
  console.log(`  ok — respuesta de prueba: ${fila && fila.out_estado}`);

  console.log('\n== Fichas en el CRM ==');
  const total = await contar(sb, 'clientes');
  const tpv = await contar(sb, 'clientes', (q) => q.eq('origen', 'tpv'));
  const manual = total - tpv;
  console.log(`  total: ${total} | origen tpv: ${tpv} | manual/whatsapp: ${manual}`);

  console.log('\n== Cola de fichas TPV pendientes ==');
  const pendientes = await contar(sb, 'clientes_tpv_cola', (q) => q.eq('estado', 'pendiente'));
  console.log(`  pendientes: ${pendientes}`);
  if (pendientes > 0) {
    // PostgREST devuelve como máximo 1.000 filas por select: no se puede
    // agrupar en memoria (con 3.400 pendientes el desglose saldría corto).
    // Se cuenta cada motivo con un COUNT exacto en la base.
    const MOTIVOS = ['sin_telefono', 'telefono_invalido', 'telefono_duplicado', 'cedula_duplicada'];
    let sumados = 0;
    for (const motivo of MOTIVOS) {
      const n = await contar(sb, 'clientes_tpv_cola', (q) =>
        q.eq('estado', 'pendiente').eq('motivo', motivo)
      );
      if (n > 0) {
        console.log(`    ${motivo}: ${n}`);
        sumados += n;
      }
    }
    if (sumados !== pendientes) {
      console.log(`    (otros/sin clasificar: ${pendientes - sumados})`);
    }
  }

  console.log('\n== Clientes en el TPV (solo lectura) ==');
  const driver = drivers.loadDriver(process.env.FARMACIA_SYNC_DB_TIPO);
  if (typeof driver.leerClientes !== 'function') {
    console.log('  (el driver configurado no soporta leerClientes; se omite)');
    return;
  }
  const config = {
    server: process.env.FARMACIA_SYNC_DB_SERVER,
    port: process.env.FARMACIA_SYNC_DB_PORT,
    user: process.env.FARMACIA_SYNC_DB_USER,
    password: process.env.FARMACIA_SYNC_DB_PASSWORD,
    database: process.env.FARMACIA_SYNC_DB_DATABASE,
    perfil: process.env.FARMACIA_SYNC_PERFIL,
  };
  const clientes = await driver.leerClientes(config, { desde: null });
  const conCedula = clientes.filter((c) => normalizarCedulaTpv(c.cedula));
  const importables = conCedula.filter((c) => normalizarTelefonoTpv(c.telefono));
  console.log(`  CLIENTE activos con cédula: ${clientes.length}`);
  console.log(`  con cédula válida: ${conCedula.length}`);
  console.log(`  importables (cédula + teléfono): ${importables.length}`);
  console.log(`  a la cola (sin teléfono reconocible): ${conCedula.length - importables.length}`);
}

main().catch((err) => {
  console.error('\n✗', err.message);
  process.exit(1);
});
