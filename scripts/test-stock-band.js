'use strict';

const BASE_URL = process.env.BASE_URL || 'https://gestiondfd.com';
const GESTOR_USER = process.env.GESTOR_USER || 'prueba';
const GESTOR_PASS = process.env.GESTOR_PASS || '123456789';

async function loginGestor() {
  const r = await fetch(`${BASE_URL}/api/auth/gestor/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: GESTOR_USER, password: GESTOR_PASS }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`login gestor ${r.status}: ${t}`);
  }
  const j = await r.json();
  if (!j?.token) throw new Error('login gestor sin token');
  return j.token;
}

function tieneCifraStock(texto) {
  if (!texto) return false;
  const t = String(texto).toLowerCase();
  // Patrones que sugieren cifra exacta de stock
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
  const token = await loginGestor();
  const r = await fetch(`${BASE_URL}/api/bot/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      telefono: '+34900000099',
      mensaje: '¿cuánto stock tienes de 5-HTP?',
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('FALLO /api/bot/test', r.status, JSON.stringify(j));
    process.exit(1);
  }
  const respuesta = j?.respuesta || j?.text || j?.mensaje || '';
  console.log('RESPUESTA:', respuesta);
  if (tieneCifraStock(respuesta) || tieneCifraStock(JSON.stringify(j))) {
    console.error('FALLO: Se detectó una cifra exacta de stock en la respuesta del bot');
    process.exit(1);
  }
  console.log('OK: No se detectan cifras exactas de stock (banda OK)');
  process.exit(0);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
