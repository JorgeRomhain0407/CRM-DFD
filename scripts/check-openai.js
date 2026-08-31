'use strict';

require('dotenv').config();
const OpenAI = require('openai');

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Define OPENAI_API_KEY en .env');
    process.exit(1);
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const openai = new OpenAI({ apiKey });
  const res = await openai.responses.create({
    model,
    instructions: 'Responde únicamente con la palabra OK.',
    input: 'Hola',
  });
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