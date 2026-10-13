'use strict';

// #V55 · Batería del matcher de KB (determinista, sin BD). Uso: `node scripts/test-kb.js`

const { buscarKB, puntuarEntrada, tokens, esPreguntaUtil, tagsDePregunta } = require('../src/lib/kb');

const KB = [
  { id: '1', estado: 'aprobada', pregunta: '¿Cuál es el horario de atención?', tags: ['horario', 'abren', 'abierto', 'hora'], respuesta: 'Horario X.' },
  { id: '2', estado: 'aprobada', pregunta: '¿Hacen entregas a domicilio?', tags: ['domicilio', 'delivery', 'envio', 'entrega'], respuesta: 'Entrega X.' },
  { id: '3', estado: 'aprobada', pregunta: '¿Qué métodos de pago aceptan?', tags: ['pago', 'pagar', 'efectivo', 'tarjeta', 'qr'], respuesta: 'Pago X.' },
  { id: '4', estado: 'aprobada', pregunta: '¿Cómo acumulo o canjeo puntos de fidelización?', tags: ['puntos', 'fidelizacion', 'canjear'], respuesta: 'Puntos X.' },
  { id: '5', estado: 'propuesta', pregunta: '¿Atienden los domingos?', tags: ['domingo', 'horario'], respuesta: '' },
];

// [descripcion, texto, idEsperadoONull]
const CASOS = [
  ['saludo horario', 'hola, a que hora abren?', '1'],
  ['hora variante', 'cual es su hora de atencion', '1'],
  ['envio', 'hacen envios a domicilio?', '2'],
  ['delivery', 'tienen delivery?', '2'],
  ['pago tarjeta', 'puedo pagar con tarjeta?', '3'],
  ['pago efectivo', 'aceptan efectivo', '3'],
  ['puntos', 'como junto puntos con mis compras?', '4'],
  ['puntos canje', 'quiero canjear fidelizacion', '4'],
  ['producto (no KB)', 'cuanto cuesta el paracetamol', null],
  ['vacio', '', null],
  ['ruido', 'hola que tal como estan', null],
  ['propuesta no cuenta', 'atienden los domingos?', null],
];

let ok = 0;
let fail = 0;

for (const [desc, texto, esperado] of CASOS) {
  const res = buscarKB(texto, KB);
  const primero = res[0]?.id || null;
  const bien = primero === esperado;
  if (bien) ok += 1;
  else {
    fail += 1;
    console.log(`FALLO: ${desc} -> ${JSON.stringify({ texto, primero, esperado, res: res.map((r) => [r.id, r._score, Number(r._cobertura.toFixed(2))]) })}`);
  }
}

// El filtro debe excluir propuestas aunque puntúen alto.
const propuestaAlta = puntuarEntrada('atienden los domingos?', KB[4]);
if (propuestaAlta.score > 0 && buscarKB('atienden los domingos?', KB).length === 0) ok += 1;
else {
  fail += 1;
  console.log('FALLO: una propuesta puntúa pero no debe devolverse.');
}

// tokens descarta palabras vacías y cortas.
const tk = tokens('de la y a qué hora abren el domingo');
if (!tk.includes('de') && !tk.includes('la') && tk.includes('hora') && tk.includes('abren')) ok += 1;
else {
  fail += 1;
  console.log(`FALLO tokens: ${JSON.stringify(tk)}`);
}

// #V55 · esPreguntaUtil: filtra candidatas útiles para el bucle de aprendizaje.
const PREG_CASOS = [
  ['envio pregunta', '¿Hacen envíos a domicilio?', true],
  ['pago pregunta', 'puedo pagar con tarjeta?', true],
  ['horario pregunta', 'a que hora abren', true],
  ['saludo corto', 'hola', false],
  ['saludo puro', 'hola buenas', false],
  ['ruido', 'hola que tal como estan', false],
  ['sin verbo pregunta', 'necesito paracetamol', false],
  ['demasiado largo', 'a'.repeat(210), false],
];
for (const [desc, texto, esperado] of PREG_CASOS) {
  const r = esPreguntaUtil(texto);
  if (r === esperado) ok += 1;
  else { fail += 1; console.log(`FALLO esPreguntaUtil ${desc}: ${r} != ${esperado}`); }
}

// tagsDePregunta extrae términos distintivos (sin stopwords ni relleno).
const tags = tagsDePregunta('¿Hacen envíos a domicilio?');
if (tags.includes('domicilio') && !tags.includes('hacen')) ok += 1;
else { fail += 1; console.log(`FALLO tagsDePregunta: ${JSON.stringify(tags)}`); }

console.log(`\nKB matcher: ${ok} pasan, ${fail} fallan (${ok + fail} casos)`);
process.exit(fail > 0 ? 1 : 0);
