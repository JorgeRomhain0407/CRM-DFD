'use strict';

// #V57 · Batería de FEFO por lotes (determinista, sin BD).
// Uso: `node scripts/test-fefo.js`

const {
  fechaHoy,
  aFechaISO,
  estaVencido,
  filtrarVigentes,
  ordenarRecomendados,
} = require('../src/lib/fefo');

let ok = 0;
let fail = 0;
function check(desc, cond) {
  if (cond) ok += 1;
  else {
    fail += 1;
    console.log(`FALLO: ${desc}`);
  }
}

// Candidato de prueba (forma que arma tools.js para el motor).
function cand(nombre, { coinciden = 1, marca = 0, veces = 0, stock = 0, venc = null, precio = 0 } = {}) {
  return { p: { nombre, precio, stock }, coinciden, marca, veces, venc };
}
const nombres = (lista) => lista.map((c) => c.p.nombre);

// --- aFechaISO ---------------------------------------------------------------
check('aFechaISO string ISO', aFechaISO('2028-03-01') === '2028-03-01');
check('aFechaISO con hora', aFechaISO('2028-03-01T00:00:00+00:00') === '2028-03-01');
check('aFechaISO Date', aFechaISO(new Date(Date.UTC(2027, 0, 31))) === '2027-01-31');
check('aFechaISO null', aFechaISO(null) === null);
check('aFechaISO basura', aFechaISO('no-es-fecha') === null);

// --- estaVencido -------------------------------------------------------------
const HOY = '2026-10-13';
check('vencido ayer', estaVencido('2026-10-12', HOY) === true);
check('vence hoy (aún vigente)', estaVencido('2026-10-13', HOY) === false);
check('vence futuro', estaVencido('2027-01-01', HOY) === false);
check('sin fecha no vence', estaVencido(null, HOY) === false);

// --- filtrarVigentes ---------------------------------------------------------
const conVencidos = [
  cand('vencido', { venc: '2026-10-12' }),
  cand('vigente', { venc: '2026-10-13' }),
  cand('futuro', { venc: '2030-01-01' }),
  cand('sin fecha', { venc: null }),
];
check(
  'filtrarVigentes quita vencidos',
  JSON.stringify(nombres(filtrarVigentes(conVencidos, HOY))) ===
    JSON.stringify(['vigente', 'futuro', 'sin fecha'])
);

// --- ordenarRecomendados -----------------------------------------------------
// 1) FEFO entre iguales: primero el que vence antes.
let r = ordenarRecomendados([
  cand('tardia', { venc: '2028-01-01' }),
  cand('temprana', { venc: '2027-01-01' }),
]);
check('FEFO primero el que vence antes', nombres(r)[0] === 'temprana');

// 2) Sin fecha conocida va al final.
r = ordenarRecomendados([
  cand('sin fecha', { venc: null }),
  cand('con fecha', { venc: '2030-01-01' }),
]);
check('FEFO sin fecha al final', nombres(r)[0] === 'con fecha');

// 3) La rotación (variedad) manda sobre FEFO.
r = ordenarRecomendados([
  cand('repetida-pronto', { veces: 1, venc: '2027-01-01' }),
  cand('nueva-tarde', { veces: 0, venc: '2029-01-01' }),
]);
check('rotación por encima de FEFO', nombres(r)[0] === 'nueva-tarde');

// 4) El stock manda sobre FEFO (evita ofrecer combos con 1-5 unidades).
r = ordenarRecomendados([
  cand('poco-stock-pronto', { stock: 1, venc: '2027-01-01' }),
  cand('mucho-stock-tarde', { stock: 999, venc: '2029-01-01' }),
]);
check('stock por encima de FEFO', nombres(r)[0] === 'mucho-stock-tarde');

// 4b) Con el mismo stock, FEFO desempata (primero el que vence antes).
r = ordenarRecomendados([
  cand('tardia', { stock: 10, venc: '2029-01-01' }),
  cand('temprana', { stock: 10, venc: '2027-01-01' }),
]);
check('con stock igual, FEFO desempata', nombres(r)[0] === 'temprana');

// 5) "Lo más barato" manda sobre rotación/FEFO; sin el flag, gana FEFO.
const barato = [
  cand('caro-pronto', { precio: 10, venc: '2027-01-01' }),
  cand('barato-tarde', { precio: 5, venc: '2029-01-01' }),
];
check('esBarato: precio manda', nombres(ordenarRecomendados(barato, { esBarato: true }))[0] === 'barato-tarde');
check('sin esBarato: FEFO manda', nombres(ordenarRecomendados(barato, { esBarato: false }))[0] === 'caro-pronto');

// 6) Mejor coincidencia de tokens manda sobre FEFO.
r = ordenarRecomendados([
  cand('menos-coincide-pronto', { coinciden: 1, venc: '2027-01-01' }),
  cand('mas-coincide-tarde', { coinciden: 2, venc: '2029-01-01' }),
]);
check('coincidencia por encima de FEFO', nombres(r)[0] === 'mas-coincide-tarde');

// 7) Marca específica manda sobre FEFO.
r = ordenarRecomendados([
  cand('generica-pronto', { marca: 0, venc: '2027-01-01' }),
  cand('marca-tarde', { marca: 1, venc: '2029-01-01' }),
]);
check('marca por encima de FEFO', nombres(r)[0] === 'marca-tarde');

// 8) Empate total -> más stock y luego precio desc.
r = ordenarRecomendados([
  cand('a', { stock: 10, precio: 20, venc: '2027-01-01' }),
  cand('b', { stock: 50, precio: 5, venc: '2027-01-01' }),
]);
check('empate: más stock primero', nombres(r)[0] === 'b');

// 9) No muta el array de entrada.
const entrada = [cand('x', { venc: '2029-01-01' }), cand('y', { venc: '2027-01-01' })];
ordenarRecomendados(entrada);
check('no muta la entrada', nombres(entrada)[0] === 'x');

// fechaHoy devuelve 'YYYY-MM-DD'.
check('fechaHoy formato', /^\d{4}-\d{2}-\d{2}$/.test(fechaHoy(new Date(2026, 9, 13))));

console.log(`\nFEFO por lotes: ${ok} pasan, ${fail} fallan (${ok + fail} casos)`);
process.exit(fail > 0 ? 1 : 0);
