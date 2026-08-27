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

module.exports = { toE164, assertE164 };
