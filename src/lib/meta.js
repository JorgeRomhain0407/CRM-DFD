'use strict';

const crypto = require('crypto');
const config = require('../config');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

// #V60 (D04/R4) · Comparación en tiempo constante. Se calcula el HMAC de ambos
// lados con una clave aleatoria por proceso, de forma que SIEMPRE se comparan
// dos buffers de 32 bytes: no hay cortocircuito por longitud (el helper anterior
// devolvía en cuanto las longitudes diferían, filtrando el tamaño del secreto).
const COMPARE_KEY = crypto.randomBytes(32);
function secureCompare(a, b) {
  const ha = crypto.createHmac('sha256', COMPARE_KEY).update(String(a ?? '')).digest();
  const hb = crypto.createHmac('sha256', COMPARE_KEY).update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function verifyMetaSignature(req) {
  if (!config.meta.appSecret) {
    if (config.isProd) return false;
    console.warn('[meta] META_APP_SECRET ausente: se omite la verificación de firma (solo desarrollo).');
    return true;
  }
  const header = req.get('x-hub-signature-256');
  if (!header || !header.startsWith('sha256=')) return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', config.meta.appSecret).update(req.rawBody || Buffer.from('')).digest('hex');
  return secureCompare(header, expected);
}

async function sendWhatsAppText(toE164, body, phoneNumberId = config.meta.phoneNumberId) {
  if (!config.meta.accessToken || !phoneNumberId) {
    throw new Error('Faltan META_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID.');
  }
  const to = String(toE164).replace(/^\+/, '');
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.meta.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `Graph API ${res.status}`);
    err.details = json;
    throw err;
  }
  return json;
}

async function markMessageRead(messageId, phoneNumberId = config.meta.phoneNumberId) {
  if (!config.meta.accessToken || !phoneNumberId || !messageId) return;
  await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.meta.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  }).catch(() => {});
}

module.exports = { verifyMetaSignature, sendWhatsAppText, markMessageRead, secureCompare };
