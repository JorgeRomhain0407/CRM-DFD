'use strict';

// #V64 · Prueba local de POST /api/bot/mensajes SIN tocar Meta ni la BD real.
// Inyecta stubs en require.cache, monta el router real en una app express y
// ejerce los 3 caminos:
//   1) hilo de prueba (último canal 'test')  -> no llama a Meta, graba 'test', ok
//   2) envío real por Meta OK                 -> graba 'whatsapp', enviado:true
//   3) fallo real de Meta                     -> graba igual el mensaje, 502
// Uso: `node scripts/test-bot-mensajes.js`

const path = require('path');
const express = require('express');

const root = path.join(__dirname, '..');
const stub = (rel, exports) => {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

/* ----------------------------- estado mutable ------------------------------ */
const db = { estadoChat: null, ultimoCanal: null };
const media = { falla: false };
const llamadasMeta = [];
const grabados = [];

/* --------------------------------- stubs ----------------------------------- */
stub('src/config.js', { defaultPhonePrefix: '+34', panelUrl: 'http://test' });
stub('src/lib/phone.js', {
  toE164: (x) => (String(x).startsWith('+') ? String(x) : `+${x}`),
  assertE164: (x) => x,
});
stub('src/lib/meta.js', {
  sendWhatsAppText: async (telefono, texto) => {
    llamadasMeta.push({ telefono, texto });
    if (media.falla) {
      const e = new Error('Meta: token inválido');
      e.details = { error: { message: 'Meta: token inválido' } };
      throw e;
    }
    return { messages: [{ id: 'stub' }] };
  },
});
stub('src/lib/auth.js', {
  requireAuth: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
});
stub('src/services/bot.js', {
  getBotConfig: async () => ({}),
  updateBotConfig: async () => ({}),
  getConversaciones: async () => [],
  getConversacion: async () => ({}),
  grabarMensaje: async (telefono, rol, contenido, canal) => {
    grabados.push({ telefono, rol, contenido, canal });
  },
});
stub('src/services/test-assistant.js', { testearAsistente: async () => 'stub' });
stub('src/services/tools.js', { solicitarAsistenciaHumana: async () => {} });
stub('src/services/customers.js', {
  ensureCliente: async () => {},
  maybePersistProfileFromText: async () => {},
});
stub('src/lib/guardia-sanitaria.js', { detectarGuardia: () => null });

// Fake mínimo de Supabase: solo los encadenados que usa la ruta /mensajes.
stub('src/lib/supabase.js', {
  getSupabase: () => ({
    from(table) {
      if (table === 'estado_chat') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: db.estadoChat, error: null }) }),
          }),
          update: (payload) => ({
            eq: async () => {
              db.estadoChat = { ...(db.estadoChat || {}), ...payload };
              return { error: null };
            },
          }),
        };
      }
      if (table === 'mensajes') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: db.ultimoCanal ? { canal: db.ultimoCanal } : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`tabla no esperada en el fake: ${table}`);
    },
  }),
});

/* ------------------------------- app + server ------------------------------ */
const router = require('../src/routes/bot');
const app = express();
app.use(express.json());
app.use('/api/bot', router);
app.use((err, _req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: 'Error interno del servidor' });
});

let ok = 0;
let fail = 0;
const check = (desc, cond, extra) => {
  if (cond) ok += 1;
  else {
    fail += 1;
    console.log(`FALLO ${desc}${extra ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
};

const reset = (estadoChat, ultimoCanal, falla) => {
  db.estadoChat = estadoChat;
  db.ultimoCanal = ultimoCanal;
  media.falla = falla;
  llamadasMeta.length = 0;
  grabados.length = 0;
};

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/bot/mensajes`;

  const post = (body) =>
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  // 1) Hilo de prueba: no debe llamar a Meta y graba como 'test'.
  reset({ estado: 'bot_activo' }, 'test', false);
  let res = await post({ telefono: '+34600000001', texto: 'hola desde el panel' });
  let json = await res.json();
  check('test: status 200', res.status === 200, { status: res.status, json });
  check('test: enviado=false y canal test', json.enviado === false && json.canal === 'test', json);
  check('test: NO llama a Meta', llamadasMeta.length === 0, llamadasMeta);
  check(
    'test: graba operador/test',
    grabados.length === 1 && grabados[0].rol === 'operador' && grabados[0].canal === 'test',
    grabados
  );
  check('test: pasa a humano_activo', db.estadoChat?.estado === 'humano_activo', db.estadoChat);

  // 2) WhatsApp real OK: llama a Meta y graba 'whatsapp'.
  reset({ estado: 'bot_activo' }, 'whatsapp', false);
  res = await post({ telefono: '+34600000002', texto: 'mensaje real' });
  json = await res.json();
  check('wa-ok: status 200', res.status === 200, { status: res.status, json });
  check('wa-ok: enviado=true', json.enviado === true, json);
  check('wa-ok: llama a Meta 1 vez', llamadasMeta.length === 1, llamadasMeta);
  check(
    'wa-ok: graba operador/whatsapp',
    grabados.length === 1 && grabados[0].canal === 'whatsapp',
    grabados
  );

  // 3) Fallo real de Meta: graba igual el mensaje y responde 502 (no 500).
  reset({ estado: 'bot_activo' }, 'whatsapp', true);
  res = await post({ telefono: '+34600000003', texto: 'mensaje que no sale' });
  json = await res.json();
  check('meta-fail: status 502', res.status === 502, { status: res.status, json });
  check('meta-fail: error de Meta en body', /No se pudo enviar por WhatsApp/.test(json.error || ''), json);
  check('meta-fail: intenta Meta 1 vez', llamadasMeta.length === 1, llamadasMeta);
  check(
    'meta-fail: graba igual el mensaje',
    grabados.length === 1 && grabados[0].contenido === 'mensaje que no sale' && grabados[0].canal === 'whatsapp',
    grabados
  );

  // 4) Vacío: 400 (contrato intacto).
  reset({ estado: 'bot_activo' }, 'whatsapp', false);
  res = await post({ telefono: '+34600000004', texto: '   ' });
  check('vacio: status 400', res.status === 400, { status: res.status });

  await new Promise((r) => server.close(r));
  console.log(`\nBot /mensajes: ${ok} pasan, ${fail} fallan`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Error inesperado en la prueba:', err);
  process.exit(1);
});
