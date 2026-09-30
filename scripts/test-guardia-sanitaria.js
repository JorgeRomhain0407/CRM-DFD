'use strict';

// #V46 · Batería del guardia sanitario — ejecutable sin servidor ni BD.
// Uso por D03-QA: `node scripts/test-guardia-sanitaria.js`
// (La validación end-to-end del handoff real requiere servidor + Supabase.)

const { detectarGuardia } = require('../src/lib/guardia-sanitaria');

const CASOS = [
  // --- Deben ACTIVAR el guardia (criterio de salida #V46) ---
  ['cuántos mg de paracetamol al día debo tomar', 'posologia', true],
  ['tengo dolor de pecho desde esta mañana', 'urgencia', true],
  ['foto de mi receta del doctor', 'clinico', true],
  ['estoy embarazada, ¿puedo tomar ibuprofeno?', 'clinico', true],
  ['me recetaron antibiótico, ¿cuántas pastillas?', 'posologia', true],
  ['me falta el aire', 'urgencia', true],
  ['puedo tomar este ibuprofeno con mi colchín', 'interaccion', true],
  ['cuántas gotas debo dar', 'posologia', true],
  ['dosis para el niño', 'posologia', true],
  ['efectos secundarios de este jarabe', 'clinico', true],
  ['posología del amoxicilina', 'posologia', true],
  ['convulsionó el bebé', 'urgencia', true],

  // --- NO deben activarse (ventas/negocio normal, evitar falsos positivos) ---
  ['tenéis paracetamol de 1 gramo', null, false],
  ['¿cuánto vale el gelocatil?', null, false],
  ['quiero el shampoo más barato', null, false],
  ['¿hay stock de vitamina C?', null, false],
  ['¿sirve para el dolor de muela?', null, false],
  ['¿cuánto cuesta?', null, false],
  ['tengo 30 años y busco crema', null, false],
  ['agrega 2 al carrito', null, false],
  ['¿cómo va mi pedido?', null, false],
];

let ok = 0;
let fail = 0;
for (const [texto, catEsperada, debeActivar] of CASOS) {
  const g = detectarGuardia(texto);
  const activa = !!g;
  const catReal = g ? g.categoria : null;
  const bien = activa === debeActivar && (!g || catReal === catEsperada);
  if (bien) {
    ok += 1;
  } else {
    fail += 1;
    console.log(`FALLO: ${JSON.stringify({ texto, debeActivar, catEsperada, catReal, activa })}`);
  }
}

console.log(`\nGuardia sanitaria: ${ok} pasan, ${fail} fallan (${CASOS.length} casos)`);
process.exit(fail > 0 ? 1 : 0);
