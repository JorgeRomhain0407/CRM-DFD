'use strict';

// #V56 · Batería de perfil de consumo + prioridad de recomendaciones.
//   Parte 1: aggregación pura `resumirPerfilConsumo` (sin BD).
//   Parte 2: invariantes del mapa de prioridades (orden relativo).
// Lanza con: `node scripts/test-recomendaciones.js`

const { resumirPerfilConsumo, RECOMENDACION_PRIORIDAD } = require('../src/lib/recomendaciones');

let fallos = 0;
let total = 0;
function test(desc, ok) {
  total++;
  console.log((ok ? '[OK] ' : '[FALLA] ') + desc);
  if (!ok) { fallos++; process.exitCode = 1; }
}

// ---------------------------------------------------------------------
// Parte 1 · resumirPerfilConsumo
// ---------------------------------------------------------------------
const MED = [
  // cliente que compra vitaminas (curadas) y un producto sin categoría
  { cantidad: 3, productos: { nombre: 'Vitamina C', categoria_id: 'c1', fidelizacion_categorias: { nombre: 'Vitaminas' } } },
  { cantidad: 1, productos: { nombre: 'Vitamina C', categoria_id: 'c1', fidelizacion_categorias: { nombre: 'Vitaminas' } } },
  { cantidad: 2, productos: { nombre: 'Omega 3', categoria_id: 'c1', fidelizacion_categorias: { nombre: 'Vitaminas' } } },
  { cantidad: 5, productos: { nombre: 'Crema X', categoria_id: 'c2', fidelizacion_categorias: { nombre: 'Dermocosmética' } } },
  { cantidad: 1, productos: { nombre: 'Gasa', categoria_id: null, fidelizacion_categorias: null } },
];

console.log('— resumirPerfilConsumo —');
const r = resumirPerfilConsumo(MED);
test('intereses incluye los productos comprados', r.intereses.includes('Vitamina C') && r.intereses.includes('Crema X'));
test('intereses ordenados por unidades (Crema X=5 primero)', r.intereses[0] === 'Crema X');
test('categorías cuentan unidades por categoría (Vitaminas=6)', r.categorias.Vitaminas === 6);
test('categorías cuentan unidades por categoría (Dermocosmética=5)', r.categorias.Dermocosmética === 5);
test('producto sin categoría no crea entrada de categoría', !('null' in r.categorias) && Object.keys(r.categorias).length === 2);
test('no incluye categorías con nombre vacío', Object.keys(r.categorias).every((k) => k.trim().length > 0));

const vacio = resumirPerfilConsumo([]);
test('lista vacía → perfil vacío', vacio.intereses.length === 0 && Object.keys(vacio.categorias).length === 0);
test('null no revienta', resumirPerfilConsumo(null).intereses.length === 0);

// Cap de intereses (MAX_INTERESES = 8)
const muchos = Array.from({ length: 20 }, (_, i) => ({
  cantidad: i + 1,
  productos: { nombre: `P${i}`, categoria_id: null, fidelizacion_categorias: null },
}));
test('intereses acotados a 8', resumirPerfilConsumo(muchos).intereses.length === 8);

// Cantidad inválida/ausente cuenta como 1 (no rompe la agregación).
const rara = resumirPerfilConsumo([
  { cantidad: 0, productos: { nombre: 'A', categoria_id: 'c1', fidelizacion_categorias: { nombre: 'Cat' } } },
  { productos: { nombre: 'A', categoria_id: 'c1', fidelizacion_categorias: { nombre: 'Cat' } } },
]);
test('cantidad 0/ausente cuenta como 1', rara.categorias.Cat === 2);

// ---------------------------------------------------------------------
// Parte 2 · prioridad de criterios
// ---------------------------------------------------------------------
console.log('— prioridades —');
const P = RECOMENDACION_PRIORIDAD;
test('hábito manda sobre todas', P.habito > P.categoria && P.habito > P.co_ocurrencia && P.habito > P.contenido && P.habito > P.populares);
test('categoría entre hábito y co-ocurrencia', P.categoria < P.habito && P.categoria > P.co_ocurrencia);
test('co-ocurrencia sobre contenido', P.co_ocurrencia > P.contenido);
test('contenido sobre populares', P.contenido > P.populares);
test('prioridades son enteros positivos', Object.values(P).every((v) => Number.isInteger(v) && v > 0));

console.log(`\n${total - fallos}/${total} pruebas OK.`);
