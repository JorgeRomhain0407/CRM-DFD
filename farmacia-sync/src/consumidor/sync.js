'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.CRM_SYNC_URL || 'http://localhost:4000';
const TOKEN = process.env.CRM_SYNC_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function obtenerProductos() {
  const res = await fetch(`${URL}/productos`, {
    headers: TOKEN ? { 'x-api-key': TOKEN } : {},
  });
  if (!res.ok) {
    throw new Error(`API farmacia ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return data.productos || [];
}

async function sincronizarSupabase(productos) {
  if (!SUPABASE_URL || !SUPABASE_ROLE) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el .env del consumidor.');
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let upsertados = 0;
  let errores = 0;

  // Procesamos en lotes para no saturar el rate limit de Supabase
  const LOTE = 50;
  for (let i = 0; i < productos.length; i += LOTE) {
    const lote = productos.slice(i, i + LOTE);
    for (const p of lote) {
      const { error } = await sb.rpc('productos_tpv_upsert', {
        p_sku: p.sku,
        p_nombre: p.nombre,
        p_descripcion: p.descripcion || null,
        p_precio: Number(p.precio),
        p_stock: Number(p.stock),
      });
      if (error) {
        errores++;
        console.error(`  ✗ ${p.sku} ${p.nombre}: ${error.message}`);
      } else {
        upsertados++;
      }
    }
  }

  return { total: productos.length, upsertados, errores };
}

async function main() {
  console.log(`[consumidor] obteniendo catálogo de ${URL}/productos …`);
  const productos = await obtenerProductos();
  console.log(`[consumidor] recibidos ${productos.length} productos.`);

  const resumen = await sincronizarSupabase(productos);
  console.log(
    `[consumidor] sincronizados ${resumen.upsertados}/${resumen.total} (${resumen.errores} errores).`
  );

  if (resumen.errores > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[consumidor]', err.message);
  process.exit(1);
});