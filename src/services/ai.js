'use strict';

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('../config');
const { getSupabase } = require('../lib/supabase');
const { ejecutarHerramienta } = require('./tools');
const { getClienteConEstado } = require('./customers');
const { getBotConfig } = require('./bot');

const TOOLS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'lib', 'openai-tools.json'), 'utf8')
);

const DEFAULT_SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'prompts', 'system.txt'),
  'utf8'
);

function getOpenAI() {
  if (!config.openai.apiKey) {
    const err = new Error('OPENAI_API_KEY no configurada.');
    err.statusCode = 503;
    throw err;
  }
  return new OpenAI({ apiKey: config.openai.apiKey });
}

function buildAdditionalInstructions(cliente, telefono, toolContext) {
  const nombre = cliente?.nombre || '(desconocido; recábalo con amabilidad si aún no lo has pedido)';
  const edad = cliente?.edad != null ? String(cliente.edad) : '(desconocida)';
  const habitos = cliente?.habitos_consumo || '(sin hábitos registrados)';
  const ctx = Object.values(toolContext || {}).slice(0, 12)
    .map((p) => `${p.nombre} id_producto=${p.id}`)
    .join('\n');
  const lines = [
    `TELEFONO_E164: ${telefono}`,
    `NOMBRE: ${nombre}`,
    `EDAD: ${edad}`,
    `HABITOS_CONSUMO: ${habitos}`,
    'Usa TELEFONO_E164 en todas las herramientas que pidan telefono_cliente.',
  ];
  if (ctx) {
    lines.push(
      '',
      'Productos ya consultados en esta conversación (usa estos id_producto en agregar_al_carrito si el cliente se refiere a ellos):',
      ctx
    );
  }
  return lines.join('\n');
}

async function getHistorial(telefono, limite = 30) {
  const { data, error } = await getSupabase()
    .from('mensajes')
    .select('rol, contenido, created_at')
    .eq('telefono_cliente', telefono)
    .order('created_at', { ascending: true })
    .limit(limite);
  if (error) throw error;
  const input = [];
  for (const m of data || []) {
    const role = m.rol === 'usuario' ? 'user' : m.rol === 'asistente' ? 'assistant' : null;
    if (!role || !m.contenido) continue;
    input.push({ role, content: m.contenido });
  }
  return input;
}

function extractAssistantText(response) {
  if (!response?.output) return '';
  const parts = [];
  for (const item of response.output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === 'output_text') parts.push(c.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function functionCalls(response) {
  return (response?.output || []).filter((it) => it.type === 'function_call');
}

async function responderConAsistente({ telefono, texto }) {
  const { cliente, estado } = await getClienteConEstado(telefono);
  const botConfig = await getBotConfig();
  const openai = getOpenAI();

  const toolContext = estado?.last_tool_context || {};
  const historial = await getHistorial(telefono);
  historial.push({ role: 'user', content: texto });

  const instructions = [
    botConfig?.system_prompt || DEFAULT_SYSTEM_PROMPT,
    '',
    '---',
    buildAdditionalInstructions(cliente, telefono, toolContext),
  ].join('\n');

  let response = await openai.responses.create({
    model: config.openai.model,
    instructions,
    input: historial,
    tools: TOOLS,
  });
  let prevResponseId = response.id;

  let iterations = 0;
  while (functionCalls(response).length > 0) {
    if (++iterations > 10) {
      throw new Error('Demasiadas llamadas a herramientas.');
    }
    const calls = functionCalls(response);
    const toolOutputs = [];
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await ejecutarHerramienta(call.name, args, { telefono });
      toolOutputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
      if (call.name === 'consultar_precio_y_stock' && Array.isArray(result?.productos)) {
        for (const p of result.productos) {
          toolContext[p.id] = { id: p.id, nombre: p.nombre };
        }
      }
    }
    response = await openai.responses.create({
      model: config.openai.model,
      instructions,
      previous_response_id: prevResponseId,
      input: toolOutputs,
      tools: TOOLS,
    });
    prevResponseId = response.id;
  }

  const supabase = getSupabase();
  // Fusionar: re-leer el contexto actual (pudo ser actualizado por las tools,
  // p. ej. recordarRecomendacion con el contador de rotación) y solo añadir los
  // id->nombre vistos en este turno, SIN pisar el contador (veces/ultima).
  const { data: ctxActual } = await supabase
    .from('estado_chat')
    .select('last_tool_context')
    .eq('telefono_cliente', telefono)
    .maybeSingle();
  const ultimoCtx = ctxActual?.last_tool_context || {};
  for (const [id, v] of Object.entries(toolContext)) {
    if (!ultimoCtx[id]) ultimoCtx[id] = { id: v.id, nombre: v.nombre };
  }

  const { error: estError } = await supabase
    .from('estado_chat')
    .update({
      ultima_actualizacion: new Date().toISOString(),
      last_tool_context: ultimoCtx,
    })
    .eq('telefono_cliente', telefono);

  return extractAssistantText(response) || 'Un momento, te atiendo enseguida.';
}

module.exports = { getOpenAI, responderConAsistente, DEFAULT_SYSTEM_PROMPT };