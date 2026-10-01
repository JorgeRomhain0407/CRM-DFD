'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.CRM_SYNC_URL || 'http://localhost:4000';
const TOKEN = process.env.CRM_SYNC_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function obtenerCatalogo() {
  const res = await fetch(`${URL}/productos`, {
    headers: TOKEN ? { 'x-api-key': TOKEN } : {},
  });
  if (!res.ok) {
    throw new Error(`API farmacia ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return { productos: data.productos || [], lotes: data.lotes || [] };
}

async function mapLimit(items, limite, fn) {
  const salida = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      salida[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return salida;
}

// El RPC de lotes es idempotente (upsert por sku+lote), así que podemos
// enviar varias filas en paralelo sin riesgo; 10 evita saturar Supabase.
const CONCURRENCIA = 10;

async function sincronizarSupabase(productos, lotes) {
  if (!SUPABASE_URL || !SUPABASE_ROLE) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el .env del consumidor.');
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let upsertados = 0;
  let errores = 0;

  // Primero TODOS los productos (el RPC de lotes recalcula la fecha de
  // vencimiento sobre la fila del producto: debe existir antes).
  await mapLimit(productos, CONCURRENCIA, async (p) => {
    const { error } = await sb.rpc('productos_tpv_upsert', {
      p_sku: p.sku,
      p_nombre: p.nombre,
      p_descripcion: p.descripcion || null,
      p_precio: Number(p.precio),
      p_precio_usd: Number(p.precioUsd || 0),
      p_stock: Number(p.stock),
      p_marca: p.marca || null,
    });
    if (error) {
      errores++;
      if (errores <= 10) console.error(`  ✗ ${p.sku} ${p.nombre}: ${error.message}`);
    } else {
      upsertados++;
    }
  });

  let lotesOk = 0;
  let lotesErr = 0;
  await mapLimit(lotes || [], CONCURRENCIA, async (l) => {
    const { error } = await sb.rpc('lotes_tpv_upsert', {
      p_sku: l.sku,
      p_lote: l.lote,
      p_fecha_vencimiento: l.fechaVencimiento,
      p_stock: Number(l.stock || 0),
    });
    if (error) {
      lotesErr++;
      if (lotesErr <= 10) console.error(`  ✗ lote ${l.sku}/${l.lote}: ${error.message}`);
    } else {
      lotesOk++;
    }
  });

  return {
    total: productos.length,
    upsertados,
    errores,
    totalLotes: (lotes || []).length,
    lotesOk,
    lotesErr,
  };
}

async function main() {
  console.log(`[consumidor] obteniendo catálogo de ${URL}/productos …`);
  const { productos, lotes } = await obtenerCatalogo();
  console.log(`[consumidor] recibidos ${productos.length} productos / ${lotes.length} lotes.`);

  const resumen = await sincronizarSupabase(productos, lotes);
  console.log(
    `[consumidor] sincronizados ${resumen.upsertados}/${resumen.total} productos (${resumen.errores} errores) ` +
      `y ${resumen.lotesOk}/${resumen.totalLotes} lotes (${resumen.lotesErr} errores).`
  );

  if (resumen.errores > 0 || resumen.lotesErr > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[consumidor]', err.message);
  process.exit(1);
});
