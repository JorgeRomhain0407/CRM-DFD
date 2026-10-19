'use strict';

// #V73 · QA de aceptación (D00/D03) del hallazgo 7.5 de #V65.
// PUT /api/clientes con un producto_id INEXISTENTE debe devolver 400 y NO borrar
// los hábitos previos del cliente. Black-box contra un servidor real.
// Auth por COOKIE (#V59). La edición es PUT /api/clientes (teléfono en el body)
// y `habitos` es una LISTA DE STRINGS (producto_id), no de objetos.

const BASE_URL = process.env.BASE_URL || 'https://gestiondfd.com';
const OP_USER = process.env.OP_USER || 'raizadfd';
const OP_PASS = process.env.OP_PASS || '123456789';

const TEL = process.env.TEL || '+34900000088';
const BAD_ID = 'e7a0f4f2-0b4e-4c53-9a89-20e97cc7e501';

function cookiesDe(res) {
  const crudas = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return crudas.map((c) => c.split(';')[0]).join('; ');
}

async function login(usuario, password, etiqueta) {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, password }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`login ${etiqueta} ${r.status}: ${t}`);
  }
  const cookie = cookiesDe(r);
  if (!cookie) throw new Error(`login ${etiqueta} sin cookie de sesión`);
  return cookie;
}

async function getCliente(cookie) {
  const r = await fetch(`${BASE_URL}/api/clientes/${TEL}`, { headers: { Cookie: cookie } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET cliente ${r.status}`);
  const j = await r.json();
  return j?.cliente || null;
}

function idsDe(cliente) {
  return new Set((cliente?.habitos || []).map((h) => h.producto_id));
}

async function main() {
  const cookie = await login(OP_USER, OP_PASS, 'operador');

  // Producto válido para dejar un hábito real antes del intento fallido.
  const rp = await fetch(`${BASE_URL}/api/productos`, { headers: { Cookie: cookie } });
  if (!rp.ok) throw new Error(`GET /api/productos ${rp.status}`);
  const { productos } = await rp.json();
  const valido = (productos || []).find((p) => p.id && p.nombre && p.activo !== false);
  if (!valido) throw new Error('No hay productos activos para la prueba');

  // 1) Dejamos un hábito válido en el cliente (crea la ficha si no existe).
  const putOk = await fetch(`${BASE_URL}/api/clientes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ telefono: TEL, nombre: 'QA 7.5', habitos: [valido.id] }),
  });
  if (!putOk.ok) {
    console.error('FALLO: no se pudo preparar el hábito válido', putOk.status, await putOk.text().catch(() => ''));
    process.exitCode = 1;
    return;
  }
  const antes = await getCliente(cookie);
  if (!idsDe(antes).has(valido.id)) {
    console.error('FALLO: el hábito válido no quedó registrado en la ficha');
    process.exitCode = 1;
    return;
  }
  console.log(`Preparado: cliente ${TEL} con hábito válido ${valido.id}`);

  // 2) PUT con producto_id inexistente → debe ser 400.
  const putBad = await fetch(`${BASE_URL}/api/clientes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ telefono: TEL, habitos: [BAD_ID] }),
  });
  if (putBad.status !== 400) {
    const t = await putBad.text().catch(() => '');
    console.error(`FALLO: esperado 400 con producto_id inexistente, recibido ${putBad.status} ${t}`);
    process.exitCode = 1;
    return;
  }
  console.log('OK: PUT con producto_id inexistente devuelve 400');

  // 3) Los hábitos NO se borraron.
  const despues = await getCliente(cookie);
  if (!idsDe(despues).has(valido.id)) {
    console.error('FALLO: los hábitos se borraron tras el intento fallido', {
      antes: [...idsDe(antes)],
      despues: [...idsDe(despues)],
    });
    process.exitCode = 1;
    return;
  }
  console.log('OK: Los hábitos previos se conservan tras el intento fallido');
  console.log('TEST-ACCEPT 7.5: OK');
}

main().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exitCode = 1;
});
