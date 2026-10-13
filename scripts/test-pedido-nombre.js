'use strict';

// #V58 · Batería de la captura del nombre (pedido bloqueado sin nombre).
// Funciones puras: no tocan BD ni servidor. Uso: `node scripts/test-pedido-nombre.js`

const { extraerNombreDeMensaje, asistentePidioNombre } = require('../src/services/customers');

// [descripcion, texto, pidioAsistente, esperado]
const MENSAJES = [
  ['explicito me llamo', 'me llamo Juan Pérez', false, 'Juan Pérez'],
  ['explicito mi nombre es', 'mi nombre es Ana', false, 'Ana'],
  ['explicito soy', 'hola, soy Carlos', false, 'Carlos'],
  ['libre si el bot pidio', 'Juan', true, 'Juan'],
  ['libre compuesto', 'María José', true, 'María José'],
  ['libre sin que el bot pidiera', 'Juan', false, null],
  ['libre con aféresis', "d'Angelo", true, "d'Angelo"],
  ['rechaza confirmacion', 'sí', true, null],
  ['rechaza intencion', 'quiero 2 gasas', true, null],
  ['rechaza numeros', '1234', true, null],
  ['rechaza frase larga', 'no es eso, busco otra cosa distinta', true, null],
  ['vacio', '', true, null],
];

// [descripcion, previo, esperado]
const PREVIOS = [
  ['pidio nombre', '¿Me confirmas tu nombre para dejar el pedido?', true],
  ['como te llamas', '¿Cómo te llamas? 😊', true],
  ['a nombre de quien', '¿A nombre de quién dejo el pedido?', true],
  ['confirmacion normal', '¿Confirmas el pedido? 😊', false],
  ['resumen carrito', 'Total: Bs 203,42. ¿Confirmas?', false],
  ['vacio', '', false],
];

let ok = 0;
let fail = 0;

for (const [desc, texto, pidio, esperado] of MENSAJES) {
  const r = extraerNombreDeMensaje(texto, { pidioAsistente: pidio });
  const bien = r === esperado;
  if (bien) ok += 1;
  else {
    fail += 1;
    console.log(`FALLO mensaje: ${desc} -> ${JSON.stringify({ texto, pidio, r, esperado })}`);
  }
}

for (const [desc, previo, esperado] of PREVIOS) {
  const r = asistentePidioNombre(previo);
  const bien = r === esperado;
  if (bien) ok += 1;
  else {
    fail += 1;
    console.log(`FALLO previo: ${desc} -> ${JSON.stringify({ previo, r, esperado })}`);
  }
}

console.log(`\nNombre de pedido: ${ok} pasan, ${fail} fallan (${MENSAJES.length + PREVIOS.length} casos)`);
process.exit(fail > 0 ? 1 : 0);
