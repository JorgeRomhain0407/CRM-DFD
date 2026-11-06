'use strict';

/*
 * Verificación (SOLO LECTURA) de la importación de ventas del TPV → hábitos.
 *
 * Corre en el PC de la farmacia, desde la carpeta de farmacia-sync:
 *   node herramientas\verificar-ventas-tpv.js
 *
 * Qué comprueba:
 *   1) La migración está aplicada y el RPC responde (con una factura 0, que
 *      no escribe nada).
 *   2) Cuántas facturas hay en el espejo `ventas_tpv` y en qué estado.
 *   3) Qué facturas quedaron en `sin_ficha` (reintentables cuando la ficha
 *      exista) y cuáles en `sin_cedula` (no se pueden asociar).
 *   4) Muestreo de cobertura: facturas del TPV alrededor de la marca de agua
 *      que todavía no estén en el espejo.
 *
 * No escribe en el TPV ni en Supabase.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: fs.existsSync('.env') ? '.env' : 'farmacia.env' });

const { createClient } = require('@supabase/supabase-js');
const drivers = require('../src/drivers');
const { normalizarCedulaTpv } = require('../src/consumidor/sync');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ESTADO_PATH = path.join(__dirname, '..', '.farmacia-sync-state.json');

async function contar(sb, filtro) {
  let q = sb.from('ventas_tpv').select('*', { count: 'exact', head: true });
  if (filtro) q = filtro(q);
  const { count, error } = await q;
  if (error) throw new Error(`ventas_tpv: ${error.message}`);
  return count || 0;
}

function leerMarcaDeAgua() {
  try {
    const estado = JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8')) || {};
    return Number(estado.ultimaFacturaTpv) || 0;
  } catch (_) {
    return 0;
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ROLE) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el .env del consumidor.');
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('== RPC ventas_tpv_importar ==');
  const { data, error } = await sb.rpc('ventas_tpv_importar', {
    p_tpv_factura_id: 0,
    p_tpv_cliente_id: null,
    p_cedula: null,
    p_telefono: null,
    p_fecha: null,
    p_lineas: [],
  });
  if (error) {
    throw new Error(
      `El RPC no responde (${error.message}). ¿Ejecutaste sql/migracion-ventas-tpv.sql?`
    );
  }
  const fila = Array.isArray(data) ? data[0] : data;
  console.log(`  ok — respuesta de prueba: ${fila && fila.out_estado}`);

  console.log('\n== Facturas del TPV en el espejo ==');
  const total = await contar(sb);
  const importadas = await contar(sb, (q) => q.eq('estado', 'importada'));
  const sinFicha = await contar(sb, (q) => q.eq('estado', 'sin_ficha'));
  const sinCedula = await contar(sb, (q) => q.eq('estado', 'sin_cedula'));
  console.log(
    `  total: ${total} | importadas: ${importadas} | sin ficha: ${sinFicha} | sin cédula: ${sinCedula}`
  );

  const { data: ultima, error: errUltima } = await sb
    .from('ventas_tpv')
    .select('tpv_factura_id, fecha, telefono_cliente, habitos_agregados')
    .order('tpv_factura_id', { ascending: false })
    .limit(1);
  if (errUltima) throw new Error(errUltima.message);
  if (ultima && ultima.length) {
    const u = ultima[0];
    console.log(
      `  última factura: ${u.tpv_factura_id} · ${u.fecha || 'sin fecha'} · ` +
        `${u.telefono_cliente || 'sin teléfono'} · hábitos ${u.habitos_agregados}`
    );
  }

  console.log('\n== Facturas sin ficha (se reintentan solas) ==');
  console.log(`  pendientes: ${sinFicha}`);
  if (sinFicha > 0) {
    const { data: muestra, error: errMuestra } = await sb
      .from('ventas_tpv')
      .select('tpv_factura_id, cedula, fecha')
      .eq('estado', 'sin_ficha')
      .order('fecha', { ascending: false })
      .limit(10);
    if (errMuestra) throw new Error(errMuestra.message);
    for (const f of muestra || []) {
      console.log(`    factura ${f.tpv_factura_id} · ${f.cedula || 'sin cédula'} · ${f.fecha || 'sin fecha'}`);
    }
    if (sinFicha > 10) console.log(`    … y ${sinFicha - 10} más`);
  }

  console.log('\n== Facturas sin cédula (no asociables) ==');
  console.log(`  descartadas: ${sinCedula}`);
  if (sinCedula > 0) {
    console.log('  (el TPV no trae cédula en la factura ni en la ficha del cliente)');
  }

  console.log('\n== Muestreo de cobertura en el TPV (solo lectura) ==');
  const driver = drivers.loadDriver(process.env.FARMACIA_SYNC_DB_TIPO);
  if (typeof driver.leerVentas !== 'function') {
    console.log('  (el driver configurado no soporta leerVentas; se omite)');
    return;
  }

  const marca = leerMarcaDeAgua();
  const desde = Math.max(0, marca - 500);
  const config = {
    server: process.env.FARMACIA_SYNC_DB_SERVER,
    port: process.env.FARMACIA_SYNC_DB_PORT,
    user: process.env.FARMACIA_SYNC_DB_USER,
    password: process.env.FARMACIA_SYNC_DB_PASSWORD,
    database: process.env.FARMACIA_SYNC_DB_DATABASE,
    perfil: process.env.FARMACIA_SYNC_PERFIL,
  };
  const ventas = await driver.leerVentas(config, { desde, limite: 500 });
  const conCedula = ventas.filter((v) => normalizarCedulaTpv(v.cedula));
  const ids = conCedula.map((v) => v.tpvFacturaId);

  let faltantes = 0;
  if (ids.length) {
    const { data: espejo, error: errEspejo } = await sb
      .from('ventas_tpv')
      .select('tpv_factura_id')
      .in('tpv_factura_id', ids);
    if (errEspejo) throw new Error(`ventas_tpv: ${errEspejo.message}`);
    const presentes = new Set((espejo || []).map((v) => Number(v.tpv_factura_id)));
    faltantes = ids.filter((id) => !presentes.has(id)).length;
  }

  console.log(`  marca de agua: ${marca || '(sin pasada completa todavía)'}`);
  console.log(
    `  TPV ${desde}→: ${ventas.length} facturas con cliente · ${conCedula.length} con cédula válida`
  );
  console.log(`  en el espejo: ${conCedula.length - faltantes} · faltantes: ${faltantes}`);
  if (faltantes > 0) {
    console.log('  ⚠️  corre `npm run ventas -- --ventas-completo` para rellenarlas');
  }
}

main().catch((err) => {
  console.error('\n✗', err.message);
  process.exit(1);
});
