'use strict';

const BASE = process.env.BASE || 'https://gestiondfd.com';
const OP_USER = process.env.OP_USER || 'raizadfd';
const OP_PASS = process.env.OP_PASS || '123456789';
const GESTOR_USER = process.env.GESTOR_USER || 'prueba';
const GESTOR_PASS = process.env.GESTOR_PASS || '123456789';

async function loginOp() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: OP_USER, password: OP_PASS }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`login op ${r.status}: ${t}`);
  }
  const j = await r.json().catch(() => ({}));
  if (j?.token) return j.token;
  // intentar extraer de cookies si no viene token
  const setCookie = r.headers.get('set-cookie') || r.headers.get('Set-Cookie');
  if (setCookie) return 'cookie-session';
  return 'ok';
}

async function loginGestor() {
  const r = await fetch(`${BASE}/api/auth/login?rol=gestor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: GESTOR_USER, password: GESTOR_PASS }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`login gestor ${r.status}: ${t}`);
  }
  const j = await r.json().catch(() => ({}));
  if (j?.token) return j.token;
  return 'ok';
}

async function main() {
  // Hacer login operador y reutilizar sesión
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: OP_USER, password: OP_PASS }),
  });
  if (!login.ok) throw new Error(`login op ${login.status}`);
  const cookies = login.headers.get('set-cookie') || '';
  const hdrOpC = { 'Content-Type': 'application/json', Cookie: cookies };
  const hdrOpG = { Cookie: cookies };

  const tel = '+34900000088';
  // Obtener cliente
  const get = await fetch(`${BASE}/api/clientes/${tel}`, {
    headers: hdrOpG,
  });
  if (!get.ok && get.status !== 404) {
    console.error('FALLO get cliente', get.status);
    process.exit(1);
  }
  const cliente = get.ok ? await get.json() : null;

  // Guardar hábitos actuales si existen
  const habitosAntes = cliente?.habitos || [];

  // PUT con producto_id inexistente (UUID random)
  const badId = 'e7a0f4f2-0b4e-4c53-9a89-20e97cc7e501';
  const putBad = await fetch(`${BASE}/api/clientes`, {
    method: 'PUT',
    headers: hdrOpC,
    body: JSON.stringify({
      telefono: tel,
      nombre: cliente?.nombre || 'TESTQA',
      habitos: [badId],
    }),
  });
  if (putBad.status !== 400) {
    const t = await putBad.text().catch(() => '');
    console.error(`FALLO: esperado 400 con producto_id inexistente, recibido ${putBad.status} ${t}`);
    process.exit(1);
  }
  console.log('OK: PUT con producto_id inexistente devuelve 400');

  // Verificar que no se borraron hábitos previos
  const get2 = await fetch(`${BASE}/api/clientes/${tel}`, {
    headers: hdrOpG,
  });
  if (!get2.ok) {
    // el endpoint GET por telefono puede variar; intentar GET /api/clientes?buscar=
    const g = await fetch(`${BASE}/api/clientes?buscar=${encodeURIComponent(tel)}`, { headers: hdrOpG });
    if (!g.ok) {
      console.error('FALLO get2', get2.status);
      process.exit(1);
    }
    const list = await g.json();
    const cliente2 = Array.isArray(list) ? list[0] : list?.data?.[0] || null;
    const habitosDespues = cliente2?.habitos || [];
    const setAntes = new Set((habitosAntes || []).map((h) => h.producto_id || h.id));
    const setDesp = new Set((habitosDespues || []).map((h) => h.producto_id || h.id));
    if (setAntes.size !== setDesp.size || [...setAntes].some((x) => !setDesp.has(x))) {
      console.error('FALLO: Se modificaron los hábitos previos tras intento fallido');
      process.exit(1);
    }
    console.log('OK: Los hábitos no se modificaron tras intento fallido');
    console.log('TEST-ACCEPT 7.5: OK');
    process.exit(0);
  }
  const cliente2 = await get2.json();
  const habitosDespues = cliente2?.habitos || [];
  // Comparamos por producto_id (ignorando orden)
  const setAntes = new Set((habitosAntes || []).map((h) => h.producto_id || h.id));
  const setDesp = new Set((habitosDespues || []).map((h) => h.producto_id || h.id));
  if (setAntes.size !== setDesp.size || [...setAntes].some((x) => !setDesp.has(x))) {
    console.error('FALLO: Se modificaron los hábitos previos tras intento fallido', {
      antes: [...setAntes],
      despues: [...setDesp],
    });
    process.exit(1);
  }
  console.log('OK: Los hábitos no se modificaron tras intento fallido');
  console.log('TEST-ACCEPT 7.5: OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
