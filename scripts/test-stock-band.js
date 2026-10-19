'use strict';

// #V74 · QA de aceptación (D00/D03): el bot NO revela cifras exactas de stock.
// Black-box contra un servidor real (por defecto producción).
// Auth por COOKIE (#V59: POST /api/auth/login → cookie dfd_session HttpOnly).
// El body de /api/bot/test es { telefono, texto }.

const BASE_URL = process.env.BASE_URL || 'https://gestiondfd.com';
const GESTOR_USER = process.env.GESTOR_USER || 'prueba';
const GESTOR_PASS = process.env.GESTOR_PASS || '123456789';

function cookiesDe(res) {
  const crudas = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return crudas.map((c) => c.split(';')[0]).join('; ');
}

async function loginGestor() {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: GESTOR_USER, password: GESTOR_PASS }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`login gestor ${r.status}: ${t}`);
  }
  const cookie = cookiesDe(r);
  if (!cookie) throw new Error('login gestor sin cookie de sesión');
  return cookie;
}

function tieneCifraStock(texto) {
  if (!texto) return false;
  const t = String(texto).toLowerCase();
  const patrones = [
    /\bstock\b[^0-9]{0,40}\d+/,
    /\d+\s*(unidades|uds|u\.)\b/,
    /\bquedan?\b[^0-9]{0,20}\d+/,
    /\bdisponibles?\b[^0-9]{0,20}\d+/,
    /\brestantes?\b[^0-9]{0,20}\d+/,
    /\bstock_restante\b/,
    /"stock"\s*:\s*\d+/,
    /"stock_restante"\s*:\s*\d+/,
  ];
  return patrones.some((p) => p.test(t));
}

async function main() {
  const cookie = await loginGestor();

  // Elegimos un producto real para forzar que el bot consulte inventario.
  const rp = await fetch(`${BASE_URL}/api/productos`, { headers: { Cookie: cookie } });
  if (!rp.ok) throw new Error(`GET /api/productos ${rp.status}`);
  const { productos } = await rp.json();
  const producto = (productos || []).find((p) => p.nombre && p.activo !== false) || {};
  const nombre = producto.nombre || '5-HTP';

  const r = await fetch(`${BASE_URL}/api/bot/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      telefono: '+34900000099',
      texto: `¿cuánto stock tienes de ${nombre}?`,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('FALLO /api/bot/test', r.status, JSON.stringify(j));
    process.exitCode = 1;
    return;
  }
  const respuesta = j?.respuesta || '';
  console.log(`PREGUNTA: ¿cuánto stock tienes de ${nombre}?`);
  console.log('RESPUESTA:', respuesta);
  if (tieneCifraStock(respuesta) || tieneCifraStock(JSON.stringify(j))) {
    console.error('FALLO: Se detectó una cifra exacta de stock en la respuesta del bot');
    process.exitCode = 1;
    return;
  }
  console.log('OK: No se detectan cifras exactas de stock (banda OK)');
}

main().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exitCode = 1;
});
