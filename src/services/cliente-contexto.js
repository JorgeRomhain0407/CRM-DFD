'use strict';

// ---------------------------------------------------------------
// #V30 — Datos no estructurados ágiles: capa de servicio Node.
// Cables los 2 RPCs de #V30 (registrar_evento_cliente /
// contexto_cliente_snapshot) sin acoplar a Supabase directo.
// ---------------------------------------------------------------
const { rpc } = require('../lib/supabase');
const { assertE164 } = require('../lib/phone');

/**
 * Fire-and-forget: registra un evento en la cola APPEND-ONLY.
 * NUNCA lanza: si la analítica falla, la conversación sigue (patrón §4).
 *
 * @param {string} telefono  E.164 obligatorio.
 * @param {string} tipo      Uno de los CHECK del enum (mensaje_usuario, tool_call, ...).
 * @param {object} payload   JSON serializable; SIN PII (solo {rol, canal, chars}).
 */
function registrarEvento(telefono, tipo, payload = {}) {
  try {
    assertE164(telefono);
  } catch {
    return; // teléfono inválido: no rompemos el bot, simplemente no registramos.
  }
  rpc('registrar_evento_cliente', {
    p_telefono: telefono,
    p_tipo: tipo,
    p_payload: payload,
  }).catch((err) => {
    console.error('[v30-cliente-contexto] evento no registrado:', tipo, err.message);
  });
}

/**
 * 1 round-trip: snapshot {cliente, estado, eventos[≤N]} para que el bot
 * no re-lea N mensajes crudos. Objetivo p95 < 300 ms (bench §7).
 *
 * @param {string} telefono E.164 obligatorio.
 * @returns {Promise<object>} Snapshot JSONB ya parseado.
 */
async function snapshotContexto(telefono) {
  assertE164(telefono);
  return rpc('contexto_cliente_snapshot', { p_telefono: telefono });
}

module.exports = { registrarEvento, snapshotContexto };
