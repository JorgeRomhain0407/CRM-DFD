'use strict';

// #V81 · QA de aceptación (D00/D02/D03): alta de operador + RBAC.
// Black-box contra un servidor real (por defecto producción).
// Auth por COOKIE (#V59: POST /api/auth/login → cookie dfd_session HttpOnly).
//
// Flujo: gestor crea un operador → ese operador inicia sesión → comprobamos que
// puede operar el mostrador y que NO puede tocar nada de administración →
// el gestor desactiva la cuenta → el operador ya no puede entrar.
//
// Uso: node scripts/test-operador-rbac.js
//   BASE_URL=https://gestiondfd.com GESTOR_USER=prueba GESTOR_PASS=123456789 \
//   node scripts/test-operador-rbac.js

const BASE_URL = process.env.BASE_URL || 'https://gestiondfd.com';
const GESTOR_USER = process.env.GESTOR_USER || 'prueba';
const GESTOR_PASS = process.env.GESTOR_PASS || '123456789';
const OP_USER = process.env.OP_USER || `qaoperador${Date.now().toString().slice(-6)}`;
const OP_PASS = process.env.OP_PASS || 'operador123';

let cookieGestor = '';
let cookieOperador = '';
let operadorId = '';

function cookiesDe(res) {
  const crudas = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return crudas.map((c) => c.split(';')[0]).join('; ');
}

async function login(usuario, password) {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, password }),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, cookie: cookiesDe(r), body };
}

async function req(cookie, metodo, ruta, body) {
  const r = await fetch(`${BASE_URL}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await r.text().catch(() => '');
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* no-JSON */ }
  return { status: r.status, json, texto };
}

async function main() {
  const resultados = [];
  const check = (nombre, ok, detalle) => {
    resultados.push({ nombre, ok, detalle });
    console.log(`${ok ? '  OK' : 'FAIL'} · ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  };

  // 1 · Login del gestor.
  const lg = await login(GESTOR_USER, GESTOR_PASS);
  check('gestor inicia sesión', lg.ok, `HTTP ${lg.status}`);
  if (!lg.ok) throw new Error(`login gestor falló: ${lg.status}`);
  cookieGestor = lg.cookie;

  const mg = await req(cookieGestor, 'GET', '/api/auth/me');
  check('gestor ve su perfil', mg.status === 200 && mg.json?.usuario?.rol === 'gestor', `rol=${mg.json?.usuario?.rol}`);

  // 2 · Alta del operador.
  const crea = await req(cookieGestor, 'POST', '/api/usuarios', {
    usuario: OP_USER,
    nombre: 'Operador QA #V81',
    password: OP_PASS,
    rol: 'operador',
  });
  check('gestor crea un operador (201)', crea.status === 201, `HTTP ${crea.status}${crea.json?.error ? ` — ${crea.json.error}` : ''}`);
  if (crea.status !== 201) throw new Error(`alta de operador falló: ${crea.status} ${crea.texto}`);
  operadorId = crea.json.usuario.id;
  check('el operador nace como "operador" activo',
    crea.json.usuario.rol === 'operador' && crea.json.usuario.activo === true,
    `rol=${crea.json.usuario.rol} activo=${crea.json.usuario.activo}`);

  // 3 · El operador inicia sesión.
  const lo = await login(OP_USER, OP_PASS);
  check('operador inicia sesión', lo.ok, `HTTP ${lo.status}`);
  if (!lo.ok) throw new Error(`login operador falló: ${lo.status} ${lo.body?.error || ''}`);
  cookieOperador = lo.cookie;

  const mo = await req(cookieOperador, 'GET', '/api/auth/me');
  check('operador ve su perfil con rol operador', mo.status === 200 && mo.json?.usuario?.rol === 'operador', `rol=${mo.json?.usuario?.rol}`);

  // 4 · Puede operar el mostrador (lecturas y operación del día).
  const puedeOperar = [
    ['GET', '/api/clientes'],
    ['GET', '/api/productos'],
    ['GET', '/api/bot/conversaciones'],
    ['GET', '/api/ventas'],
    ['GET', '/api/ventas/resumen'],
    ['GET', '/api/analitica?dias=1'],
    ['GET', '/api/kb'],
    ['GET', '/api/fidelizacion-config'],
  ];
  for (const [metodo, ruta] of puedeOperar) {
    const r = await req(cookieOperador, metodo, ruta);
    check(`operador puede ${metodo} ${ruta}`, r.status === 200, `HTTP ${r.status}${r.status !== 200 ? ` — ${r.texto.slice(0, 120)}` : ''}`);
  }

  // 5 · NO puede administrar (403) — incluye su propia ficha y el test del bot.
  const noPuedeAdministrar = [
    ['GET', '/api/usuarios', undefined],
    ['POST', '/api/usuarios', { usuario: 'x', password: '123456789', rol: 'gestor' }],
    ['PATCH', `/api/usuarios/${operadorId}`, { nombre: 'pirata' }],
    ['GET', '/api/bot/config', undefined],
    ['PUT', '/api/bot/config', { system_prompt: 'x' }],
    ['POST', '/api/bot/test', { telefono: '+34900000099', texto: 'hola' }],
    ['PUT', '/api/fidelizacion-config', { activo: true }],
    ['POST', '/api/fidelizacion/ajustar', { telefono: '+34900000099', delta: 10 }],
    ['POST', '/api/kb', { pregunta: 'x', respuesta: 'y' }],
  ];
  for (const [metodo, ruta, body] of noPuedeAdministrar) {
    const r = await req(cookieOperador, metodo, ruta, body);
    check(`operador NO puede ${metodo} ${ruta} (403)`, r.status === 403, `HTTP ${r.status}${r.status === 200 ? ` — DEVOLVIÓ 200: ${r.texto.slice(0, 80)}` : ''}`);
  }

  // 6 · Desactivación: el gestor baja la cuenta y el operador pierde el acceso.
  const baja = await req(cookieGestor, 'PATCH', `/api/usuarios/${operadorId}`, { activo: false });
  check('gestor desactiva la cuenta (200)', baja.status === 200, `HTTP ${baja.status}`);

  const trasBaja = await login(OP_USER, OP_PASS);
  check('cuenta desactivada ya no permite login', !trasBaja.ok, `HTTP ${trasBaja.status} — ${trasBaja.body?.error || 'sin cuerpo'}`);

  const resumen = resultados.filter((r) => r.ok).length;
  const fallos = resultados.filter((r) => !r.ok);
  console.log(`\n=== ${resumen}/${resultados.length} comprobaciones OK ===`);
  console.log(`TEST-ACCEPT #V81: ${fallos.length === 0 ? 'OK' : `FAIL (${fallos.map((f) => f.nombre).join(' | ')})`}`);
  console.log(`operador de prueba: ${OP_USER} (id ${operadorId}) — ya desactivado; D00 lo borra de la BD.`);
  if (fallos.length) process.exit(1);
}

main().catch((err) => {
  console.error('ERROR fatal:', err.message);
  process.exit(1);
});
