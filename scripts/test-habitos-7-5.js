'use strict';

const BASE_URL = process.env.BASE_URL || 'https://gestiondfd.com';
const OP_USER = process.env.OP_USER || 'raizadfd';
const OP_PASS = process.env.OP_PASS || '123456789';
const GESTOR_USER = process.env.GESTOR_USER || 'prueba';
const GESTOR_PASS = process.env.GESTOR_PASS || '123456789';

async function loginOp() {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: OP_USER, password: OP_PASS }),
  });
  if (!r.ok) throw new Error(`login op ${r.status}`);
  const j = await r.json();
  if (!j?.token) throw new Error('sin token op');
  return j.token;
}

async function loginGestor() {
  const r = await fetch(`${BASE_URL}/api/auth/gestor/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: GESTOR_USER, password: GESTOR_PASS }),
  });
  if (!r.ok) throw new Error(`login gestor ${r.status}`);
  const j = await r.json();
  if (!j?.token) throw new Error('sin token gestor');
  return j.token;
}

async function main() {
  const tokOp = await loginOp();
  const tokGestor = await loginGestor();

  const tel = '+34900000088';
  // Crear cliente mínimo si existe? O intentar editar un cliente existente
  // Intentamos PUT a un cliente: primero buscamos si existe; si no, creamos vía panel no disponible aquí
  // Alternativa: PUT /api/clientes/:telefono con datos básicos; el endpoint espera cliente existente?
  // Veo api.js: PUT /api/clientes/:ident usa id/telefono — si no existe, upsert depende. Pero 7.5 habla de editar.
  // Usaremos un cliente existente de prueba: puede existir de QA anterior; si no, falla con 404 — pero el test es para validar comportamiento cuando existen hábitos.
  // Cargamos cliente
  const get = await fetch(`${BASE_URL}/api/clientes/${tel}`, {
    headers: { Authorization: `Bearer ${tokOp}` },
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
  const putBad = await fetch(`${BASE_URL}/api/clientes/${tel}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokOp}`,
    },
    body: JSON.stringify({
      nombre: cliente?.nombre || 'TESTQA',
      habitos: [{ producto_id: badId }],
    }),
  });
  if (putBad.status !== 400) {
    const t = await putBad.text().catch(() => '');
    console.error(`FALLO: esperado 400 con producto_id inexistente, recibido ${putBad.status} ${t}`);
    process.exit(1);
  }
  console.log('OK: PUT con producto_id inexistente devuelve 400');

  // Verificar que no se borraron hábitos previos
  const get2 = await fetch(`${BASE_URL}/api/clientes/${tel}`, {
    headers: { Authorization: `Bearer ${tokOp}` },
  });
  if (!get2.ok) {
    console.error('FALLO get2', get2.status);
    process.exit(1);
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
