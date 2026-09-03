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
const { ensureCliente } = require('../services/customers');

const router = express.Router();

function requireMostrador(req, res, next) {
  const key = req.get('x-api-key') || req.query.api_key;
  if (!key || key !== config.mostradorApiKey) {
    return res.status(401).json({ error: 'No autorizado. Envía header x-api-key.' });
  }
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.use(requireMostrador);

router.get('/config', asyncHandler(async (_req, res) => {
  res.json({ config: await getBotConfig() });
}));

router.put('/config', asyncHandler(async (req, res) => {
  // Solo el administrador principal puede modificar la configuración del bot.
  const adminKey = req.get('x-admin-key');
  if (!config.adminConfigKey || !adminKey || adminKey !== config.adminConfigKey) {
    return res.status(403).json({ error: 'No autorizado. Requiere clave de administrador.' });
  }
  const configSaved = await updateBotConfig(req.body);
  res.json({ config: configSaved });
}));

router.get('/conversaciones', asyncHandler(async (_req, res) => {
  res.json({ conversaciones: await getConversaciones() });
}));

router.get('/conversaciones/:telefono', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.params.telefono, config.defaultPhonePrefix));
  res.json(await getConversacion(telefono));
}));

router.post('/test', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.body.telefono, config.defaultPhonePrefix));
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'Escribe un mensaje de prueba.' });

  await ensureCliente(telefono);
  await grabarMensaje(telefono, 'usuario', texto, 'test');

  const respuesta = await testearAsistente({ telefono, texto });
  await grabarMensaje(telefono, 'asistente', respuesta, 'test');

  res.json({ respuesta, telefono });
}));

router.post('/mensajes', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.body.telefono, config.defaultPhonePrefix));
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ error: 'Escribe un mensaje.' });

  await sendWhatsAppText(telefono, texto);
  await grabarMensaje(telefono, 'operador', texto, 'whatsapp');

  res.json({ ok: true, enviado: true });
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
