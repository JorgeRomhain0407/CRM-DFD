'use strict';

// #V65 · QA de hábitos de consumo (black-box contra un servidor real + módulos).
// Cubre: tabla/join, PUT/GET de la ficha (producto_id, sin texto libre), validación
// (#V73), autofill desde lo comprado (origen 'compra') e idempotencia, y que el
// prompt reciba los nombres desde el join (fuente de HABITOS_CONSUMO).
//
// Uso: node scripts/test-habitos-v65.js [https://gestiondfd.com]

require('dotenv').config();

const crypto = require('crypto');

const BASE = process.argv[2] || 'https://gestiondfd.com';
const TEL = '+34900000911';
const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let ok = 0;
let fail = 0;

function check(nombre, cond, extra) {
  if (cond) {
    ok += 1;
    console.log(`OK   ${nombre}`);
  } else {
    fail += 1;
    console.log(`FALLO ${nombre}${extra ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: 'prueba', password: '123456789' }),
  });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function api(cookie, path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function sb(path, method = 'GET', body) {
  const res = await fetch(`${SUPA}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok && res.status !== 204) throw new Error(`supabase ${method} ${path} -> ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function limpiar() {
  const t = encodeURIComponent(TEL);
  for (const [tabla, col] of [
    ['mensajes', 'telefono_cliente'],
    ['estado_chat', 'telefono_cliente'],
    ['cliente_eventos', 'telefono_cliente'],
    ['cliente_habitos', 'telefono_cliente'],
    ['carritos_temporales', 'telefono_cliente'],
    ['puntos_movimientos', 'telefono_cliente'],
    ['ventas', 'telefono_cliente'],
    ['clientes', 'telefono'],
  ]) {
    await sb(`${tabla}?${col}=eq.${t}`, 'DELETE').catch(() => {});
  }
}

function statico() {
  const fs = require('fs');
  const path = require('path');
  const raiz = path.join(__dirname, '..');
  const ai = fs.readFileSync(path.join(raiz, 'src', 'services', 'ai.js'), 'utf8');
  const app = fs.readFileSync(path.join(raiz, 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(raiz, 'public', 'index.html'), 'utf8');

  check('ai.js arma HABITOS_CONSUMO desde el join', ai.includes('HABITOS_CONSUMO: ${habitos}') && ai.includes('getClienteHabitos(telefono)'));
  check('panel: selector de hábitos presente', app.includes('crearSelectorHabitos') && html.includes('habitosForm') && html.includes('perfilHabitos'));
  check('panel: envía producto_id (no texto libre)', /habitos:\s*selHabitos(Perfil|Form)\s*\?\s*selHabitos(Perfil|Form)\.get\(\)/.test(app));
}

(async () => {
  if (!SUPA || !KEY) throw new Error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');

  statico();

  const cookie = await login();
  await limpiar();

  const alta = await api(cookie, '/api/clientes', 'PUT', { telefono: TEL, nombre: 'QA V65' });
  check('PUT crea la ficha', alta.status === 200, alta);

  const vacia = await api(cookie, `/api/clientes/${encodeURIComponent(TEL)}`);
  check('ficha nueva sin hábitos', Array.isArray(vacia.json?.cliente?.habitos) && vacia.json.cliente.habitos.length === 0, vacia.json?.cliente?.habitos);

  const productos = await sb('productos?activo=eq.true&select=id,nombre&limit=3');
  check('hay catálogo activo para probar', Array.isArray(productos) && productos.length >= 3, productos && productos.length);
  const [p1, p2, p3] = productos;

  await api(cookie, '/api/clientes', 'PUT', { telefono: TEL, habitos: [p1.id] });
  const uno = await api(cookie, `/api/clientes/${encodeURIComponent(TEL)}`);
  const h1 = uno.json?.cliente?.habitos || [];
  check('alta manual: 1 hábito', h1.length === 1, h1);
  check('alta manual: origen manual', h1[0]?.origen === 'manual', h1[0]);
  check('alta manual: nombre del catálogo', h1[0]?.nombre === p1.nombre, h1[0]);

  await api(cookie, '/api/clientes', 'PUT', { telefono: TEL, habitos: [p1.id, p2.id] });
  const dos = await api(cookie, `/api/clientes/${encodeURIComponent(TEL)}`);
  check('edición reemplaza la lista (2)', (dos.json?.cliente?.habitos || []).length === 2, dos.json?.cliente?.habitos);

  const malo = await api(cookie, '/api/clientes', 'PUT', { telefono: TEL, habitos: [p1.id, crypto.randomUUID()] });
  check('#V73: producto inválido -> 400', malo.status === 400, malo);
  const tras = await api(cookie, `/api/clientes/${encodeURIComponent(TEL)}`);
  check('#V73: conserva los 2 hábitos previos', (tras.json?.cliente?.habitos || []).length === 2, tras.json?.cliente?.habitos);

  await sb('carritos_temporales', 'POST', [{ telefono_cliente: TEL, producto_id: p3.id, cantidad: 1 }]);
  const { registrarHabitosConsumo, getClienteHabitos } = require('../src/services/customers');
  await registrarHabitosConsumo(TEL);
  const auto = await api(cookie, `/api/clientes/${encodeURIComponent(TEL)}`);
  const hs = auto.json?.cliente?.habitos || [];
  const compra = hs.find((h) => h.producto_id === p3.id);
  check('autofill: añade el producto comprado', !!compra, hs);
  check('autofill: origen compra', compra?.origen === 'compra', compra);
  check('autofill: no pisa los manuales', hs.filter((h) => h.origen === 'manual').length === 2, hs);

  await registrarHabitosConsumo(TEL);
  const otra = await api(cookie, `/api/clientes/${encodeURIComponent(TEL)}`);
  check('autofill idempotente (sin duplicados)', (otra.json?.cliente?.habitos || []).length === 3, otra.json?.cliente?.habitos);

  const nombres = (await getClienteHabitos(TEL)).map((h) => h.nombre);
  check('fuente del prompt: nombres del join', [p1.nombre, p2.nombre, p3.nombre].every((n) => nombres.includes(n)), nombres);

  await limpiar();
  const resto = await sb(`clientes?telefono=eq.${encodeURIComponent(TEL)}&select=telefono`);
  check('limpieza: cliente de prueba borrado', Array.isArray(resto) && resto.length === 0, resto);

  console.log(`\n#V65 QA: ${ok} OK / ${fail} FALLO`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
