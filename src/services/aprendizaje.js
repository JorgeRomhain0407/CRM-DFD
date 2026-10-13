'use strict';

// #V55 · Bucle de aprendizaje (PROPOSE-ONLY). Mina las conversaciones donde el
// bot no supo responder (turnos `general`/fallback y handoffs por
// `fallback_repetido`), toma el mensaje del cliente que provocó cada fallo y lo
// propone como entrada de KB (`estado='propuesta'`). NUNCA se activa solo: un
// humano lo aprueba en la vista "Conocimiento". El texto se lee de `mensajes`
// (la tabla de eventos es anti-PII y no guarda contenido).

const config = require('../config');
const { getSupabase } = require('../lib/supabase');
const { esPreguntaUtil, tagsDePregunta } = require('../lib/kb');
const { normalizar } = require('../lib/intents');
const { getOpenAI } = require('./ai');
const { crearPropuesta, listarKB } = require('./kb');

// Clave de agrupación: minúsculas, sin acentos ni puntuación, espacios simples.
function clavePregunta(texto) {
  return normalizar(texto).replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Turnos problemáticos: respuestas del bot con intent `general` que NO usaron
// herramientas ni derivaron a humano (fallback/charla sin resolver), y handoffs
// por fallback_repetido. Devuelve [{ telefono, t }] con t en ms.
async function eventosProblematicos(desde) {
  const sb = getSupabase();
  const eventos = [];
  const { data: fallos } = await sb
    .from('cliente_eventos')
    .select('telefono_cliente, created_at, payload')
    .eq('tipo', 'bot_respuesta')
    .gte('created_at', desde)
    .eq('payload->>intent', 'general')
    .order('created_at', { ascending: false })
    .limit(2000);
  for (const e of fallos || []) {
    const usoTools = Array.isArray(e.payload?.tools) && e.payload.tools.length > 0;
    const derivo = Boolean(e.payload?.handoff);
    if (usoTools || derivo) continue;
    eventos.push({ telefono: e.telefono_cliente, t: Date.parse(e.created_at) });
  }
  const { data: handoffs } = await sb
    .from('cliente_eventos')
    .select('telefono_cliente, created_at')
    .eq('tipo', 'handoff')
    .gte('created_at', desde)
    .eq('payload->>causa', 'fallback_repetido')
    .order('created_at', { ascending: false })
    .limit(2000);
  for (const e of handoffs || []) eventos.push({ telefono: e.telefono_cliente, t: Date.parse(e.created_at) });
  return eventos;
}

async function redactarBorrador(pregunta) {
  try {
    const openai = getOpenAI();
    const instructions = [
      'Eres el asistente de una farmacia. Redacta un BORRADOR de respuesta para WhatsApp,',
      'breve (1-3 frases), cálido y claro, en español neutro.',
      'REGLAS ESTRICTAS:',
      '- NO inventes datos concretos de la farmacia (dirección, horario, teléfono, precio, métodos de pago):',
      '  donde falte un dato real, escribe un marcador como [COMPLETAR: horario real].',
      '- NUNCA des dosis, posología, diagnósticos ni consejos clínicos: si la pregunta es médica,',
      '  el borrador debe ofrecer pasar con un profesional de la farmacia.',
      '- Devuelve SOLO el texto de la respuesta, sin encabezados ni comillas.',
    ].join('\n');
    const response = await openai.responses.create({
      model: config.openai.model,
      instructions,
      temperature: 0.3,
      input: [{ role: 'user', content: `Pregunta del cliente: ${pregunta}` }],
    });
    let texto = '';
    for (const item of response?.output || []) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) if (c.type === 'output_text') texto += c.text;
      }
    }
    return texto.trim().slice(0, 800);
  } catch (err) {
    console.warn('[aprendizaje] borrador LLM no generado:', String(err.message || '').slice(0, 120));
    return '';
  }
}

// Genera propuestas de KB a partir de preguntas frecuentes no resueltas.
// Devuelve { candidatas, generadas, omitidas, phones }.
async function generarPropuestas({ dias = 30, minRepeticiones = 2, maxPropuestas = 10 } = {}) {
  const sb = getSupabase();
  const desde = new Date(Date.now() - Math.max(1, dias) * 24 * 60 * 60 * 1000).toISOString();

  const eventos = await eventosProblematicos(desde);
  if (!eventos.length) return { candidatas: 0, generadas: 0, omitidas: 0, phones: 0 };
  const phones = [...new Set(eventos.map((e) => e.telefono))];

  const { data: mensajes, error } = await sb
    .from('mensajes')
    .select('telefono_cliente, contenido, created_at')
    .eq('rol', 'usuario')
    .in('telefono_cliente', phones.slice(0, 300))
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error) throw error;

  const porTel = new Map();
  for (const m of mensajes || []) {
    const t = Date.parse(m.created_at);
    if (!porTel.has(m.telefono_cliente)) porTel.set(m.telefono_cliente, []);
    porTel.get(m.telefono_cliente).push({ contenido: m.contenido, t });
  }

  // Para cada fallo, el último mensaje del cliente ANTERIOR a ese turno.
  const grupos = new Map();
  for (const ev of eventos) {
    const arr = porTel.get(ev.telefono);
    if (!arr || !arr.length) continue;
    let elegido = null;
    for (const m of arr) { if (m.t <= ev.t) elegido = m; else break; }
    if (!elegido || !esPreguntaUtil(elegido.contenido)) continue;
    const clave = clavePregunta(elegido.contenido);
    if (!clave) continue;
    const g = grupos.get(clave) || { clave, ejemplos: [], n: 0 };
    g.n += 1;
    if (g.ejemplos.length < 5) g.ejemplos.push(String(elegido.contenido).trim());
    grupos.set(clave, g);
  }

  const candidatos = [...grupos.values()]
    .filter((g) => g.n >= minRepeticiones)
    .sort((a, b) => b.n - a.n);

  // Omitir las que ya existen en la KB (cualquier estado), por clave normalizada.
  const existentes = new Set((await listarKB()).map((e) => clavePregunta(e.pregunta)));
  const nuevos = candidatos.filter((g) => !existentes.has(g.clave)).slice(0, maxPropuestas);

  let generadas = 0;
  let omitidas = candidatos.length - nuevos.length;
  for (const g of nuevos) {
    const pregunta = g.ejemplos.slice().sort((a, b) => a.length - b.length)[0];
    const respuesta = await redactarBorrador(pregunta);
    const nota =
      `Propuesta automática a partir de ${g.n} conversación(es) con turnos sin resolver` +
      (respuesta ? '; borrador generado por IA — revisa y edita antes de aprobar.' : '; sin borrador (redacta la respuesta a mano).');
    const fila = await crearPropuesta({ pregunta, respuesta, tags: tagsDePregunta(pregunta), nota });
    if (fila) generadas += 1;
    else omitidas += 1;
  }

  return { candidatas: candidatos.length, generadas, omitidas, phones: phones.length };
}

module.exports = { generarPropuestas };
