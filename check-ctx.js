require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const tel = '+34600000911';
(async () => {
  const { data } = await sb.from('estado_chat').select('last_tool_context').eq('telefono_cliente', tel).maybeSingle();
  console.log('last_tool_context para', tel, ':');
  console.log(JSON.stringify(data?.last_tool_context, null, 2));
})();