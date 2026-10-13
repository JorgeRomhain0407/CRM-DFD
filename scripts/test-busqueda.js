'use strict';

// #V57a · Batería de la búsqueda de productos (parte PURA, sin BD).
// Verifica el tokenizador (unidades canónicas), el matching, la detección de
// "el más barato" y el ORDEN TOTAL de candidatos. La paridad JS↔SQL se prueba
// aparte en scripts/test-busqueda-parity.js (contra la RPC real).
// Lanza con: `node scripts/test-busqueda.js`

const {
  normalizarTokens,
  tokensQuery,
  matchToken,
  esPrecioBarato,
  medularDe,
  patronBaseDe,
  compararOrden,
  rankearCandidatos,
} = require('../src/lib/busqueda');

let fallos = 0;
let total = 0;
function test(desc, ok) {
  total++;
  console.log((ok ? '[OK] ' : '[FALLA] ') + desc);
  if (!ok) { fallos++; process.exitCode = 1; }
}
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------
console.log('— normalizarTokens —');
test('[1 Gramo de Amoxicilina 500mg] -> unidades canónicas',
  eq(normalizarTokens('1 Gramo de Amoxicilina 500mg'), ['1', 'gramo', 'de', 'amoxicilina', '500', 'miligramo']));
test('acentos: cápsulas -> capsulas',
  eq(normalizarTokens('cápsulas'), ['capsulas']));
test('puntuación se vuelve espacio: "Paracetamol, 500 mg."',
  eq(normalizarTokens('Paracetamol, 500 mg.'), ['paracetamol', '500', 'miligramo']));
test('dígito-letra se separan: "1g" -> "1","gramo"',
  eq(normalizarTokens('1g'), ['1', 'gramo']));
test('mg/miligramos/miligramo colapsan a "miligramo"',
  eq(normalizarTokens('mg'), ['miligramo']) &&
  eq(normalizarTokens('miligramos'), ['miligramo']) &&
  eq(normalizarTokens('MILIGRAMO'), ['miligramo']));
test('texto vacío -> []',
  eq(normalizarTokens(''), []) && eq(normalizarTokens('   '), []));
test('null no revienta',
  eq(normalizarTokens(null), []));

// ---------------------------------------------------------------------
console.log('— tokensQuery —');
test('quita stopwords y tokens de 1 char',
  eq(tokensQuery('quiero el paracetamol de 500 mg'), ['paracetamol', '500', 'miligramo']));
test('todo stopwords -> []', eq(tokensQuery('quiero el de la'), []));

// ---------------------------------------------------------------------
console.log('— matchToken —');
test('unidad: exacto (no substring)', matchToken('gramo', 'gramo') && !matchToken('miligramo', 'gramo'));
test('mismo caso contrario: substring tolera raíces',
  matchToken('amoxicilina', 'amoxi') && matchToken('amoxi', 'amoxicilina'));
test('substring inverso', matchToken('paracetamol', 'paracetam'));
test('sin relación', !matchToken('ibuprofeno', 'paracetamol'));

// ---------------------------------------------------------------------
console.log('— esPrecioBarato —');
test('"el más barato" + asc -> true', esPrecioBarato('ibuprofeno, el más barato', 'asc'));
test('"precio mínimo" -> true', esPrecioBarato('cual es el precio minimo', 'asc'));
test('"económico" + asc -> true', esPrecioBarato('algo económico', 'asc'));
test('asc sin señal de precio -> false', esPrecioBarato('ibuprofeno', 'asc') === false);
test('señal de precio sin asc -> false', esPrecioBarato('el más barato', 'desc') === false);
test('vacío -> false', esPrecioBarato('', undefined) === false);

// ---------------------------------------------------------------------
console.log('— medularDe / patronBaseDe —');
test('medular = token más largo',
  medularDe(['paracetamol', '500', 'miligramo']) === 'paracetamol');
test('empate de longitud conserva el primero',
  medularDe(['aaaa', 'bbbb', 'cc']) === 'aaaa');
test('patronBase = palabra cruda más larga no-stopword',
  patronBaseDe('quiero amoxicilina de 500 mg', 'miligramo') === 'amoxicilina');
test('patronBase cae al medular si no hay palabra cruda útil',
  patronBaseDe('de la', 'paracetamol') === 'paracetamol');

// ---------------------------------------------------------------------
console.log('— compararOrden (orden total) —');
test('más coincidencias primero',
  compararOrden({ coinciden: 3, marca: 0, veces: 0, stock: 1, venc: null, precio: 5, nombre: 'a' },
    { coinciden: 2, marca: 9, veces: 0, stock: 99, venc: null, precio: 1, nombre: 'b' }, false) < 0);
test('venc nulo va DESPUÉS de venc no nulo (NULLS LAST)',
  compararOrden({ coinciden: 1, marca: 0, veces: 0, stock: 1, venc: null, precio: 5, nombre: 'a' },
    { coinciden: 1, marca: 0, veces: 0, stock: 1, venc: 1000, precio: 5, nombre: 'a' }, false) > 0);
test('venc menor (más próximo a vencer) primero',
  compararOrden({ coinciden: 1, marca: 0, veces: 0, stock: 1, venc: 1000, precio: 5, nombre: 'a' },
    { coinciden: 1, marca: 0, veces: 0, stock: 1, venc: 2000, precio: 5, nombre: 'a' }, false) < 0);
test('esBarato: precio asc manda',
  compararOrden({ coinciden: 1, marca: 0, veces: 0, stock: 1, venc: null, precio: 100, nombre: 'a' },
    { coinciden: 1, marca: 0, veces: 0, stock: 1, venc: null, precio: 50, nombre: 'b' }, true) > 0);
test('sin esBarato: precio desc por defecto',
  compararOrden({ coinciden: 1, marca: 0, veces: 0, stock: 1, venc: null, precio: 100, nombre: 'a' },
    { coinciden: 1, marca: 0, veces: 0, stock: 1, venc: null, precio: 50, nombre: 'b' }, false) < 0);

// ---------------------------------------------------------------------
console.log('— rankearCandidatos —');
const candidatos = [
  { id: 'a', nombre: 'Paracetamol 500 mg', precio: 100, precio_usd: 1, stock: 10, fecha_vencimiento: '2027-01-01' },
  { id: 'b', nombre: 'Paracetamol 500 mg', precio: 90, precio_usd: 0.9, stock: 5, fecha_vencimiento: '2026-06-01' },
  { id: 'c', nombre: 'Paracetamol 500 mg extra', precio: 200, precio_usd: 2, stock: 50, fecha_vencimiento: null },
];
const tokens = tokensQuery('paracetamol 500 mg');
const rawTokens = ['paracetamol', '500', 'mg'];

const def = rankearCandidatos({ candidatos, tokens, rawTokens, esBarato: false, ctx: {}, top: 3 });
test('por defecto: más stock primero (c,a,b)', eq(def.map((p) => p.id), ['c', 'a', 'b']));

const barato = rankearCandidatos({ candidatos, tokens, rawTokens, esBarato: true, ctx: {}, top: 3 });
test('esBarato: precio asc manda (b,a,c)', eq(barato.map((p) => p.id), ['b', 'a', 'c']));

const rot = rankearCandidatos({ candidatos, tokens, rawTokens, esBarato: false, ctx: { a: { veces: 5 } }, top: 3 });
test('rotación: menos veces recomendado primero (c,b,a)', eq(rot.map((p) => p.id), ['c', 'b', 'a']));

const top2 = rankearCandidatos({ candidatos, tokens, rawTokens, esBarato: false, ctx: {}, top: 2 });
test('top N recorta', top2.length === 2 && eq(top2.map((p) => p.id), ['c', 'a']));

console.log(`\n${total - fallos}/${total} pruebas OK.`);
