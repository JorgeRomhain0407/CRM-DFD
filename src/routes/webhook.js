'use strict';

const express = require('express');
const config = require('../config');
const { toE164 } = require('../lib/phone');
const { verifyMetaSignature, sendWhatsAppText, markMessageRead } = require('../lib/meta');
const { ensureCliente, maybePersistProfileFromText, claimWebhookEvent } = require('../services/customers');
const { notifyAlerta } = require('../services/telegram');
const { grabarMensaje } = require('../services/bot');
const { responderConAsistente } = require('../services/assistant');
const { solicitarAsistenciaHumana } = require('../services/tools');
const { detectarGuardia } = require('../lib/guardia-sanitaria');
const { detectarEscaladoDirecto } = require('../lib/fallback');

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
          // #V44: si falla algo que no pasa por obtenerRespuestaBot
          // (envío/grabación opuesta al LLM), el mostrador también se entera.
          notifyAlerta({ telefono: msg.from, error: err?.message || String(err) }).catch(() => {});
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

  // #V51 · El acuse de lectura es cosmético: no bloqueamos el turno del LLM
  // esperando el round-trip a Meta (fire-and-forget con log de fallo).
  markMessageRead(msg.waMessageId, msg.phoneNumberId).catch((err) => {
    console.warn('[webhook] markMessageRead:', err?.message || err);
  });
  const { estado } = await ensureCliente(msg.from);

  if (estado?.estado && estado.estado !== 'bot_activo') {
    console.log(`[handoff] bot silenciado (${estado.estado}) para ${msg.from}`);
    if (msg.text) {
      await grabarMensaje(msg.from, 'usuario', msg.text, 'whatsapp');
    }
    return;
  }

  if (msg.text) {
    await maybePersistProfileFromText(msg.from, msg.text);
    await grabarMensaje(msg.from, 'usuario', msg.text, 'whatsapp');
  }

  // #V46 · Guardia sanitaria determinista: el handoff clínico no depende del
  // modelo. Urgencias/dosis/interacciones/clínica sensible → operador humano.
  const guardia = detectarGuardia(msg.text);
  if (guardia) {
    await solicitarAsistenciaHumana(
      { telefono_cliente: msg.from, motivo: guardia.motivo },
      msg.from,
      { causa: 'guardia' }
    );
    await sendWhatsAppText(msg.from, guardia.acuse, msg.phoneNumberId);
    await grabarMensaje(msg.from, 'asistente', guardia.acuse, 'whatsapp');
    return;
  }

  // #V53 · Escalado determinista por intención del cliente (independiente del
  // modelo): petición expresa de persona, reclamos/cobros sensibles o
  // frustración. El fallback por reiteración se decide en ai.js (necesita la
  // clasificación de intent). Revertible con BOT_INTENTS=0.
  const escalado = config.intents.enabled ? detectarEscaladoDirecto(msg.text) : null;
  if (escalado) {
    await solicitarAsistenciaHumana(
      { telefono_cliente: msg.from, motivo: escalado.motivo },
      msg.from,
      { causa: escalado.causa }
    );
    await sendWhatsAppText(msg.from, escalado.acuse, msg.phoneNumberId);
    await grabarMensaje(msg.from, 'asistente', escalado.acuse, 'whatsapp');
    return;
  }

  const reply = await obtenerRespuestaBot(msg);

  if (reply) {
    await sendWhatsAppText(msg.from, reply, msg.phoneNumberId);
    await grabarMensaje(msg.from, 'asistente', reply, 'whatsapp');
  }
}

// ----------
// #V44 · Contingencia ante fallos: el cliente JAMÁS queda en silencio.
// Cualquier error al generar/enviar la respuesta del bot → mensaje breve al
// cliente + alerta al mostrador (Telegram). Antispam: máx 1 contingencia por
// cliente cada CONTINGENCIA_MS (los reintentos del MISMO mensaje ya no llegan
// aquí porque claimWebhookEvent los deduplica).
// ----------
const MSJ_CONTINGENCIA =
  'Disculpa, tuvimos un problema técnico y no pude responder ahora. 😔 Escríbenos de nuevo en unos minutos o pide hablar con una persona y te atiende el equipo de la farmacia.';

const CONTINGENCIA_MS = 5 * 60 * 1000;
const ultimaContingencia = new Map(); // telefono -> timestamp

function puedeContingencia(telefono) {
  const ahora = Date.now();
  const prev = ultimaContingencia.get(telefono) || 0;
  if (ahora - prev < CONTINGENCIA_MS) return false;
  ultimaContingencia.set(telefono, ahora);
  if (ultimaContingencia.size > 500) {
    for (const [tel, ts] of ultimaContingencia) {
      if (ahora - ts > CONTINGENCIA_MS * 4) ultimaContingencia.delete(tel);
    }
  }
  return true;
}

// genera la respuesta del bot (guardia/intención viva de responderConAsistente)
// o lanza contingencia ante cualquier error; devuelve texto para enviar al cliente o null.
async function obtenerRespuestaBot(msg) {
  try {
    return await responderConAsistente({
      telefono: msg.from,
      texto: msg.text || '',
    });
  } catch (err) {
    console.error('[webhook] fallo del bot para', msg.from, err);
    notifyAlerta({ telefono: msg.from, error: err?.message || String(err) }).catch(() => {});
    if (!msg.text) return null;
    if (!puedeContingencia(msg.from)) return null;
    try {
      await sendWhatsAppText(msg.from, MSJ_CONTINGENCIA, msg.phoneNumberId);
      await grabarMensaje(msg.from, 'asistente', MSJ_CONTINGENCIA, 'whatsapp');
    } catch (errEnvio) {
      console.error('[webhook] contingencia también falló', errEnvio);
    }
    return null;
  }
}

module.exports = router;
