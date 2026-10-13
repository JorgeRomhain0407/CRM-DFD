'use strict';

// #V56 · Recomendación PROACTIVA (opt-in). Tras formalizar un pedido se ofrece
// UNA sugerencia ligera basada en el historial, respetando un antispam (por
// defecto 7 días) marcado en `estado_chat.contexto_bot.ultima_sugerencia`.
// Por defecto DESACTIVADA: activar con BOT_RECOMENDACIONES_PROACTIVAS=1.
// Fail-soft: cualquier fallo devuelve null y no afecta al acuse del pedido.

const config = require('../config');
const { getSupabase } = require('../lib/supabase');
const { getRecomendaciones } = require('./customers');

const MS_DIA = 24 * 60 * 60 * 1000;

async function sugerirProactivo(telefono) {
  if (!config.recomendaciones.proactivas) return null;
  const supabase = getSupabase();

  let ctx = {};
  try {
    const { data } = await supabase
      .from('estado_chat')
      .select('contexto_bot')
      .eq('telefono_cliente', telefono)
      .maybeSingle();
    ctx = (data && data.contexto_bot) || {};
  } catch {
    return null;
  }

  const dias = Number(config.recomendaciones.proactivasDias) || 7;
  const ultima = ctx.ultima_sugerencia ? Date.parse(ctx.ultima_sugerencia) : 0;
  if (ultima && Date.now() - ultima < dias * MS_DIA) return null;

  let recs = [];
  try {
    recs = await getRecomendaciones(telefono);
  } catch {
    return null;
  }
  const pick = recs.filter((r) => Number(r.stock) > 0).slice(0, 2);
  if (!pick.length) return null;

  try {
    await supabase
      .from('estado_chat')
      .update({ contexto_bot: { ...ctx, ultima_sugerencia: new Date().toISOString() } })
      .eq('telefono_cliente', telefono);
  } catch {
    return null;
  }

  const nombres = pick.map((r) => r.nombre).join(' y ');
  return `Por cierto, según lo que sueles comprar quizá te venga bien: ${nombres}. ¿Te lo añado o te muestro el precio? 🙂`;
}

module.exports = { sugerirProactivo };
