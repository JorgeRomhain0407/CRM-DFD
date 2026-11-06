'use strict';

function toE164(raw, defaultCountryPrefix = '+34') {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  const prefix = defaultCountryPrefix.startsWith('+')
    ? defaultCountryPrefix
    : `+${defaultCountryPrefix}`;
  if (digits.startsWith(prefix.slice(1))) return `+${digits}`;
  return `${prefix}${digits}`;
}

function assertE164(telefono) {
  if (!telefono || !/^\+[1-9][0-9]{7,14}$/.test(telefono)) {
    const err = new Error('Teléfono inválido. Usa formato internacional E.164 (ej. +34600111222).');
    err.statusCode = 400;
    throw err;
  }
  return telefono;
}

// #V92 · Normaliza un teléfono como lo teclea el mostrador venezolano:
//   "0424-123.45.67" → "+584241234567"
//   "4241234567"      → "+584241234567"
//   "58 424…"         → "+584241234567"
//   "+58 0424…"       → "+584241234567"
//   "0058 424…"       → "+584241234567"
// Los números con "+" de otros países se respetan (solo se limpia un 0 tras
// el 58). Devuelve null si no es un número plausible: NUNCA se inventan datos.
function normalizarTelefonoVenezuela(raw) {
  if (raw === null || raw === undefined) return null;
  const original = String(raw).trim();
  if (!original) return null;

  const explicito = original.startsWith('+') || original.startsWith('00');
  let d = original.replace(/\D/g, '');
  if (!d) return null;
  if (original.startsWith('00')) d = d.slice(2);
  if (d.startsWith('58') && d[2] === '0') d = '58' + d.slice(3);
  else if (!explicito && d.startsWith('0')) d = '58' + d.slice(1);
  else if (!explicito && d.length === 10 && /^[24]/.test(d)) d = '58' + d;

  const e164 = explicito || d.startsWith('58') ? `+${d}` : null;
  return e164 && /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}

module.exports = { toE164, assertE164, normalizarTelefonoVenezuela };
