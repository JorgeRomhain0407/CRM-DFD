'use strict';

const OpenAI = require('openai');
const config = require('../config');
const { getBotConfig } = require('./bot');
const { getClienteConEstado } = require('./customers');
const { ejecutarHerramienta } = require('./tools');

function getOpenAI() {
  if (!config.openai.apiKey) {
    const err = new Error('OPENAI_API_KEY no configurada.');
    err.statusCode = 503;
    throw err;
  }
  return new OpenAI({ apiKey: config.openai.apiKey });
}

function buildAdditionalInstructions(cliente, telefono) {
  const nombre = cliente?.nombre || '(desconocido; recábalo con amabilidad si aún no lo has pedido)';
  const edad = cliente?.edad != null ? String(cliente.edad) : '(desconocida)';
  const habitos = cliente?.habitos_consumo || '(sin hábitos registrados)';
  return [
    `TELEFONO_E164: ${telefono}`,
    `NOMBRE: ${nombre}`,
    `EDAD: ${edad}`,
    `HABITOS_CONSUMO: ${habitos}`,
    'Usa TELEFONO_E164 en todas las herramientas que pidan telefono_cliente.',
  ].join('\n');
}

function extractAssistantText(message) {
  if (!message?.content) return '';
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text?.value || '')
    .join('\n')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun(openai, threadId, runId) {
  const started = Date.now();
  const timeoutMs = 90_000;
  let run = await openai.beta.threads.runs.retrieve(threadId, runId);
  while (['queued', 'in_progress', 'cancelling'].includes(run.status)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timeout esperando al asistente.');
    }
    await sleep(800);
    run = await openai.beta.threads.runs.retrieve(threadId, runId);
  }
  return run;
}

async function handleToolLoop(openai, threadId, run, telefono) {
  let current = run;
  while (current.status === 'requires_action') {
    const calls = current.required_action?.submit_tool_outputs?.tool_calls || [];
    const tool_outputs = [];
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await ejecutarHerramienta(call.function.name, args, { telefono });
      tool_outputs.push({ tool_call_id: call.id, output: JSON.stringify(result) });
    }
    current = await openai.beta.threads.runs.submitToolOutputs(threadId, current.id, {
      tool_outputs,
    });
    current = await waitForRun(openai, threadId, current.id);
  }
  return current;
}

async function testearAsistente({ telefono, texto }) {
  if (!config.openai.assistantId) {
    const err = new Error('Falta OPENAI_ASSISTANT_ID. Ejecuta npm run create-assistant.');
    err.statusCode = 503;
    throw err;
  }

  const openai = getOpenAI();
  const { cliente, estado } = await getClienteConEstado(telefono);
  const botConfig = await getBotConfig();

  const threadId = estado?.openai_thread_id || (await openai.beta.threads.create()).id;

  await openai.beta.threads.messages.create(threadId, { role: 'user', content: texto });

  const instructions = botConfig?.system_prompt
    ? `${botConfig.system_prompt}\n\n---\n${buildAdditionalInstructions(cliente, telefono)}`
    : buildAdditionalInstructions(cliente, telefono);

  let run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: config.openai.assistantId,
    additional_instructions: instructions,
  });

  run = await waitForRun(openai, threadId, run.id);
  run = await handleToolLoop(openai, threadId, run, telefono);

  if (run.status !== 'completed') {
    throw new Error(`Run OpenAI en estado ${run.status}: ${run.last_error?.message || 'sin detalle'}`);
  }

  const list = await openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 8 });
  const last = list.data.find((m) => m.role === 'assistant');
  return extractAssistantText(last) || 'Un momento, te atiendo enseguida.';
}

module.exports = { testearAsistente, getOpenAI };
