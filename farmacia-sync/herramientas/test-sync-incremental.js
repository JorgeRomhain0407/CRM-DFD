'use strict';

// #V103 · Batería determinista del sincronizador incremental de catálogo.
// No toca Supabase: el cliente falso solo cuenta y simula fallos.
// Uso: `node herramientas/test-sync-incremental.js`

const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE = path.join(os.tmpdir(), `crm-sync-test-${process.pid}.json`);
process.env.CRM_SYNC_CATALOGO_PATH = CACHE;
process.env.CRM_SYNC_RECONCILIAR_HORAS = '24';

const { sincronizarSupabase } = require('../src/consumidor/sync');

let ok = 0;
let fail = 0;
function check(desc, cond) {
  if (cond) {
    ok += 1;
  } else {
    fail += 1;
    console.log(`FALLO: ${desc}`);
  }
}

function crearFakeSb() {
  const llamadas = { productos: [], lotes: [] };
  const fallos = new Set();
  return {
    llamadas,
    fallos,
    reset() {
      llamadas.productos = [];
      llamadas.lotes = [];
    },
    async rpc(nombre, args) {
      if (nombre === 'productos_tpv_upsert') {
        llamadas.productos.push(args.p_sku);
        if (fallos.has('p:' + args.p_sku)) return { data: null, error: { message: 'fallo simulado' } };
        return { data: [{ out_sku: args.p_sku, out_actividad: 'ok' }], error: null };
      }
      if (nombre === 'lotes_tpv_upsert') {
        const clave = args.p_sku + '/' + args.p_lote;
        llamadas.lotes.push(clave);
        if (fallos.has('l:' + clave)) return { data: null, error: { message: 'fallo simulado' } };
        return { data: [{ out_sku: args.p_sku, out_lote: args.p_lote }], error: null };
      }
      throw new Error(`RPC inesperada: ${nombre}`);
    },
  };
}

function producto(sku, { nombre = `Producto ${sku}`, stock = 10, precio = 1.5, precioUsd = 1, marca = 'DFD', descripcion = 'desc' } = {}) {
  return { sku, nombre, descripcion, precio, precioUsd, stock, marca };
}

function lote(sku, codigo, { stock = 5, fechaVencimiento = '2028-01-31' } = {}) {
  return { sku, lote: codigo, fechaVencimiento, stock };
}

function catalogo(stockP2 = 10, stockL1 = 5, incluirP3 = true) {
  const productos = [
    producto('P1', { stock: 3 }),
    producto('P2', { stock: stockP2 }),
    ...(incluirP3 ? [producto('P3', { stock: 7 })] : []),
  ];
  const lotes = [
    lote('P1', 'L1', { stock: stockL1 }),
    lote('P1', 'L2'),
    lote('P2', 'L1'),
    lote('P3', 'L1'),
  ];
  return { productos, lotes };
}

async function pasada(sb, datos) {
  sb.reset();
  return sincronizarSupabase(datos.productos, datos.lotes, sb);
}

async function main() {
  try {
    fs.unlinkSync(CACHE);
  } catch (_) {
    /* no existía */
  }

  const sb = crearFakeSb();

  // 1) Primera pasada: sin caché se envía todo.
  let r = await pasada(sb, catalogo());
  check('1ª pasada envía 3 productos', sb.llamadas.productos.length === 3);
  check('1ª pasada envía 4 lotes', sb.llamadas.lotes.length === 4);
  check('1ª pasada marca reconciliación', r.reconciliado === true);

  // 2) Segunda pasada idéntica: cero peticiones (el objetivo del cambio).
  r = await pasada(sb, catalogo());
  check('2ª pasada idéntica no envía productos', sb.llamadas.productos.length === 0);
  check('2ª pasada idéntica no envía lotes', sb.llamadas.lotes.length === 0);
  check('2ª pasada no reconcilia', r.reconciliado === false);

  // 3) Cambia el stock de un producto y de un lote: solo esas dos filas.
  r = await pasada(sb, catalogo(11, 9));
  check('stock de P2 envía solo P2', JSON.stringify(sb.llamadas.productos) === JSON.stringify(['P2']));
  check('stock del lote P1/L1 envía solo ese lote', JSON.stringify(sb.llamadas.lotes) === JSON.stringify(['P1/L1']));
  check('no reconcilia por un cambio normal', r.reconciliado === false);

  // 4) Un fallo no se pierde: se reintenta en la pasada siguiente.
  sb.fallos.add('p:P3');
  r = await pasada(sb, catalogoConP3Stock(8));
  check('intenta P3 y falla', sb.llamadas.productos.includes('P3') && r.errores === 1);
  sb.fallos.delete('p:P3');
  r = await pasada(sb, catalogoConP3Stock(8));
  check('P3 se reintenta tras el fallo', sb.llamadas.productos.includes('P3') && r.errores === 0);

  // 5) Un producto que desaparece del TPV se poda y, si vuelve, se reenvía.
  await pasada(sb, catalogo(11, 9, false));
  const cachePodada = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  check('P3 podado de la caché', !('P3' in cachePodada.productos));
  await pasada(sb, catalogo(11, 9, true));
  check('P3 reenviado al reaparecer', sb.llamadas.productos.includes('P3'));

  // 6) Reconciliación completa al vencer la ventana: reenvía todo.
  const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  cache.reconciliado = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(CACHE, JSON.stringify(cache), 'utf8');
  r = await pasada(sb, catalogo(11, 9, true));
  check('reconciliación completa reenvía los 3 productos', sb.llamadas.productos.length === 3);
  check('reconciliación completa reenvía los 4 lotes', sb.llamadas.lotes.length === 4);
  check('la pasada se marca como reconciliación', r.reconciliado === true);

  // 7) Caché corrupta: se trata como vacía (pasada completa) y no rompe.
  fs.writeFileSync(CACHE, '{ esto no es json', 'utf8');
  r = await pasada(sb, catalogo(11, 9, true));
  check('caché corrupta fuerza pasada completa', sb.llamadas.productos.length === 3 && r.errores === 0);

  // 8) Catálogo vacío por un fallo del TPV: no borra la caché.
  fs.unlinkSync(CACHE);
  await pasada(sb, catalogo());
  await pasada(sb, { productos: [], lotes: [] });
  const cacheTrasVacio = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  check('catálogo vacío conserva la caché', Object.keys(cacheTrasVacio.productos).length === 3);

  try {
    fs.unlinkSync(CACHE);
  } catch (_) {
    /* nada */
  }

  console.log(`\n#V103 sync incremental: ${ok}/${ok + fail} OK`);
  if (fail > 0) process.exitCode = 1;
}

function catalogoConP3Stock(stock) {
  const base = catalogo(11, 9, true);
  base.productos = base.productos.map((p) => (p.sku === 'P3' ? { ...p, stock } : p));
  return base;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
