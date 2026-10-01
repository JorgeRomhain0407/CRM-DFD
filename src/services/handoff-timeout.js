'use strict';

// #V45 · Vigilante de handoffs: si un cliente quedó en esperando_operador y
// nadie lo toma en X minutos (config.handoffAlertaMinutos, default 30),
// re-alerta al mostrador por Telegram. Un chequeo por minuto va bien para
// detectar el cruce del umbral.
//
// Nota de diseño: el "ya re-alertado" se guarda en memoria (Map de
// -> silenciado_desde alertado). Tras un reinicio del proceso a lo sumo se
// duplica una re-alerta — tolerable y evita tocar el schema (#V47 lo
// registraría de forma persistente cuando exista).

const { getSupabase } = require('../lib/supabase');
const config = require('../config');
const { notifyAlerta } = require('./telegram');

let timer = null;
const alertados = new Map(); // telefono -> valor silenciado_desde ya alertado

async function revisarHandoffs() {
  const umbralMs = Math.max(1, config.handoffAlertaMinutos) * 60 * 1000;
  const { data, error } = await getSupabase()
    .from('estado_chat')
    .select('telefono_cliente, motivo_handoff, silenciado_desde, ultima_actualizacion')
    .eq('estado', 'esperando_operador')
    .not('silenciado_desde', 'is', null);
  if (error) throw error;

  const ahora = Date.now();
  for (const row of data || []) {
    const desde = new Date(row.silenciado_desde).getTime();
    if (!Number.isFinite(desde) || ahora - desde < umbralMs) continue;
    if (alertados.get(row.telefono_cliente) === row.silenciado_desde) continue;
    alertados.set(row.telefono_cliente, row.silenciado_desde);

    const minutos = Math.round((ahora - desde) / 60000);
    console.warn(`[handoff-timeout] ${row.telefono_cliente} sin atender desde hace ${minutos} min`);
    notifyAlerta({
      telefono: row.telefono_cliente,
      error: `Cliente en esperando_operador SIN atención ${minutos} min. ` +
        `Motivo: ${row.motivo_handoff || '—'}. Última actividad: ${row.ultima_actualizacion}.`,
    }).catch(() => {});
  }
}

function iniciarVigilanteHandoff() {
  if (timer) return;
  // Si la config trae un umbral grotesco (p. ej. < 1 min) igual se respeta:
  // el timer corre cada minuto.
  timer = setInterval(() => {
    revisarHandoffs().catch((err) => console.error('[handoff-timeout] revisión falló', err));
  }, 60 * 1000);
  timer.unref();
  console.log(
    `[handoff-timeout] Vigilante activo: re-alerta tras ${config.handoffAlertaMinutos} min sin atención.`
  );
}

function detenerVigilanteHandoff() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { iniciarVigilanteHandoff, detenerVigilanteHandoff, revisarHandoffs };
