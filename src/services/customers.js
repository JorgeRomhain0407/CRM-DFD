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

const NOMBRE_PATTERN = /(?:me llamo|soy|mi nombre es)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\- ]{1,60})/i;

const NOMBRE_BLOCKLIST = new Set([
  'si', 'no', 'ok', 'vale', 'hola', 'gracias', 'buenos', 'buenas', 'quiero',
  'necesito', 'dame', 'compra', 'busca', 'busco', 'precio', 'hay', 'tengo',
  'tienes', 'tiene', 'comprar', 'me', 'mas', 'más', 'otra', 'algo', 'eso',
]);

const NOMBRE_INTENTO = new Set(['quiero', 'necesito', 'dame', 'comprar', 'busco', 'busca', 'precio']);

async function ultimoMensajeAsistente(telefono) {
  const { data, error } = await getSupabase()
    .from('mensajes')
    .select('contenido')
    .eq('telefono_cliente', telefono)
    .eq('rol', 'asistente')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.contenido || null;
}

function extraerNombreLibre(text) {
  const t = String(text || '')
    .trim()
    .replace(/[.,;!?]+$/, '')
    .trim();
  if (!t || /\d/.test(t) || t.length < 2 || t.length > 60) return null;
  if (t.includes(',')) return null;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length > 4) return null;
  if (tokens.some((tk) => tk.length < 2)) return null;
  const first = tokens[0].toLowerCase();
  if (NOMBRE_BLOCKLIST.has(first) || NOMBRE_INTENTO.has(first)) return null;
  if (tokens.length === 1 && first.length < 3) return null;
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\- ]+$/.test(t)) return null;
  return t;
}

async function maybePersistProfileFromText(telefono, text) {
  const { cliente } = await getClienteConEstado(telefono);
  const updates = {};
  if (!cliente?.nombre) {
    const named = text.match(NOMBRE_PATTERN)
      ? text.match(NOMBRE_PATTERN)[1].trim().replace(/[.,;!?]+$/, '')
      : null;
    if (!named) {
      const previo = await ultimoMensajeAsistente(telefono);
      if (/nomb|llamas|decirme qui[eé]n|qu[eé]n eres/i.test(previo || '')) {
        updates.nombre = extraerNombreLibre(text);
      }
    }
    if (named) updates.nombre = named;
  }
  if (cliente?.edad == null) {
    const aged = text.match(/(?:tengo|edad)?\s*(\d{1,3})\s*años/i);
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

async function hasPedidoConfirmado(telefono) {
  const { data, error } = await getSupabase()
    .from('carritos')
    .select('telefono_cliente')
    .eq('telefono_cliente', telefono)
    .in('estado', ['pedido', 'completado'])
    .limit(1);
  if (error) throw error;
  return (data?.length || 0) > 0;
}

async function tiposClientes(telefonos) {
  const unique = [...new Set((telefonos || []).filter(Boolean))];
  const tipos = {};
  if (!unique.length) return tipos;
  const { data, error } = await getSupabase()
    .from('carritos')
    .select('telefono_cliente')
    .in('telefono_cliente', unique)
    .in('estado', ['pedido', 'completado']);
  if (error) throw error;
  for (const row of data || []) tipos[row.telefono_cliente] = 'cliente';
  return tipos;
}

async function registrarHabitosConsumo(telefono) {
  const supabase = getSupabase();
  const { data: lineas, error: lineasError } = await supabase
    .from('carritos_temporales')
    .select('cantidad, productos ( nombre )')
    .eq('telefono_cliente', telefono);
  if (lineasError) throw lineasError;
  if (!lineas?.length) return;

  const nombres = lineas.map((l) => `${l.cantidad}x ${l.productos.nombre}`);
  const { data: cliente } = await supabase
    .from('clientes')
    .select('habitos_consumo')
    .eq('telefono', telefono)
    .maybeSingle();
  if (!cliente) return;

  const prev = String(cliente.habitos_consumo || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const final = [...nombres.filter((n) => !prev.includes(n)), ...prev].slice(0, 20);
  await supabase
    .from('clientes')
    .update({ habitos_consumo: final.join(', ').slice(0, 500) })
    .eq('telefono', telefono);
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
  hasPedidoConfirmado,
  tiposClientes,
  registrarHabitosConsumo,
  claimWebhookEvent,
};
