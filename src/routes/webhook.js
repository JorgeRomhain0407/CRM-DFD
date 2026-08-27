'use strict';

const express = require('express');
const config = require('../config');
const { toE164 } = require('../lib/phone');
const { verifyMetaSignature, sendWhatsAppText, markMessageRead } = require('../lib/meta');
const { ensureCliente, maybePersistProfileFromText, claimWebhookEvent } = require('../services/customers');
const { grabarMensaje } = require('../services/bot');
const { responderConAsistente } = require('../services/assistant');

const router = express.Router();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && token === config.meta.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/', (req, res) => {
  if (!verifyMetaSignature(req)) {
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  if (req.body?.object !== 'whatsapp_business_account') return;

  try {
    const inbound = extractInboundMessages(req.body);
    for (const msg of inbound) {
      setImmediate(() => {
        handleInboundMessage(msg).catch((err) => {
          console.error('[webhook] handleInboundMessage', err);
        });
      });
    }
  } catch (err) {
    console.error('[webhook] parse', err);
  }
});

function extractInboundMessages(payload) {
  const out = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (Array.isArray(value.statuses) && value.statuses.length && !value.messages) {
        continue;
      }
      const phoneNumberId = value.metadata?.phone_number_id;
      for (const message of value.messages || []) {
        if (message.type === 'system') continue;
        const texto = extractMessageText(message);
        if (texto === null) continue;
        out.push({
          waMessageId: message.id,
          from: toE164(message.from, config.defaultPhonePrefix),
          timestamp: message.timestamp,
          type: message.type,
          text: texto,
          phoneNumberId,
          profileName: value.contacts?.[0]?.profile?.name || null,
        });
      }
    }
  }
  return out;
}

function extractMessageText(message) {
  switch (message.type) {
    case 'text':
      return message.text?.body?.trim() || '';
    case 'button':
      return message.button?.text || message.button?.payload || '';
    case 'interactive': {
      const i = message.interactive || {};
      return i.button_reply?.title || i.list_reply?.title || i.nfm_reply?.response_json || '';
    }
    case 'image':
    case 'audio':
    case 'document':
    case 'sticker':
    case 'video':
    case 'location':
    case 'contacts':
    case 'order':
      return `El cliente envió un adjunto de tipo ${message.type}. Pide que lo describa por texto o transfiere a un especialista si es una receta o foto clínica.`;
    default:
      return null;
  }
}

async function handleInboundMessage(msg) {
  if (!msg.from) {
    console.warn('[webhook] mensaje sin teléfono', msg.waMessageId);
    return;
  }

  const isNew = await claimWebhookEvent(msg.waMessageId);
  if (!isNew) return;

  await markMessageRead(msg.waMessageId, msg.phoneNumberId);
  const { estado } = await ensureCliente(msg.from);

  if (estado?.estado && estado.estado !== 'bot_activo') {
    console.log(`[handoff] bot silenciado (${estado.estado}) para ${msg.from}`);
    return;
  }

  if (msg.text) {
    await maybePersistProfileFromText(msg.from, msg.text);
    await grabarMensaje(msg.from, 'usuario', msg.text, 'whatsapp');
  }

  const reply = await responderConAsistente({
    telefono: msg.from,
    texto: msg.text || '',
  });

  if (reply) {
    await sendWhatsAppText(msg.from, reply, msg.phoneNumberId);
    await grabarMensaje(msg.from, 'asistente', reply, 'whatsapp');
  }
}

module.exports = router;
