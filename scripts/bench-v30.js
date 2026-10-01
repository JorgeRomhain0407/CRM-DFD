'use strict';

// #V30/#V47 · Benchmark del snapshot de contexto (RPC contexto_cliente_snapshot).
// Meta de la propuesta #V30: latencia ultrarrápida para el bot — p95 < 300 ms.
// Uso (AGENTS.md):
//   node scripts/bench-v30.js [+34XXXXXXXXXX] [N]
// - 1er arg: teléfono existente (default: +34900000088, phone de pruebas)
// - 2º arg:  número de llamadas (default 20). Solo lecturas (STABLE).

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const TEL = process.argv[2] || '+34900000088';
const N = Math.max(3, Number(process.argv[3] || 20));

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const muestras = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const { error } = await sb.rpc('contexto_cliente_snapshot', { p_telefono: TEL });
    if (error) throw error;
    muestras.push(performance.now() - t0);
  }
  muestras.sort((a, b) => a - b);
  const p = (q) => muestras[Math.min(muestras.length - 1, Math.ceil(q * muestras.length) - 1)];
  const media = muestras.reduce((s, v) => s + v, 0) / muestras.length;
  console.log(`bench #V30 (${N} llamadas · ${TEL})`);
  console.log(`  media: ${media.toFixed(1)} ms`);
  console.log(`  p50:   ${p(0.5).toFixed(1)} ms`);
  console.log(`  p95:   ${p(0.95).toFixed(1)} ms  (meta < 300 ms)`);
  console.log(`  max:   ${muestras[muestras.length - 1].toFixed(1)} ms`);
  if (p(0.95) >= 300) {
    console.log('  ⚠️ p95 POR ENCIMA de la meta — revisar índices/volumen.');
    process.exit(1);
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
