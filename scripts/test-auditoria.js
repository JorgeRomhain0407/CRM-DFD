'use strict';

// #V86 · QA de la lectura de auditoría (black-box contra un servidor real).
// Cubre: sesión obligatoria (401), gestor-only (403), forma de la respuesta,
// paginación (limit/offset, tope 200), filtros (acción/entidad/usuario/fechas)
// y validación de fechas (400).
//
// Uso: node scripts/test-auditoria.js [https://gestiondfd.com]

const BASE = process.argv[2] || 'https://gestiondfd.com';

let ok = 0;
let fail = 0;

function check(nombre, cond, extra) {
  if (cond) {
    ok += 1;
    console.log(`OK   ${nombre}`);
  } else {
    fail += 1;
    console.log(`FALLO ${nombre}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

async function login(usuario, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario, password }),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { status: res.status, cookie };
}

async function get(cookie, qs = '') {
  const headers = cookie ? { cookie } : {};
  const res = await fetch(`${BASE}/api/auditoria${qs}`, { headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

(async () => {
  const sinSesion = await get(null);
  check('sin sesión -> 401', sinSesion.status === 401, sinSesion);

  const op = await login('raizadfd', '123456789');
  check('login operador', op.status === 200, op.status);
  const opGet = await get(op.cookie);
  check('operador -> 403', opGet.status === 403, opGet);

  const ge = await login('prueba', '123456789');
  check('login gestor', ge.status === 200, ge.status);
  const base = await get(ge.cookie);
  check('gestor -> 200', base.status === 200, base.status);
  check('respuesta con forma esperada',
    Array.isArray(base.json?.eventos) && typeof base.json?.total === 'number' &&
    typeof base.json?.limit === 'number' && Array.isArray(base.json?.acciones),
    base.json && Object.keys(base.json));

  const eventos = base.json?.eventos || [];
  check('hay eventos de auditoría', eventos.length > 0, eventos.length);
  check('orden descendente por fecha', eventos.every((e, i) => i === 0 || new Date(eventos[i - 1].created_at) >= new Date(e.created_at)));

  const dos = await get(ge.cookie, '?limit=2');
  check('limit=2 respeta el tope', (dos.json?.eventos || []).length <= 2 && dos.json?.limit === 2, dos.json && { n: dos.json.eventos?.length, limit: dos.json.limit });

  const tope = await get(ge.cookie, '?limit=999');
  check('limit=999 se acota a 200', tope.json?.limit === 200, tope.json?.limit);

  const porAccion = await get(ge.cookie, '?accion=login.ok&limit=200');
  check('filtro acción=login.ok', (porAccion.json?.eventos || []).length > 0 &&
    (porAccion.json?.eventos || []).every((e) => e.accion === 'login.ok'),
    (porAccion.json?.eventos || []).map((e) => e.accion));

  const usr = await get(ge.cookie, '?entidad=usuarios&limit=200');
  check('filtro entidad=usuarios', (usr.json?.eventos || []).length > 0 &&
    (usr.json?.eventos || []).every((e) => e.entidad === 'usuarios'));

  const porUsuario = await get(ge.cookie, '?usuario=prueba&limit=200');
  check('filtro usuario=prueba', (porUsuario.json?.eventos || []).length > 0 &&
    (porUsuario.json?.eventos || []).every((e) => e.usuario_nombre === 'prueba'),
    (porUsuario.json?.eventos || []).map((e) => e.usuario_nombre));

  if ((base.json?.total || 0) > 1) {
    const p0 = await get(ge.cookie, '?limit=1&offset=0');
    const p1 = await get(ge.cookie, '?limit=1&offset=1');
    check('offset pagina (distinto primer evento)',
      p0.json?.eventos?.[0]?.id !== p1.json?.eventos?.[0]?.id,
      { p0: p0.json?.eventos?.[0]?.id, p1: p1.json?.eventos?.[0]?.id });
  }

  const futuro = await get(ge.cookie, '?desde=2999-01-01T00:00:00.000Z');
  check('rango futuro -> 0 eventos', (futuro.json?.eventos || []).length === 0 && futuro.json?.total === 0, futuro.json && { n: futuro.json.eventos?.length, total: futuro.json.total });

  const malDesde = await get(ge.cookie, '?desde=no-es-fecha');
  check('desde inválido -> 400', malDesde.status === 400, malDesde);
  const malHasta = await get(ge.cookie, '?hasta=2026-13-45');
  check('hasta inválido -> 400', malHasta.status === 400, malHasta);

  console.log(`\n#V86 QA: ${ok} OK / ${fail} FALLO`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
