'use strict';

const { getSupabase, rpc } = require('../lib/supabase');
const { assertE164 } = require('../lib/phone');

async function ensureCliente(telefono, extras = {}) {
  const phone = assertE164(telefono);
  const supabase = getSupabase();
  const { error: insertError } = await supabase
    .from('clientes')
    .upsert({ telefono: phone }, { onConflict: 'telefono', ignoreDuplicates: true });
  if (insertError) throw insertError;

  const cleanExtras = Object.fromEntries(
    Object.entries(extras).filter(([, value]) => value !== undefined)
  );
  if (Object.keys(cleanExtras).length) {
    const { error } = await supabase.from('clientes').update(cleanExtras).eq('telefono', phone);
    if (error) throw error;
  }

  const { error: estadoError } = await supabase.from('estado_chat').upsert(
    { telefono_cliente: phone },
    { onConflict: 'telefono_cliente', ignoreDuplicates: true }
  );
  if (estadoError) throw estadoError;

  return getClienteConEstado(phone);
}

async function getClienteConEstado(telefono) {
  const supabase = getSupabase();
  const { data: cliente, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('telefono', telefono)
    .maybeSingle();
  if (error) throw error;

  const { data: estado, error: estadoError } = await supabase
    .from('estado_chat')
    .select('*')
    .eq('telefono_cliente', telefono)
    .maybeSingle();
  if (estadoError) throw estadoError;

  return { cliente, estado };
}

async function maybePersistProfileFromText(telefono, text) {
  const { cliente } = await getClienteConEstado(telefono);
  const updates = {};
  if (!cliente?.nombre) {
    const named = text.match(/(?:me llamo|soy|mi nombre es)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\- ]{1,60})/i);
    if (named) updates.nombre = named[1].trim().replace(/[.,;!?]+$/, '');
  }
  if (cliente?.edad == null) {
    const aged = text.match(/(?:tengo|edad)\s+(\d{1,3})\s*años?/i);
    if (aged) {
      const edad = Number(aged[1]);
      if (edad >= 0 && edad <= 120) updates.edad = edad;
    }
  }
  if (Object.keys(updates).length) {
    const { error } = await getSupabase().from('clientes').update(updates).eq('telefono', telefono);
    if (error) throw error;
  }
}

async function claimWebhookEvent(waMessageId) {
  if (!waMessageId) return true;
  const { error } = await getSupabase().from('webhook_events').insert({ wa_message_id: waMessageId });
  if (error && error.code === '23505') return false;
  if (error) throw error;
  return true;
}

module.exports = {
  ensureCliente,
  getClienteConEstado,
  maybePersistProfileFromText,
  claimWebhookEvent,
};
