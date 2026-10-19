'use strict';

// #V76 · Benchmark END-TO-END del turno del bot (latencia real: BD + OpenAI).
// A diferencia de scripts/test-bot-mensajes.js (que stubea todo), este ejecuta
// `responderConAsistente` de verdad contra Supabase y OpenAI.
//
// Uso:
//   node scripts/bench-bot-latencia.js [telefono] [turnos_por_intent]
//     - telefono:        E.164 reservado de pruebas (default +34900000077).
//     - turnos_por_intent: repeticiones de cada guion (default 4 => 32 turnos).
//
// IMPORTANTE: usa un teléfono DEDICADO por corrida (p. ej. +34900000071,
// +34900000072, ...) para que cada configuración arranque con el mismo estado
// (sin historial) y las comparaciones sean justas. Escribe filas de prueba en
// Supabase (mensajes, cliente_eventos, estado_chat, clientes) de ese teléfono.
//
// Meta #V76: p50 < 2500 ms y p95 < 3500 ms.

require('dotenv').config();
const { responderConAsistente } = require('../src/services/ai');
const { grabarMensaje } = require('../src/services/bot');
const { ensureCliente } = require('../src/services/customers');
const { getSupabase } = require('../src/lib/supabase');

const TEL = process.argv[2] || '+34900000077';
const POR_INTENT = Math.max(1, Number(process.argv[3] || 4));

// Productos reales para que los guiones de buscar/carrito sean verosímiles.
let NOMBRES = ['paracetamol 500 mg', 'ibuprofeno 400 mg'];

const GUIONES = () => [
  { intent: 'saludo', texto: 'hola' },
  { intent: 'saludo', texto: 'buenas tardes' },
  { intent: 'buscar', texto: `¿cuánto cuesta el ${NOMBRES[0]}?` },
  { intent: 'buscar', texto: `¿tienen ${NOMBRES[1]}?` },
  { intent: 'carrito', texto: `agrega 2 ${NOMBRES[0]} al carrito` },
  { intent: 'carrito', texto: '¿cuál es el resumen de mi carrito?' },
  { intent: 'general', texto: '¿a qué hora abren?' },
  { intent: 'general', texto: 'gracias' },
];

function percentil(ordenados, q) {
  if (!ordenados.length) return 0;
  const i = Math.min(ordenados.length - 1, Math.ceil(q * ordenados.length) - 1);
  return ordenados[i];
}

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const media = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { n: s.length, media, p50: percentil(s, 0.5), p95: percentil(s, 0.95), max: s[s.length - 1] || 0 };
}

async function prepararTelefono() {
  await ensureCliente(TEL).catch(() => {});
  await getSupabase()
    .from('estado_chat')
    .upsert({ telefono_cliente: TEL, estado: 'bot_activo' }, { onConflict: 'telefono_cliente' });
}

async function cargarNombresReales() {
  const { data } = await getSupabase()
    .from('productos')
    .select('nombre')
    .eq('activo', true)
    .order('nombre')
    .limit(40);
  const nombres = (data || []).map((p) => p.nombre).filter(Boolean);
  if (nombres.length >= 2) {
    NOMBRES = [nombres[0], nombres[Math.min(nombres.length - 1, 20)]];
  }
}

async function main() {
  if (!TEL.startsWith('+34900000')) {
    console.warn(`[bench] AVISO: ${TEL} no está en el rango de pruebas +349000000XX.`);
  }
  await cargarNombresReales();
  await prepararTelefono();

  const guiones = GUIONES();
  const turnos = [];
  for (let r = 0; r < POR_INTENT; r++) for (const g of guiones) turnos.push(g);

  console.log(`bench #V76 · ${TEL} · ${turnos.length} turnos · modelo=${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`);
  console.log(`productos usados: ${NOMBRES.join(' | ')}\n`);

  const porIntent = {};
  const todos = [];
  for (let i = 0; i < turnos.length; i++) {
    const { intent, texto } = turnos[i];
    await grabarMensaje(TEL, 'usuario', texto, 'test').catch(() => {});
    const t0 = performance.now();
    let out = '';
    let ok = true;
    try {
      out = await responderConAsistente({ telefono: TEL, texto });
    } catch (err) {
      ok = false;
      out = `ERROR: ${err.message}`;
    }
    const ms = performance.now() - t0;
    todos.push(ms);
    (porIntent[intent] ||= []).push(ms);
    const marca = ok ? '' : '  <-- FALLO';
    console.log(`  [${String(i + 1).padStart(2)}] ${intent.padEnd(9)} ${ms.toFixed(0).padStart(5)} ms${marca}  «${String(out).slice(0, 50).replace(/\n/g, ' ')}»`);
  }

  console.log('\n--- por intent ---');
  for (const [intent, ms] of Object.entries(porIntent)) {
    const s = stats(ms);
    console.log(`  ${intent.padEnd(9)} n=${s.n}  p50=${s.p50.toFixed(0)}  p95=${s.p95.toFixed(0)}  max=${s.max.toFixed(0)}`);
  }

  const s = stats(todos);
  console.log('\n--- TOTAL ---');
  console.log(`  n=${s.n}  media=${s.media.toFixed(0)}  p50=${s.p50.toFixed(0)}  p95=${s.p95.toFixed(0)}  max=${s.max.toFixed(0)}`);
  const gate = s.p50 < 2500 && s.p95 < 3500;
  console.log(`  gate #V76 (p50<2500 && p95<3500): ${gate ? 'PASA' : 'NO PASA'}`);
  process.exitCode = gate ? 0 : 1;
}

main().catch((err) => {
  console.error('ERROR bench:', err.message);
  process.exit(1);
});
