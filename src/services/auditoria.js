'use strict';

// #V60 (D04/R5 · #V56) · Auditoría de mutaciones sensibles (append-only).
// Registra QUIÉN hizo QUÉ sobre qué entidad y cuándo, en la tabla `auditoria`
// (solo `service_role`). Es "fail-soft": si el registro falla NUNCA debe tumbar
// la operación de negocio; se anota en stderr y se sigue.
//
// No se guardan valores sensibles (contraseñas, tokens, PII completa): a lo sumo
// los NOMBRES de los campos modificados (`detalle.campos`).

const { getSupabase } = require('../lib/supabase');

async function registrarAuditoria({
  accion,
  entidad,
  entidadId = null,
  campos = null,
  usuario = null,
  ip = null,
} = {}) {
  try {
    const detalle = campos ? { campos } : null;
    const { error } = await getSupabase().from('auditoria').insert({
      accion,
      entidad,
      entidad_id: entidadId == null ? null : String(entidadId),
      detalle,
      usuario_id: usuario?.id || null,
      usuario_nombre: usuario?.usuario || null,
      ip,
    });
    if (error) throw error;
  } catch (e) {
    console.error('[auditoria] no se pudo registrar:', e.message);
  }
}

module.exports = { registrarAuditoria };
