'use strict';

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('../config');
const { getSupabase } = require('../lib/supabase');
const { registrarTool, registrarProductoVisto } = require('./cliente-contexto');
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

// Ventana real de contexto: los ÚLTIMOS N mensajes (no los primeros).
// Orden desc + limite + re-inversión => cronológico y pegado a la cola.
async function getHistorial(telefono, limite = 30) {
  const { data, error } = await getSupabase()
    .from('mensajes')
    .select('rol, contenido, created_at')
    .eq('telefono_cliente', telefono)
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw error;
  const input = [];
  for (const m of (data || []).reverse()) {
    const content = m.contenido;
    if (!content) continue;
    if (m.rol === 'usuario') {
      input.push({ role: 'user', content });
    } else if (m.rol === 'asistente') {
      input.push({ role: 'assistant', content });
    } else if (m.rol === 'operador') {
      // Mensaje escrito por el operador humano desde el panel: contexto
      // necesario para que el bot no lo ignore al retomar la conversación.
      input.push({
        role: 'user',
        content: `(Enviado al cliente por un operador humano, no por el bot): ${content}`,
      });
    }
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

// #V45 · Acuse server-side al pasar la conversación a un humano.
const ACUSE_HANDOFF =
  'Perfecto ✅ Ya dejé avisado al equipo de la farmacia: una persona te escribe por este mismo chat en unos minutos. 😊';

async function responderConAsistente({ telefono, texto }) {
  const { cliente, estado } = await getClienteConEstado(telefono);
  const botConfig = await getBotConfig();
  const openai = getOpenAI();

  const toolContext = estado?.last_tool_context || {};
  // El mensaje del usuario llega YA grabado (webhook.js / routes/bot.js lo
  // insertan antes de llamar aquí): getHistorial lo incluye sin necesidad
  // de un push manual que lo duplicaría.
  const historial = await getHistorial(telefono);

  const instructions = [
    botConfig?.system_prompt || DEFAULT_SYSTEM_PROMPT,
    '',
    '---',
    buildAdditionalInstructions(cliente, telefono, toolContext),
  ].join('\n');

  // bot_config.temperatura (schema CHECK 0-2) ahora se aplica de verdad.
  const temperatura = Number(botConfig?.temperatura);
  const opcionesModelo = { model: config.openai.model, instructions, tools: TOOLS };
  if (Number.isFinite(temperatura)) opcionesModelo.temperature = temperatura;

  let response = await openai.responses.create({
    ...opcionesModelo,
    input: historial,
  });
  let prevResponseId = response.id;

  let iterations = 0;
  while (functionCalls(response).length > 0) {
    if (++iterations > 10) {
      throw new Error('Demasiadas llamadas a herramientas.');
    }
    const calls = functionCalls(response);
    const toolOutputs = [];
    let handoffEfectivo = false;
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await ejecutarHerramienta(call.name, args, { telefono });
      // #V30/#V47 · evento tool_call, fire-and-forget.
      registrarTool(telefono, call.name, Boolean(result?.ok));
      toolOutputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
      if (call.name === 'consultar_precio_y_stock' && Array.isArray(result?.productos)) {
        for (const p of result.productos) {
          toolContext[p.id] = { id: p.id, nombre: p.nombre };
          // #V30/#V47 · evento producto_visto (solo id, anti-PII).
          registrarProductoVisto(telefono, p.id).catch(() => {});
        }
      }
      // #V45 · Handoff efectivo: la conversación termina aquí. El cliente
      // recibe un acuse determinista del servidor (no depende de la redacción
      // del modelo) y no se hace ninguna llamada adicional a OpenAI.
      if (call.name === 'solicitar_asistencia_humana' && result?.ok) {
        handoffEfectivo = true;
      }
    }
    if (handoffEfectivo) {
      return ACUSE_HANDOFF;
    }
    response = await openai.responses.create({
      ...opcionesModelo,
      previous_response_id: prevResponseId,
      input: toolOutputs,
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