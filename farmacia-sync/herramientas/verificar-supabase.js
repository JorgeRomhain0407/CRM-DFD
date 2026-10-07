'use strict';

/*
 * Diagnóstico de Supabase del lado consumidor (SOLO LECTURA).
 * Confirma que la migración FEFO canónica está aplicada y que los dos RPC
 * que llama src/consumidor/sync.js existen con la firma esperada.
 * No escribe nada: las llamadas a los RPC van con sku nulo para que caigan
 * en la rama de "omitido" y no inserten filas.
 *
 * Uso (desde cualquier sitio):
 *   node farmacia-sync/herramientas/verificar-supabase.js
 */

const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') }); // fallback: raíz del repo

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ok = (c) => (c ? '  OK  ' : ' FALLA');
const resultados = [];

function check(nombre, cond, detalle) {
  resultados.push({ nombre, ok: !!cond, detalle: detalle || '' });
}

async function main() {
  if (!URL || !KEY) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // --- esquema -------------------------------------------------------
  const { data: cols, error: eCols } = await sb
    .from('productos')
    .select('sku, marca, fecha_vencimiento, precio_usd')
    .limit(1);
  check('columnas productos (sku, marca, fecha_vencimiento, precio_usd)', !eCols, eCols ? eCols.message : '');

  // --- conteos -------------------------------------------------------
  async function contar(col) {
    let q = sb.from('productos').select('*', { count: 'exact', head: true });
    if (col) q = q.not(col, 'is', null);
    const r = await q;
    if (r.error) throw new Error(`conteo productos: ${r.error.message}`);
    return r.count;
  }
  const total = await contar();
  const conSku = await contar('sku');
  const conMarca = await contar('marca');
  const conFecha = await contar('fecha_vencimiento');

  const rLotes = await sb.from('lotes').select('*', { count: 'exact', head: true });
  if (rLotes.error) throw new Error(`tabla lotes: ${rLotes.error.message}`);
  const totalLotes = rLotes.count;

  const rLotesVivos = await sb
    .from('lotes')
    .select('*', { count: 'exact', head: true })
    .eq('activo', true)
    .gt('stock', 0);
  const lotesVivos = rLotesVivos.count;

  check('tabla lotes existe', totalLotes >= 0, `${totalLotes} filas`);

  // --- RPC (firma que usa el consumidor) -----------------------------
  const { data: d1, error: e1 } = await sb.rpc('productos_tpv_upsert', {
    p_sku: null, p_nombre: null, p_descripcion: null,
    p_precio: 0, p_precio_usd: 0, p_stock: 0, p_marca: null,
  });
  check('rpc productos_tpv_upsert (7 args con p_marca)', !e1, e1 ? e1.message : JSON.stringify(d1));

  const { data: d2, error: e2 } = await sb.rpc('lotes_tpv_upsert', {
    p_sku: null, p_lote: null, p_fecha_vencimiento: null, p_stock: 0,
  });
  check('rpc lotes_tpv_upsert (4 args)', !e2, e2 ? e2.message : JSON.stringify(d2));

  // --- el backend sigue funcionando (regresión del REVOKE global) ---
  const { error: e3 } = await sb.rpc('contexto_cliente_snapshot', { p_telefono: null });
  check('rpc contexto_cliente_snapshot (bot #V30)', !e3, e3 ? e3.message : '');

  // --- informe -------------------------------------------------------
  console.log('\n=== Supabase / farmacia-sync ===');
  for (const r of resultados) console.log(`${ok(r.ok)} ${r.nombre}${r.detalle ? '  → ' + r.detalle : ''}`);
  console.log('\n--- catálogo actual ---');
  console.log(`  productos: ${total}  (con sku ${conSku}, con marca ${conMarca}, con fecha ${conFecha})`);
  console.log(`  lotes:     ${totalLotes}  (activos con stock>0: ${lotesVivos})`);
  const pendientes = resultados.filter((r) => !r.ok).length;
  console.log(pendientes ? `\n${pendientes} comprobación(es) FALLAN.` : '\nTodo listo para el consumidor.');
  process.exit(pendientes ? 1 : 0);
}

main().catch((err) => {
  console.error('x', err.message);
  process.exit(1);
});
