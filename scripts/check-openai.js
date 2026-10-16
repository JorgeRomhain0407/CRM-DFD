'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// #V63 (Fase 2) · Modo `--tools`: además del ping básico, envía las 7 tools
// reales en una llamada a la Responses API. Es lo único que cazaría un 400
// `invalid_function_parameters` ANTES de desplegar (gate manual de release D05;
// no se ejecuta en CI porque consume tokens y necesita OPENAI_API_KEY).
const HERRAMIENTAS = path.join(__dirname, '..', 'src', 'lib', 'openai-tools.json');

function cargarTools() {
  const bruto = fs.readFileSync(HERRAMIENTAS, 'utf8');
  const tools = JSON.parse(bruto);
  if (!Array.isArray(tools)) throw new Error('openai-tools.json no es un array.');
  return tools;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Define OPENAI_API_KEY en .env');
    process.exit(1);
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const conTools = process.argv.includes('--tools');
  const openai = new OpenAI({ apiKey });
  const res = await openai.responses.create({
    model,
    instructions: 'Responde únicamente con la palabra OK.',
    input: 'Hola',
    ...(conTools ? { tools: cargarTools(), tool_choice: 'none' } : {}),
  });
  if (conTools) {
    console.log(`Tools enviadas: ${cargarTools().length} — la Responses API las aceptó sin 400.`);
  }
  const text =
    (res.output || [])
      .filter((it) => it.type === 'message')
      .map((m) => (m.content || []).map((c) => (c.type === 'output_text' ? c.text : '')).join(''))
      .join(' ')
      .trim();
  console.log(`Responses API OK usando modelo "${model}".`);
  console.log(`Respuesta de prueba: ${text || '(sin texto)'}`);
  console.log('No se necesita OPENAI_ASSISTANT_ID: la Responses API no crea asistentes.');
}

main().catch((err) => {
  console.error(`FALLO: ${err.status || ''} ${err.message || err}`);
  process.exit(1);
});