'use strict';

// #V53 · Fallback y escalado multicapa (determinista, SIN LLM).
// Cubre 6 y 7 de las 12 consideraciones de la skill `chatbot-flow-design`:
//   - Fallback multicapa: aclarar (1ª vez) → sugerir (2ª) → escalar (3ª).
//   - Triggers de escalado: usuario, sensible (reclamos/cobros), frustración y
//     fallback repetido. El clínico lo cubre la guardia sanitaria (#V46).
// Puro: sin fs, sin red, sin Supabase → testeable con `node scripts/test-fallback.js`.
// Regla de oro (skill): una sola aclaración; a la segunda, sugerir; a la tercera,
// derivar. Nunca dejar al cliente en un bucle de "no entiendo".

const { normalizar } = require('./intents');

// Escalado inmediato (Layer 4 por adelantado). Listas CONSERVADORAS para no
// interrumpir ventas normales; ampliar solo con evidencia de QA (D03).
const RE_USUARIO =
  /\b(hablar con (?:una persona|alguien|un humano|un encargado|el encargado|atencion al cliente|la farmacia|un responsable)|quiero (?:hablar con|una persona|que me (?:atienda|llame|escriba) (?:una persona|alguien))|ponme con|pasame con|derivame (?:con|a)|persona real|alguien de (?:la farmacia|verdad)|agente humano)\b/i;

const RE_SENSIBLE =
  /\b(reclamaci\w*|reclamar|poner una queja|queja|denuncia|hoja de reclamaciones|me (?:habeis|han) cobrado|cobro indebido|me cobraron de mas|estafa|fraude|devolucion|devolverme (?:el dinero|el importe))\b/i;

const RE_FRUSTRACION =
  /\b(no me (?:entiendes|entiende|estas entendiendo)|no sirves|eres un bot|no eres (?:una persona|humano)|esto no funciona|no funciona nada|otra vez (?:lo mismo|igual)|estoy (?:harto|harta|enfadad\w*|molest\w*|cabread\w*)|vaya (?:mierda|porqueria)|pesimo|horrible|inutil)\b/i;

const ACUSE_USUARIO =
  'Claro 😊 Te paso ahora mismo con una persona del equipo de la farmacia; te escribe por este mismo chat en unos minutos.';
const ACUSE_SENSIBLE =
  'Entiendo, y esto merece que lo vea una persona. Ya aviso al equipo de la farmacia para que te atienda por aquí en unos minutos.';
const ACUSE_FRUSTRACION =
  'Siento que no estemos dando con lo que necesitas. Te paso con una persona del equipo para que te ayude directamente por este chat.';
const ACUSE_REPETIDO =
  'No quiero hacerte repetir. Te paso con una persona del equipo de la farmacia para que te ayude por aquí mismo en unos minutos.';

// Devuelve { causa, acuse, motivo } o null. Se consulta en el webhook ANTES del
// LLM, igual que la guardia sanitaria.
function detectarEscaladoDirecto(texto) {
  const t = normalizar(texto);
  if (!t) return null;
  if (RE_USUARIO.test(t)) {
    return {
      causa: 'usuario',
      acuse: ACUSE_USUARIO,
      motivo: 'El cliente pidió expresamente hablar con una persona.',
    };
  }
  if (RE_SENSIBLE.test(t)) {
    return {
      causa: 'sensible',
      acuse: ACUSE_SENSIBLE,
      motivo: 'Reclamación/cobro: tema sensible que debe atender una persona.',
    };
  }
  if (RE_FRUSTRACION.test(t)) {
    return {
      causa: 'frustracion',
      acuse: ACUSE_FRUSTRACION,
      motivo: 'El cliente muestra frustración; se deriva para no hacerle repetir.',
    };
  }
  return null;
}

// Capa de fallback para un intent poco claro: 'ninguna' | 'aclarar' | 'sugerir'
// | 'escalar'. La racha (`fallbackSeguidos`) viene de estado_chat.contexto_bot.
function capaFallback({ intent, confianza, fallbackSeguidos = 0 } = {}) {
  if (intent !== 'general' || confianza !== 'baja') return 'ninguna';
  const racha = Number(fallbackSeguidos) || 0;
  if (racha >= 2) return 'escalar';
  if (racha === 1) return 'sugerir';
  return 'aclarar';
}

module.exports = {
  detectarEscaladoDirecto,
  capaFallback,
  ACUSE_USUARIO,
  ACUSE_SENSIBLE,
  ACUSE_FRUSTRACION,
  ACUSE_REPETIDO,
};
