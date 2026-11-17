'use strict';

/*
 * Envío de prueba por WhatsApp Cloud API usando las credenciales del .env.
 *
 * Uso (desde la raíz del proyecto):
 *   node scripts/enviar-whatsapp.js 584241234567 "Hola, prueba del CRM"
 *   node scripts/enviar-whatsapp.js 584241234567 --template hello_world --lang en_US
 *   node scripts/enviar-whatsapp.js 34687502302 --template pedido_listo --vars "María"
 *   node scripts/enviar-whatsapp.js 584241234567 "Hola" --id 123456789012345
 *
 * - Sin --template manda texto libre: SOLO válido si el cliente escribió en las
 *   últimas 24 h (ventana de servicio). Fuera de esa ventana Meta lo rechaza.
 * - Con --template manda una plantilla aprobada (sirve fuera de la ventana).
 *   --vars recibe las variables del cuerpo separadas por comas, en orden
 *   (para `{{1}}`, `{{2}}`…).
 * - El teléfono va en formato internacional sin '+' ni espacios (58424...).
 * - Imprime la respuesta de Meta o el error completo para diagnosticar.
 */

require('dotenv').config();

const config = require('../src/config');
const { sendWhatsAppText, sendWhatsAppTemplate } = require('../src/lib/meta');

function normalizarTelefono(raw) {
  const s = String(raw || '').replace(/[^\d]/g, '');
  if (!s) throw new Error('Falta el teléfono destino (ej. 584241234567).');
  return s;
}

const CON_VALOR = new Set(['template', 'lang', 'id', 'vars']);

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

async function main() {
  const { opciones, posicionales } = parsearArgs(process.argv.slice(2));
  const to = normalizarTelefono(posicionales[0]);
  const plantilla = opciones.template;
  const idioma = opciones.lang || 'es';
  const variables = String(opciones.vars || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const texto = posicionales.slice(1).join(' ') || 'Mensaje de prueba del CRM DFD.';
  const phoneNumberId = opciones.id || config.meta.phoneNumberId;

  console.log(
    `Enviando ${
      plantilla ? `plantilla "${plantilla}" (${idioma}, ${variables.length} vars)` : 'texto libre'
    } a +${to} …`
  );
  console.log(`Desde Phone Number ID: ${phoneNumberId}`);

  const json = plantilla
    ? await sendWhatsAppTemplate(`+${to}`, plantilla, {
        languageCode: idioma,
        bodyParams: variables,
        phoneNumberId,
      })
    : await sendWhatsAppText(`+${to}`, texto, phoneNumberId);

  const id = json.messages?.[0]?.id;
  console.log(`OK — Meta aceptó el mensaje${id ? ` (id ${id})` : ''}.`);
  console.log(JSON.stringify(json, null, 2));
}

main().catch((err) => {
  console.error(`FALLO: ${err.message || err}`);
  if (err.details) console.error(JSON.stringify(err.details, null, 2));
  process.exit(1);
});
