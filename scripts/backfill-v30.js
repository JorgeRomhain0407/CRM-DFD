'use strict';

// #V30/#V47 · Backfill: rellena clientes.perfil (JSONB) a partir de los datos
// ya existentes (habitos_consumo, edad) para clientes cuyo perfil está vacío.
// Idempotente: solo toca perfiles sin habitos ya copiados.
// Uso (AGENTS.md): node scripts/backfill-v30.js
// No guarda texto de mensajes (PII): solo lo ya registrado en clientes.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, error } = await sb
    .from('clientes')
    .select('telefono, nombre, edad, habitos_consumo, perfil')
    .limit(1000);
  if (error) throw error;

  let tocados = 0;
  for (const c of data || []) {
    const perfil = c.perfil || {};
    if (perfil.habitos && perfil.edad != null) continue; // ya completado
    const nuevo = {
      ...perfil,
      ...(perfil.habitos ? {} : { habitos: c.habitos_consumo || '' }),
      ...(perfil.edad != null || c.edad == null ? {} : { edad: c.edad }),
    };
    if (JSON.stringify(nuevo) === JSON.stringify(perfil)) continue;
    const { error: eUpd } = await sb
      .from('clientes')
      .update({ perfil: nuevo })
      .eq('telefono', c.telefono);
    if (eUpd) throw eUpd;
    tocados += 1;
  }

  console.log(`Backfill #V30 listo: ${tocados} perfiles actualizados.`);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
