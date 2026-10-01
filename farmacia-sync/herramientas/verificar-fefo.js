'use strict';

/*
 * Verifica el endpoint /productos del servidor farmacia-sync:
 * conteos, % de productos con marca, muestra de lotes y simulación FEFO.
 * Uso (desde C:\farmacia-sync):  node herramientas\verificar-fefo.js
 */

const fs = require('fs');
require('dotenv').config({ path: fs.existsSync('.env') ? '.env' : 'farmacia.env' });

const URL_BASE = process.env.FARMACIA_SYNC_URL_VERIFICAR || 'http://localhost:4000';
const TOKEN = process.env.FARMACIA_SYNC_TOKEN;

async function main() {
  const res = await fetch(`${URL_BASE}/productos`, { headers: TOKEN ? { 'x-api-key': TOKEN } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const datos = await res.json();
  const productos = datos.productos || [];
  const lotes = datos.lotes || [];
  const conMarca = productos.filter((p) => p.marca).length;

  console.log(`productos: ${productos.length}`);
  console.log(`con marca: ${conMarca} (${((100 * conMarca) / Math.max(1, productos.length)).toFixed(1)}%)`);
  console.log(`lotes: ${lotes.length}`);

  console.log('\nproductos (muestra):');
  for (const p of productos.slice(0, 5)) console.log('  ' + JSON.stringify(p));

  console.log('\nlotes (muestra por fecha de vencimiento):');
  const porFecha = [...lotes].sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
  for (const l of porFecha.slice(0, 8)) console.log('  ' + JSON.stringify(l));

  const porSku = new Map();
  for (const l of lotes) {
    const arr = porSku.get(l.sku) || [];
    arr.push(l);
    porSku.set(l.sku, arr);
  }
  const multi = [...porSku.entries()].filter(([, a]) => a.length > 1);
  console.log(`\nproductos con 2+ lotes: ${multi.length}`);
  for (const [sku, a] of multi.slice(0, 5)) {
    a.sort((x, y) => x.fechaVencimiento.localeCompare(y.fechaVencimiento));
    const otros = a.slice(1).map((x) => `${x.lote}/${x.fechaVencimiento}`).join(', ');
    console.log(`  sku ${sku} → FEFO=${a[0].lote} (${a[0].fechaVencimiento}, stock ${a[0].stock}) | otros: ${otros}`);
  }

  const fechas = porFecha.map((l) => l.fechaVencimiento);
  if (fechas.length) console.log(`\nvencimiento más próximo: ${fechas[0]} | más lejano: ${fechas[fechas.length - 1]}`);
  if (!lotes.length) console.log('\n⚠️  0 lotes: revisa FARMACIA_SYNC_PERFIL en el .env y el log del servidor.');
}

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
