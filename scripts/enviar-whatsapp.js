'use strict';

/*
 * Envío de prueba por WhatsApp Cloud API usando las credenciales del .env.
 *
 * Uso (desde la raíz del proyecto):
 *   node scripts/enviar-whatsapp.js 584241234567 "Hola, prueba del CRM"
 *   node scripts/enviar-whatsapp.js 584241234567 --template hello_world --lang en_US
 *   node scripts/enviar-whatsapp.js 584241234567 "Hola" --id 123456789012345
 *
 * - Sin --template manda texto libre: SOLO válido si el cliente escribió en las
 *   últimas 24 h (ventana de servicio). Fuera de esa ventana Meta lo rechaza.
 * - Con --template manda una plantilla aprobada (sirve fuera de la ventana).
 * - El teléfono va en formato internacional sin '+' ni espacios (58424...).
 * - Imprime la respuesta de Meta o el error completo para diagnosticar.
 */

require('dotenv').config();

const config = require('../src/config');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

function normalizarTelefono(raw) {
  const s = String(raw || '').replace(/[^\d]/g, '');
  if (!s) throw new Error('Falta el teléfono destino (ej. 584241234567).');
  return s;
}

const CON_VALOR = new Set(['template', 'lang', 'id']);

function parsearArgs(argv) {
  const opciones = {};
  const posicionales = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [nombre, valorIgual] = arg.slice(2).split('=', 2);
      if (CON_VALOR.has(nombre)) {
        opciones[nombre] = valorIgual !== undefined ? valorIgual : argv[++i];
      } else {
        opciones[nombre] = true;
      }
    } else {
      posicionales.push(arg);
    }
  }
  return { opciones, posicionales };
}

async function enviar({ to, texto, plantilla, idioma, phoneNumberId }) {
  if (!config.meta.accessToken) throw new Error('Falta META_ACCESS_TOKEN en .env');
  if (!phoneNumberId) throw new Error('Falta WHATSAPP_PHONE_NUMBER_ID en .env (o pasa --id).');

  const cuerpo = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    ...(plantilla
      ? { type: 'template', template: { name: plantilla, language: { code: idioma } } }
      : { type: 'text', text: { preview_url: false, body: texto } }),
  };

  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.meta.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `Graph API ${res.status}`);
    err.details = json;
    throw err;
  }
  return json;
}

async function main() {
  const { opciones, posicionales } = parsearArgs(process.argv.slice(2));
  const to = normalizarTelefono(posicionales[0]);
  const plantilla = opciones.template;
  const idioma = opciones.lang || 'es';
  const texto = posicionales.slice(1).join(' ') || 'Mensaje de prueba del CRM DFD.';
  const phoneNumberId = opciones.id || config.meta.phoneNumberId;

  console.log(`Enviando ${plantilla ? `plantilla "${plantilla}" (${idioma})` : 'texto libre'} a +${to} …`);
  console.log(`Desde Phone Number ID: ${phoneNumberId}`);

  const json = await enviar({ to, texto, plantilla, idioma, phoneNumberId });
  const id = json.messages?.[0]?.id;
  console.log(`OK — Meta aceptó el mensaje${id ? ` (id ${id})` : ''}.`);
  console.log(JSON.stringify(json, null, 2));
}

main().catch((err) => {
  console.error(`FALLO: ${err.message || err}`);
  if (err.details) console.error(JSON.stringify(err.details, null, 2));
  process.exit(1);
});
