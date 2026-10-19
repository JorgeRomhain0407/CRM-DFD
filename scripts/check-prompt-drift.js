'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function leerPromptBD() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bot_config?id=eq.1&select=system_prompt,updated_at`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return { error: 'bot_config.id=1 no existe' };
  return { data: rows[0] };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
    return 1;
  }

  const arg = process.argv[2];
  const filePath = arg
    ? path.resolve(arg)
    : path.join(process.cwd(), 'src', 'prompts', 'system.txt');
  if (!fs.existsSync(filePath)) {
    console.error(`No existe ${filePath}`);
    return 1;
  }
  const filePrompt = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

  const { data, error } = await leerPromptBD();
  if (error) {
    console.error('ERROR al leer bot_config:', error);
    return 1;
  }
  const dbPrompt = String(data.system_prompt || '').replace(/\r\n/g, '\n');

  if (dbPrompt === filePrompt) {
    console.log('OK: prompt en BD coincide con el archivo');
    console.log(`- archivo: ${filePath}`);
    console.log(`- BD updated_at: ${data.updated_at || 'N/A'}`);
    console.log(`- Longitudes: BD=${dbPrompt.length} file=${filePrompt.length}`);
    return 0;
  }

  const minLen = Math.min(dbPrompt.length, filePrompt.length);
  let firstDiff = -1;
  for (let i = 0; i < minLen; i++) {
    if (dbPrompt.charCodeAt(i) !== filePrompt.charCodeAt(i)) {
      firstDiff = i;
      break;
    }
  }

  console.error('DRIFT detectado entre BD y el archivo de prompt');
  console.error(`- archivo: ${filePath}`);
  console.error(`- BD updated_at: ${data.updated_at || 'N/A'}`);
  console.error(`- Longitudes: BD=${dbPrompt.length} file=${filePrompt.length}`);
  console.error(`- Primera diferencia (char #${firstDiff} aprox.):`);
  console.error(`  BD:   ${JSON.stringify(dbPrompt.substring(0, firstDiff + 60))}`);
  console.error(`  FILE: ${JSON.stringify(filePrompt.substring(0, firstDiff + 60))}`);
  console.error('Uso: `node scripts/sync-prompt.js` sube system.txt a la BD.');
  console.error('Ojo: la BD es la fuente viva (recomendación: no subir sin hand-off a D06).');
  return 1;
}

main().then((code) => {
  console.log(`exit=${code}`);
  process.exit(code);
}).catch((err) => {
  console.error('FALLO:', err.status || '', err.message || err);
  process.exit(1);
});
