'use strict';
// #V36 · Batería de fidelización.
//   Parte 1: lógica numérica pura (sin BD).
//   Parte 2: fail-soft del servicio sin BD (fidelizacion.js no debe lanzar).
// Lanza con: node scripts/test-fidelizacion.js

const path = require('path');

let fallos = 0;
let total = 0;
function test(desc, ok) {
  total++;
  console.log((ok ? '[OK] ' : '[FALLA] ') + desc);
  if (!ok) { fallos++; process.exitCode = 1; }
}

// ---------------------------------------------------------------------
// Parte 1 · aritmética de puntos (espejo de la regla del RPC)
// ---------------------------------------------------------------------
function roundInt(n) {
  return Math.round(Number(n));
}

function calcPuntos({ precioUsd, cantidad, puntosPorUsd, mult }) {
  const p = Number(precioUsd) || 0;
  const c = Number(cantidad) || 0;
  const base = Number(puntosPorUsd) || 0;
  const m = Number(mult) || 1;
  if (p <= 0 || c <= 0 || base <= 0) return 0;
  const v = p * c * base * m;
  return Math.max(0, Math.trunc(Math.round(v)));
}

console.log('— aritmética —');
test('1 USD x1 base 50 -> 50', calcPuntos({ precioUsd: 1, cantidad: 1, puntosPorUsd: 50, mult: 1 }) === 50);
test('4.01 USD x1 base 50 -> 201 (JS half-up = PG half-away)',
  calcPuntos({ precioUsd: 4.01, cantidad: 1, puntosPorUsd: 50, mult: 1 }) === 201);
test('4.01*50 es 200.5 y Math.round(200.5)=201 (no 200)', Math.round(4.01 * 50) === 201);
test('3.99 USD x1 base 50 -> 200 (199.5 round)',
  calcPuntos({ precioUsd: 3.99, cantidad: 1, puntosPorUsd: 50, mult: 1 }) === 200);
test('1 USD x1 base 50 mult 2 -> 100',
  calcPuntos({ precioUsd: 1, cantidad: 1, puntosPorUsd: 50, mult: 2 }) === 100);
test('2 USD x3 base 50 mult 1 -> 300',
  calcPuntos({ precioUsd: 2, cantidad: 3, puntosPorUsd: 50, mult: 1 }) === 300);
test('0 USD -> 0', calcPuntos({ precioUsd: 0, cantidad: 1, puntosPorUsd: 50, mult: 1 }) === 0);
test('null USD -> 0', calcPuntos({ precioUsd: null, cantidad: 2, puntosPorUsd: 50, mult: 1 }) === 0);

// ---------------------------------------------------------------------
// Parte 2 · fail-soft del servicio sin Supabase configurado
// ---------------------------------------------------------------------
console.log('— fail-soft sin base de datos —');

// El servicio debe degradar con AVISO, nunca con excepción no capturada:
// así una compra no se cae si la migración aún no está aplicada.
(async () => {
  // config.js llama a require('dotenv').config() en cada require fresco y
  // dotenv SIEMPRE lee <cwd>/.env (sin opción de path en v16): repoblaría las
  // claves borradas con el .env real. Salimos del repo con chdir para aislar
  // de verdad el caso "sin BD".
  const os = require('os');
  const cwdReal = process.cwd();
  const guardados = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.chdir(os.tmpdir());
  for (const k of Object.keys(require.cache)) delete require.cache[k];

  const fid = require(path.join(__dirname, '..', 'src', 'services', 'fidelizacion.js'));

  try {
    const saldo = await fid.getSaldo('+34600000000');
    test('getSaldo sin BD no lanza', true);
    test('getSaldo marca disponible=false', saldo.disponible === false);
    test('getSaldo informa programa_activo=false (el bot no dirá "0 puntos" como activo)',
      saldo.programa_activo === false);
    test('getSaldo devuelve movimientos y recompensas vacíos',
      Array.isArray(saldo.movimientos) && Array.isArray(saldo.recompensas));
  } catch (e) {
    test('getSaldo sin BD no lanza (' + e.message + ')', false);
  }

  try {
    const r = await fid.acumularPuntos({
      telefono: '+34600000000', referencia: 'test:1', items: [{ producto_id: 'x', cantidad: 1 }],
    });
    test('acumularPuntos sin BD no lanza', true);
    test('acumularPuntos no dice ok si no acumuló', r.ok !== true);
  } catch (e) {
    test('acumularPuntos sin BD no lanza (' + e.message + ')', false);
  }

  try {
    const r = await fid.canjearPuntos({
      telefono: '+34600000000',
      recompensaId: 'no-es-uuid',
      referencia: 'test:2',
    });
    test('canjearPuntos rechaza id inválido antes de tocar la BD',
      r.ok === false && r.motivo === 'recompensa_invalida');
  } catch (e) {
    test('canjearPuntos no lanza (' + e.message + ')', false);
  }

  try {
    const r = await fid.ajusteManual({ telefono: '+34600000000', puntos: 0 });
    test('ajusteManual rechaza 0 puntos', r.ok === false && r.motivo === 'puntos_cero');
    const r2 = await fid.ajusteManual({ telefono: '+34600000000', puntos: 1.5 });
    test('ajusteManual rechaza decimales', r2.ok === false && r2.motivo === 'puntos_cero');
  } catch (e) {
    test('ajusteManual no lanza (' + e.message + ')', false);
  }

  try {
    const cat = await fid.getCategorias();
    const rec = await fid.getRecompensas();
    test('getCategorias/getRecompensas sin BD devuelven [] y no lanzan',
      Array.isArray(cat) && Array.isArray(rec));
  } catch (e) {
    test('getCategorias no lanza (' + e.message + ')', false);
  }

  process.chdir(cwdReal);
  if (guardados.url != null) process.env.SUPABASE_URL = guardados.url;
  if (guardados.key != null) process.env.SUPABASE_SERVICE_ROLE_KEY = guardados.key;

  console.log(fallos
    ? `\n${fallos} de ${total} pruebas fallidas`
    : `\nTodas las pruebas OK (${total} casos)`);
  if (fallos) process.exit(1);
})();
