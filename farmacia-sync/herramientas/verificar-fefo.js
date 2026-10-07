'use strict';

/*
 * Verificador FEFO. Hace DOS comprobaciones:
 *   1) vía HTTP contra el servidor (/productos)
 *   2) directa contra la BD del TPV (driver + config espejo del servidor)
 *      -> así vemos el error SQL real si la consulta de lotes falla.
 * Uso (desde C:\farmacia-sync):  node herramientas\verificar-fefo.js
 */

const fs = require('fs');
require('dotenv').config({ path: fs.existsSync('.env') ? '.env' : 'farmacia.env' });

const drivers = require('../src/drivers');
const URL_BASE = process.env.FARMACIA_SYNC_URL_VERIFICAR || 'http://127.0.0.1:4000';
const TOKEN = process.env.FARMACIA_SYNC_TOKEN;

// Refleja la config que arma src/servidor/index.js
function configServidor() {
  return {
    file: process.env.FARMACIA_SYNC_DB_FILE,
    server: process.env.FARMACIA_SYNC_DB_SERVER,
    port: process.env.FARMACIA_SYNC_DB_PORT,
    user: process.env.FARMACIA_SYNC_DB_USER,
    password: process.env.FARMACIA_SYNC_DB_PASSWORD,
    database: process.env.FARMACIA_SYNC_DB_DATABASE,
    tabla: process.env.FARMACIA_SYNC_DB_TABLA,
    donde: process.env.FARMACIA_SYNC_DB_DONDE,
    perfil: process.env.FARMACIA_SYNC_PERFIL,
    columnas: {
      sku: process.env.FARMACIA_SYNC_COL_SKU,
      nombre: process.env.FARMACIA_SYNC_COL_NOMBRE,
      descripcion: process.env.FARMACIA_SYNC_COL_DESCRIPCION,
      precio: process.env.FARMACIA_SYNC_COL_PRECIO,
      stock: process.env.FARMACIA_SYNC_COL_STOCK,
      precioUsd: process.env.FARMACIA_SYNC_COL_PRECIOUSD,
      marca: process.env.FARMACIA_SYNC_COL_MARCA,
    },
    lotes: process.env.FARMACIA_SYNC_LOTES_TABLA?.trim()
      ? {
          tabla: process.env.FARMACIA_SYNC_LOTES_TABLA,
          donde: process.env.FARMACIA_SYNC_LOTES_DONDE,
          columnas: {
            sku: process.env.FARMACIA_SYNC_LOTES_COL_SKU,
            lote: process.env.FARMACIA_SYNC_LOTES_COL_LOTE,
            fechaVencimiento: process.env.FARMACIA_SYNC_LOTES_COL_FECHA_VENCIMIENTO,
            stock: process.env.FARMACIA_SYNC_LOTES_COL_STOCK,
          },
        }
      : null,
  };
}

function resumen(productos, lotes) {
  const conMarca = (productos || []).filter((p) => p.marca).length;
  console.log(`  productos: ${productos.length}`);
  console.log(`  con marca: ${conMarca} (${((100 * conMarca) / Math.max(1, productos.length)).toFixed(1)}%)`);
  console.log(`  lotes: ${lotes.length}`);
  for (const p of (productos || []).slice(0, 3)) console.log('    ' + JSON.stringify(p));
  const porFecha = [...lotes].sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
  for (const l of porFecha.slice(0, 5)) console.log('    ' + JSON.stringify(l));

  const porSku = new Map();
  for (const l of lotes) porSku.set(l.sku, [...(porSku.get(l.sku) || []), l]);
  const multi = [...porSku.entries()].filter(([, a]) => a.length > 1);
  console.log(`  productos con 2+ lotes: ${multi.length}`);
  for (const [sku, a] of multi.slice(0, 5)) {
    a.sort((x, y) => x.fechaVencimiento.localeCompare(y.fechaVencimiento));
    console.log(
      `    sku ${sku} → FEFO=${a[0].lote} (${a[0].fechaVencimiento}, stock ${a[0].stock}) | otros: ` +
        a.slice(1).map((x) => `${x.lote}/${x.fechaVencimiento}`).join(', ')
    );
  }
}

async function main() {
  const config = configServidor();
  console.log(`perfil=${config.perfil || '(vacío)'} tabla=${config.tabla} colMarca=${config.columnas.marca || '(vacío)'} lotesTabla=${config.lotes ? config.lotes.tabla : '(vacío)'}`);

  console.log('\n== 1) VIA HTTP (servidor) ==');
  try {
    const res = await fetch(`${URL_BASE}/productos`, { headers: TOKEN ? { 'x-api-key': TOKEN } : {} });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const d = await res.json();
    resumen(d.productos || [], d.lotes || []);
    if (!(d.lotes || []).length) console.log('  ⚠️  el servidor devolvió 0 lotes');
  } catch (err) {
    console.log(`  x ${err.message}  (¿el servidor está corriendo?)`);
  }

  console.log('\n== 2) DIRECTO A LA BD DEL TPV ==');
  const driver = drivers.loadDriver(process.env.FARMACIA_SYNC_DB_TIPO);
  console.log(`  driver=${process.env.FARMACIA_SYNC_DB_TIPO} leerLotes=${typeof driver.leerLotes}`);
  let productos = [];
  try {
    productos = await driver.leerProductos(config);
    console.log(`  productos OK: ${productos.length}`);
  } catch (err) {
    console.log(`  x leerProductos: ${err.message}`);
  }
  if (productos.length) {
    const conMarca = productos.filter((p) => p.marca).length;
    console.log(`  con marca: ${conMarca} (${((100 * conMarca) / productos.length).toFixed(1)}%)`);
    for (const p of productos.slice(0, 3)) console.log('    ' + JSON.stringify(p));
  }
  try {
    const lotes = await driver.leerLotes(config);
    console.log(`  lotes OK: ${lotes.length}`);
    for (const l of lotes.slice(0, 5)) console.log('    ' + JSON.stringify(l));
    const fechas = lotes.map((l) => l.fechaVencimiento).sort();
    if (fechas.length) console.log(`  vencimiento: ${fechas[0]} … ${fechas[fechas.length - 1]}`);
  } catch (err) {
    console.log(`  x leerLotes: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('x', err.message);
  process.exit(1);
});
