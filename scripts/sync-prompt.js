require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const prompt = fs.readFileSync('src/prompts/system.txt', 'utf8');

(async () => {
  const { data, error } = await sb
    .from('bot_config')
    .update({ system_prompt: prompt })
    .eq('id', 1)
    .select('id, bot_nombre');
  if (error) { console.error('ERROR:', error.message); process.exit(1); }
  const check = await sb.from('bot_config').select('system_prompt').eq('id', 1).maybeSingle();
  if (check.error) { console.error('CHECK ERR:', check.error.message); process.exit(1); }
  console.log('Promt sincronizado. Filas:', JSON.stringify(data));
  console.log('Longitud en BD:', check.data.system_prompt.length);
})();