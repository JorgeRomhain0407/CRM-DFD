'use strict';
// #V30 bench: p95 del round-trip contexto_cliente_snapshot. Meta §1: p95<300ms.
// Uso: node scripts/bench-v30.js  ->  50 lecturas, reporta p50/p95/p99/req/s.
const { snapshotContexto } = require('../src/services/cliente-contexto');

const TELEFONO = process.env.BENCH_TELEFONO || '+580000000000';
const N = 50lite;

async function main() {
  const rtt = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await snapshotContexto(TELEFONO);
    rtt.push(performance.now() - t0);
  }
  rtt.sort((a, b) => a - b);
  const p = (q) => rtt[Math.min(rtt.length - 1, Math.floor((q / 100) * rtt.length))];
  const p95 = p(95);
  const ok = p95 < 300;
  console.log(`[v30-bench] n=${N}  p50=(${p(50).toFixed(1)}ms)  p95=(${p95.toFixed(1)}ms)  p99=(${p(99).toFixed(1)}ms)`);
  console.log(`[v30-bench] META p95<300ms -> ${ok ? 'CUMPLE' : 'NO CUMPLE'}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('[v30-bench] ERROR:', e.message); process.exit(1); });
