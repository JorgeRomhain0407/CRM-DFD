'use strict';

// #V52 · Batería del router de intents — ejecutable sin servidor ni BD.
// Uso: `node scripts/test-intents.js`

const { clasificar, filtrarTools } = require('../src/lib/intents');

const TOOLS = [
  { name: 'consultar_precio_y_stock' },
  { name: 'agregar_al_carrito' },
  { name: 'ver_resumen_carrito' },
  { name: 'actualizar_estado_pedido' },
  { name: 'consultar_puntos' },
  { name: 'solicitar_asistencia_humana' },
];
const TODAS = TOOLS.map((t) => t.name);

const CASOS = [
  // [descripcion, texto, opts, intentEsperado, confianzaEsperada]
  ['saludo simple', 'hola', {}, 'saludo', 'media'],
  ['saludo + busqueda', 'buenas, necesito paracetamol', {}, 'buscar', 'media'],
  ['precio', '¿cuánto cuesta el gelocatil?', {}, 'buscar', 'alta'],
  ['precio barato', 'quiero el shampoo más barato', {}, 'buscar', 'alta'],
  ['stock', '¿hay stock de vitamina C?', {}, 'buscar', 'alta'],
  ['agregar', 'agrega 2 al carrito', {}, 'carrito', 'alta'],
  ['estado pedido', '¿cómo va mi pedido?', {}, 'carrito', 'alta'],
  ['reservar', 'reserva el gelocatil', {}, 'carrito', 'alta'],
  ['puntos', '¿cuántos puntos tengo?', {}, 'puntos', 'alta'],
  ['saldo', 'mi saldo de beneficios', {}, 'puntos', 'alta'],
  ['handoff explicito', 'quiero hablar con un farmacéutico', {}, 'handoff', 'alta'],
  ['handoff sintoma', 'tengo una reacción adversa', {}, 'handoff', 'alta'],
  ['ambiguo', 'mmm', {}, 'general', 'baja'],
  ['si con productos', 'si', { toolContext: { abc: { id: 'abc', nombre: 'x' } } }, 'carrito', 'alta'],
  ['numero con productos', '2', { toolContext: { abc: { id: 'abc' } } }, 'carrito', 'alta'],
  ['ordinal con hilo', 'el primero', { contextoBot: { ultimos_intents: ['buscar'] } }, 'carrito', 'alta'],
  ['si sin contexto', 'si', {}, 'general', 'baja'],
];

const FILTROS = [
  ['buscar', 'buscar', 'media', ['consultar_precio_y_stock', 'agregar_al_carrito', 'solicitar_asistencia_humana']],
  ['carrito', 'carrito', 'media', ['consultar_precio_y_stock', 'agregar_al_carrito', 'ver_resumen_carrito', 'actualizar_estado_pedido', 'solicitar_asistencia_humana']],
  ['puntos', 'puntos', 'alta', ['consultar_precio_y_stock', 'consultar_puntos', 'solicitar_asistencia_humana']],
  ['confianza baja = todas', 'buscar', 'baja', TODAS],
  ['saludo = todas', 'saludo', 'media', TODAS],
];

let ok = 0;
let fail = 0;

for (const [desc, texto, opts, intentEsp, confEsp] of CASOS) {
  const r = clasificar(texto, opts);
  const bien = r.intent === intentEsp && r.confianza === confEsp;
  if (bien) {
    ok += 1;
  } else {
    fail += 1;
    console.log(`FALLO: ${desc} -> ${JSON.stringify({ texto, intent: r.intent, confianza: r.confianza, esperado: [intentEsp, confEsp] })}`);
  }
}

for (const [desc, intent, conf, esperado] of FILTROS) {
  const out = filtrarTools(TOOLS, intent, conf).map((t) => t.name);
  const bien = JSON.stringify(out) === JSON.stringify(esperado);
  if (bien) {
    ok += 1;
  } else {
    fail += 1;
    console.log(`FALLO filtro: ${desc} -> ${JSON.stringify({ out, esperado })}`);
  }
}

console.log(`\nIntents: ${ok} pasan, ${fail} fallan (${CASOS.length + FILTROS.length} casos)`);
process.exit(fail > 0 ? 1 : 0);
