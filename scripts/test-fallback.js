'use strict';

// #V53 · Batería del fallback/escalado multicapa — ejecutable sin servidor ni BD.
// Uso: `node scripts/test-fallback.js`

const { detectarEscaladoDirecto, capaFallback } = require('../src/lib/fallback');

// [descripcion, texto, causaEsperada | null]
const DIRECTOS = [
  ['pide persona', 'quiero hablar con una persona', 'usuario'],
  ['pide encargado', 'ponme con el encargado por favor', 'usuario'],
  ['pide humano', '¿me atiende alguien de la farmacia? no, una persona real', 'usuario'],
  ['atencion al cliente', 'necesito hablar con atencion al cliente', 'usuario'],
  ['reclamacion', 'quiero poner una reclamacion', 'sensible'],
  ['queja', 'voy a poner una queja', 'sensible'],
  ['cobro indebido', 'me habeis cobrado de mas en el ultimo pedido', 'sensible'],
  ['devolucion dinero', 'quiero la devolucion del importe', 'sensible'],
  ['frustracion', 'no me entiendes, no sirves para nada', 'frustracion'],
  ['eres un bot', 'eres un bot y no me ayudas', 'frustracion'],
  ['harto', 'esto no funciona, estoy harto', 'frustracion'],
  ['normal', '¿cuánto cuesta el paracetamol?', null],
  ['normal 2', 'agrega 2 gelocatil al carrito', null],
  ['vacio', '', null],
  ['saludo', 'hola, buenas tardes', null],
];

// [descripcion, entrada, capaEsperada]
const CAPAS = [
  ['claro', { intent: 'buscar', confianza: 'alta', fallbackSeguidos: 0 }, 'ninguna'],
  ['claro con racha', { intent: 'carrito', confianza: 'alta', fallbackSeguidos: 5 }, 'ninguna'],
  ['1ª vez', { intent: 'general', confianza: 'baja', fallbackSeguidos: 0 }, 'aclarar'],
  ['2ª vez', { intent: 'general', confianza: 'baja', fallbackSeguidos: 1 }, 'sugerir'],
  ['3ª vez', { intent: 'general', confianza: 'baja', fallbackSeguidos: 2 }, 'escalar'],
  ['4ª vez', { intent: 'general', confianza: 'baja', fallbackSeguidos: 3 }, 'escalar'],
  ['default', {}, 'ninguna'],
];

let ok = 0;
let fail = 0;

for (const [desc, texto, causaEsp] of DIRECTOS) {
  const r = detectarEscaladoDirecto(texto);
  const causa = r ? r.causa : null;
  const bien = causa === causaEsp && (!r || (r.acuse && r.motivo));
  if (bien) {
    ok += 1;
  } else {
    fail += 1;
    console.log(`FALLO directo: ${desc} -> ${JSON.stringify({ texto, causa, esperado: causaEsp })}`);
  }
}

for (const [desc, entrada, capaEsp] of CAPAS) {
  const capa = capaFallback(entrada);
  const bien = capa === capaEsp;
  if (bien) {
    ok += 1;
  } else {
    fail += 1;
    console.log(`FALLO capa: ${desc} -> ${JSON.stringify({ entrada, capa, esperado: capaEsp })}`);
  }
}

console.log(`\nFallback: ${ok} pasan, ${fail} fallan (${DIRECTOS.length + CAPAS.length} casos)`);
process.exit(fail > 0 ? 1 : 0);
