'use strict';

// #V57a · Paridad JS ↔ SQL de la búsqueda consolidada.
// Para cada query compara el resultado del camino JS de referencia
// (`consultarPrecioYStockJS`, el que usa el bot si la RPC no está) con el de la
// RPC `buscar_productos_bot`. Se llama con `p_telefono = null` => la RPC es de
// SOLO LECTURA (no toca la rotación), así el test no muta nada.
//
// Requiere credenciales de Supabase. Como este worktree no tiene .env, lánzalo
// apuntando al .env del repo principal:
//   $env:DOTENV_CONFIG_PATH='C:\Users\Aleja\Projects\CRM-DFD\.env'
//   node -r dotenv/config scripts/test-busqueda-parity.js

const { rpc } = require('../src/lib/supabase');
const { tokensQuery, esPrecioBarato } = require('../src/lib/busqueda');
const { consultarPrecioYStockJS } = require('../src/services/tools');

let fallos = 0;
let total = 0;
function test(desc, ok, detalle) {
  total++;
  console.log((ok ? '[OK] ' : '[FALLA] ') + desc);
  if (!ok) {
    fallos++;
    process.exitCode = 1;
    if (detalle) console.log('       ' + detalle);
  }
}

// Normaliza una lista de productos para comparar solo lo observable por el bot.
function normaliza(lista) {
  return (lista || []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion ?? null,
    precio: Number(p.precio),
    precio_usd: Number(p.precio_usd || 0),
    stock: Number(p.stock),
    disponible: Boolean(p.disponible),
  }));
}

// (query, orden_precio) — mezcla de casos comunes, uni/multitoken, unidades,
// rotación y "el más barato", más dos negativos.
const CASOS = [
  ['paracetamol 500', undefined],
  ['paracetamol 500 mg', undefined],
  ['ibuprofeno', undefined],
  ['ibuprofeno 400 mg', 'asc'],
  ['ibuprofeno, el más barato', 'asc'],
  ['amoxicilina 500 mg', undefined],
  ['amoxicilina 1 g', undefined],
  ['omeprazol 20 mg', undefined],
  ['vitamina c', undefined],
  ['dipirona', undefined],
  ['jarabe', undefined],
  ['crema', undefined],
  ['x', undefined],
  ['zzz producto inexistente qwerty', undefined],
];

(async () => {
  try {
    let conProductos = 0;
    for (const [raw, orden] of CASOS) {
      const esBarato = esPrecioBarato(raw, orden);

      const jsRes = await consultarPrecioYStockJS(raw, tokensQuery(raw), esBarato, null);
      const rpcRes = await rpc('buscar_productos_bot', {
        p_query: raw,
        p_telefono: null,
        p_es_barato: esBarato,
        p_top: 3,
      });

      const mismaForma = jsRes.ok === rpcRes.ok;
      const mismoMensaje = (jsRes.mensaje || null) === (rpcRes.mensaje || null);
      const jsP = normaliza(jsRes.productos);
      const rpcP = normaliza(rpcRes.productos);
      const mismosProductos = JSON.stringify(jsP) === JSON.stringify(rpcP);
      if (jsP.length) conProductos++;

      test(
        `paridad [${raw}] (esBarato=${esBarato}) -> ${jsP.length} producto(s)`,
        mismaForma && mismoMensaje && mismosProductos,
        `JS=${JSON.stringify(jsRes)}\n       RPC=${JSON.stringify(rpcRes)}`
      );
    }

    test('al menos una query devolvió productos (el test es significativo)', conProductos > 0,
      `conProductos=${conProductos}`);

    console.log(fallos
      ? `\n${fallos} de ${total} pruebas fallidas`
      : `\nTodas las pruebas OK (${total} casos)`);
    if (fallos) process.exit(1);
  } catch (err) {
    console.error('Error fatal en el test de paridad:', err?.message || err);
    process.exit(1);
  }
})();
