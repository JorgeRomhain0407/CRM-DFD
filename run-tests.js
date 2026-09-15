require('dotenv').config();
const KEY = process.env.MOSTRADOR_API_KEY;

async function test(telefono, texto) {
  const r = await fetch('http://localhost:3000/api/bot/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ telefono, texto }),
  });
  const d = await r.json();
  return { status: r.status, respuesta: d.respuesta || JSON.stringify(d) };
}

async function run() {
  const results = [];

  // TEST 1: Límite 3 + prioriza stock (mismo teléfono que test-0)
  console.log('\n=== TEST 1: Límite 3 + prioriza stock ===');
  const t1 = '+34600000555';
  const r1 = await test(t1, 'quiero paracetamol de 1 gramo');
  console.log(`(${r1.status}) ${r1.respuesta}`);
  results.push({ test: 'limite3_stock', ok: r1.status === 200 && r1.respuesta.length > 10 });

  // TEST 2: "El más barato" (orden_precio asc) - teléfono nuevo
  console.log('\n=== TEST 2: El más barato ===');
  const t2 = '+34600000666';
  const r2 = await test(t2, 'quiero el paracetamol más barato de 1 gramo');
  console.log(`(${r2.status}) ${r2.respuesta}`);
  results.push({ test: 'mas_barato', ok: r2.status === 200 && r2.respuesta.length > 10 });

  // TEST 3: Rotación - segundo turno en mismo teléfono que TEST 1
  console.log('\n=== TEST 3: Rotación (2ª consulta mismo cliente) ===');
  const r3 = await test(t1, '¿qué más opciones de paracetamol de 1g tienes?');
  console.log(`(${r3.status}) ${r3.respuesta}`);
  results.push({ test: 'rotacion', ok: r3.status === 200 && r3.respuesta.length > 10 });

  // TEST 4: Marca específica
  console.log('\n=== TEST 4: Marca específica (Gelocatil) ===');
  const t4 = '+34600000777';
  const r4 = await test(t4, '¿tenéis paracetamol gelocatil?');
  console.log(`(${r4.status}) ${r4.respuesta}`);
  results.push({ test: 'marca_especifica', ok: r4.status === 200 && r4.respuesta.length > 10 });

  // TEST 5: Fallback - producto inexistente
  console.log('\n=== TEST 5: Fallback (aspirina forte, no existe) ===');
  const t5 = '+34600000888';
  const r5 = await test(t5, 'necesito aspirina forte');
  console.log(`(${r5.status}) ${r5.respuesta}`);
  results.push({ test: 'fallback', ok: r5.status === 200 });

  // RESUMEN
  console.log('\n=== RESUMEN ===');
  results.forEach((r) => console.log(`  ${r.test}: ${r.ok ? 'PASS' : 'FAIL'}`));
  const passed = results.filter((r) => r.ok).length;
  console.log(`  ${passed}/${results.length} pasaron`);
}

run().catch((e) => console.error('ERROR:', e.message));
