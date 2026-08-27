'use strict';

const crypto = require('crypto');
const config = require('../config');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

function timingSafeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
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
  return timingSafeEqual(header, expected);
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

module.exports = { verifyMetaSignature, sendWhatsAppText, markMessageRead };
