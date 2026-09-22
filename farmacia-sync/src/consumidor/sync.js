'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.CRM_SYNC_URL || 'http://localhost:4000';
const TOKEN = process.env.CRM_SYNC_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

function headers() {
  return TOKEN ? { 'x-api-key': TOKEN } : {};
}

async function obtenerCatalogo() {
  const res = await fetch(`${URL}/productos`, { headers: headers() });
  if (!res.ok) {
    throw new Error(`API farmacia ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    productos: data.productos || [],
    lotes: data.lotes || [],
    metricasLotes: data.metricasLotes || null,
  };
}

function crearSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ROLE) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el .env del consumidor.');
  }
  return createClient(SUPABASE_URL, SUPABASE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function sincronizarProductosSupabase(productos, sb) {
  let upsertados = 0;
  let errores = 0;

  // Procesamos en lotes de 50 para no saturar el rate limit de Supabase
  const TAMAÑO = 50;
  for (let i = 0; i < productos.length; i += TAMAÑO) {
    const bloque = productos.slice(i, i + TAMAÑO);
    for (const p of bloque) {
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
        console.error(`  ✗ producto ${p.sku} ${p.nombre}: ${error.message}`);
      } else {
        upsertados++;
      }
    }
  }

  return { total: productos.length, upsertados, errores };
}

/** Lotes FEFO: upsert en Supabase vía lotes_tpv_upsert (p_sku, p_lote, p_fecha_vencimiento, p_stock). */
async function sincronizarLotesSupabase(lotes, sb) {
  let upsertados = 0;
  let errores = 0;
  let omitidos = 0;

  const TAMAÑO = 50;
  for (let i = 0; i < lotes.length; i += TAMAÑO) {
    const bloque = lotes.slice(i, i + TAMAÑO);
    for (const l of bloque) {
      if (!l.sku || !l.lote || !l.fecha_vencimiento) {
        omitidos++;
        continue;
      }
      const { error } = await sb.rpc('lotes_tpv_upsert', {
        p_sku: l.sku,
        p_lote: l.lote,
        p_fecha_vencimiento: l.fecha_vencimiento,
        p_stock: Number(l.stock || 0),
      });
      if (error) {
        errores++;
        console.error(`  ✗ lote ${l.sku}/${l.lote}: ${error.message}`);
      } else {
        upsertados++;
      }
    }
  }

  return { total: lotes.length, upsertados, errores, omitidos };
}

async function main() {
  console.log(`[consumidor] obteniendo catálogo de ${URL}/productos …`);
  const catalogo = await obtenerCatalogo();
  console.log(
    `[consumidor] recibidos ${catalogo.productos.length} productos y ${catalogo.lotes.length} lotes.`
  );

  const sb = crearSupabase();
  const resumen = await sincronizarProductosSupabase(catalogo.productos, sb);
  console.log(
    `[consumidor] productos: sincronizados ${resumen.upsertados}/${resumen.total} (${resumen.errores} errores).`
  );

  let resumenLotes = null;
  if (catalogo.lotes.length > 0) {
    resumenLotes = await sincronizarLotesSupabase(catalogo.lotes, sb);
    console.log(
      `[consumidor] lotes: sincronizados ${resumenLotes.upsertados}/${resumenLotes.total} ` +
        `(${resumenLotes.errores} errores, ${resumenLotes.omitidos} omitidos).`
    );
  }

  const erroresTotales = resumen.errores + (resumenLotes ? resumenLotes.errores : 0);
  if (erroresTotales > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[consumidor]', err.message);
  process.exit(1);
});
