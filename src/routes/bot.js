'use strict';

const express = require('express');
const config = require('../config');
const { toE164, assertE164 } = require('../lib/phone');
const { sendWhatsAppText } = require('../lib/meta');
const {
  getBotConfig,
  updateBotConfig,
  getConversaciones,
  getConversacion,
  grabarMensaje,
} = require('../services/bot');
const { testearAsistente } = require('../services/test-assistant');
const { solicitarAsistenciaHumana } = require('../services/tools');
const { detectarGuardia } = require('../lib/guardia-sanitaria');
const { ensureCliente, maybePersistProfileFromText } = require('../services/customers');
const { requireAuth, requireRole } = require('../lib/auth');
const { registrarAuditoria } = require('../services/auditoria');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// #V59 · Ya no hay clave compartida (x-api-key): todas las rutas exigen sesión.
router.use(requireAuth);

// Config del bot: solo gestor.
router.get('/config', requireRole('gestor'), asyncHandler(async (_req, res) => {
  res.json({ config: await getBotConfig() });
}));

router.put('/config', requireRole('gestor'), asyncHandler(async (req, res) => {
  // Solo un gestor puede modificar la configuración del bot.
  const configSaved = await updateBotConfig(req.body);
  // #V60 (D04/R5) · Auditoría: quién cambió qué campos de la config del bot.
  registrarAuditoria({
    accion: 'bot_config.update',
    entidad: 'bot_config',
    entidadId: '1',
    campos: Object.keys(req.body || {}),
    usuario: req.user,
    ip: req.ip,
  });
  res.json({ config: configSaved });
}));

router.get('/conversaciones', asyncHandler(async (_req, res) => {
  res.json({ conversaciones: await getConversaciones() });
}));

router.get('/conversaciones/:telefono', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.params.telefono, config.defaultPhonePrefix));
  res.json(await getConversacion(telefono));
}));

// Test del bot: solo gestor.
router.post('/test', requireRole('gestor'), asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.body.telefono, config.defaultPhonePrefix));
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'Escribe un mensaje de prueba.' });

  await ensureCliente(telefono);
  await maybePersistProfileFromText(telefono, texto);
  await grabarMensaje(telefono, 'usuario', texto, 'test');

  // #V46 · Espejo del guardia sanitario: mismo comportamiento que el webhook.
  const guardia = detectarGuardia(texto);
  if (guardia) {
    await solicitarAsistenciaHumana(
      { telefono_cliente: telefono, motivo: guardia.motivo },
      telefono
    );
    await grabarMensaje(telefono, 'asistente', guardia.acuse, 'test');
    return res.json({ respuesta: guardia.acuse, telefono, guardia: true });
  }

  // #V44 · En el test, un fallo del bot se reporta claro al panel en vez de
  // un 500 genérico: el mostrador sabe revisar la configuración (OpenAI).
  let respuesta;
  try {
    respuesta = await testearAsistente({ telefono, texto });
  } catch (err) {
    console.error('[bot/test] fallo del asistente:', err);
    return res.status(503).json({
      error: 'El bot no puede responder ahora mismo. Revisa la configuración (OpenAI/Supabase) e intenta de nuevo.',
    });
  }
  await grabarMensaje(telefono, 'asistente', respuesta, 'test');

  res.json({ respuesta, telefono });
}));

router.post('/mensajes', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.body.telefono, config.defaultPhonePrefix));
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'Escribe un mensaje.' });

  await ensureCliente(telefono);

  // El operador se hace con la conversación: si el bot estaba activo, se pausa.
  const supabase = require('../lib/supabase').getSupabase();
  const { data: estado } = await supabase
    .from('estado_chat')
    .select('estado')
    .eq('telefono_cliente', telefono)
    .maybeSingle();
  if (!estado || estado.estado !== 'humano_activo') {
    const { error: estError } = await supabase
      .from('estado_chat')
      .update({ estado: 'humano_activo' })
      .eq('telefono_cliente', telefono);
    if (estError) throw estError;
  }

  await sendWhatsAppText(telefono, texto);
  await grabarMensaje(telefono, 'operador', texto, 'whatsapp');

  res.json({ ok: true, enviado: true, estado: 'humano_activo' });
}));

router.patch('/estado-chat/:telefono', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.params.telefono, config.defaultPhonePrefix));
  const nuevoEstado = req.body.estado;
  const permitido = ['bot_activo', 'esperando_operador', 'humano_activo'];
  if (!permitido.includes(nuevoEstado)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }
  await ensureCliente(telefono);

  const updatePayload = { estado: nuevoEstado };
  if (nuevoEstado === 'bot_activo') {
    updatePayload.motivo_handoff = null;
    updatePayload.silenciado_desde = null;
  }
  if (req.body.motivo) {
    updatePayload.motivo_handoff = req.body.motivo;
  }

  const { data, error } = await require('../lib/supabase').getSupabase()
    .from('estado_chat')
    .update(updatePayload)
    .eq('telefono_cliente', telefono)
    .select()
    .single();
  if (error) throw error;
  res.json({ estado_chat: data });
}));

module.exports = router;
