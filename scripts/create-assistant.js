'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Define OPENAI_API_KEY en .env');
  process.exit(1);
}

const tools = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'openai-tools.json'), 'utf8')
);
const instructions = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'prompts', 'system.txt'),
  'utf8'
);

async function main() {
  const openai = new OpenAI({ apiKey });
  const assistant = await openai.beta.assistants.create({
    name: 'FarmaBot CRM DFD',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    instructions,
    tools,
  });
  console.log('Asistente creado.');
  console.log(`OPENAI_ASSISTANT_ID=${assistant.id}`);
  console.log('Copia ese valor a tu archivo .env');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
