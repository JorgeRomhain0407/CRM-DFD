'use strict';

const { getSupabase } = require('../lib/supabase');
const { assertE164 } = require('../lib/phone');

async function getBotConfig() {
  const { data, error } = await getSupabase()
    .from('bot_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function updateBotConfig({ bot_nombre, system_prompt, temperatura }) {
  const payload = {};
  if (bot_nombre !== undefined) {
    payload.bot_nombre = String(bot_nombre).trim().slice(0, 100) || 'Berta';
  }
  if (system_prompt !== undefined) {
    payload.system_prompt = String(system_prompt).trim();
  }
  if (temperatura !== undefined) {
    const t = Number(temperatura);
    if (isNaN(t) || t < 0 || t > 2) {
      const err = new Error('Temperatura inválida (0-2).');
      err.statusCode = 400;
      throw err;
    }
    payload.temperatura = t;
  }

  const { data, error } = await getSupabase()
    .from('bot_config')
    .upsert({ id: 1, ...payload, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getConversaciones() {
  const { data, error } = await getSupabase()
    .from('clientes')
    .select(`
      telefono, nombre,
      estado_chat ( estado, motivo_handoff, ultima_actualizacion ),
      mensajes ( id, rol, contenido, created_at, canal )
    `)
    .order('fecha_registro', { ascending: false })
    .limit(100);
  if (error) throw error;

  const conversaciones = (data || [])
    .filter((c) => Array.isArray(c.mensajes) && c.mensajes.length > 0)
    .map((c) => {
      const ultimo = c.mensajes[c.mensajes.length - 1];
      return {
        telefono: c.telefono,
        nombre: c.nombre || c.telefono,
        estado: c.estado_chat?.estado || 'bot_activo',
        motivo_handoff: c.estado_chat?.motivo_handoff || null,
        ultimo_mensaje: ultimo.contenido,
        ultimo_rol: ultimo.rol,
        ultima_actualizacion: ultimo.created_at,
        mensajes: c.mensajes,
      };
    })
    .sort((a, b) => new Date(b.ultima_actualizacion) - new Date(a.ultima_actualizacion));

  return conversaciones;
}

async function getConversacion(telefono) {
  assertE164(telefono);
  const { data: cliente, error } = await getSupabase()
    .from('clientes')
    .select('telefono, nombre, estado_chat ( * )')
    .eq('telefono', telefono)
    .maybeSingle();
  if (error) throw error;

  const { data: mensajes, error: mError } = await getSupabase()
    .from('mensajes')
    .select('id, rol, contenido, canal, created_at')
    .eq('telefono_cliente', telefono)
    .order('created_at', { ascending: true })
    .limit(500);
  if (mError) throw mError;

  return {
    telefono,
    nombre: cliente?.nombre || telefono,
    estado: cliente?.estado_chat?.estado || 'bot_activo',
    motivo_handoff: cliente?.estado_chat?.motivo_handoff || null,
    mensajes: mensajes || [],
  };
}

async function grabarMensaje(telefono, rol, contenido, canal = 'whatsapp') {
  assertE164(telefono);
  const { error } = await getSupabase().from('mensajes').insert({
    telefono_cliente: telefono,
    rol,
    contenido: String(contenido || ''),
    canal,
  });
  if (error) throw error;
}

module.exports = {
  getBotConfig,
  updateBotConfig,
  getConversaciones,
  getConversacion,
  grabarMensaje,
};
