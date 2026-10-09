'use strict';

// #V30/#V47 · Capa de eventos del cliente (fire-and-forget, jamás bloquea el
// flujo del bot). Usa las RPCs ya desplegadas en Supabase:
//   - registrar_evento_cliente(p_telefono, p_tipo, p_payload) -> uuid
//   - contexto_cliente_snapshot(p_telefono) -> { estado, cliente, eventos }
// Tabla: cliente_eventos (append-only, CHECK de tipos) + clientes.perfil JSONB
// + estado_chat.contexto_bot JSONB (ventana rodante del bot).
//
// Regla anti-PII (AGENTS.md): NUNCA guardar texto del cliente ni contenido de
// mensajes en el payload. Solo canales, longitudes, flags, ids y categorías.
// La ventana rodante (contexto_bot) contiene contenido recortado: es memoria
// interna del bot para el retomado tras handoff, no se expone al panel.

const { getSupabase } = require('../lib/supabase');

const TIPO_MENSAJE = {
  usuario: 'mensaje_usuario',
  asistente: 'mensaje_asistente',
  operador: 'mensaje_operador',
};

const VENTANA_MAX = 20;
const INTENTS_MAX = 10;

async function registrarEvento(telefono, tipo, payload = {}) {
  try {
    const { error } = await getSupabase().rpc('registrar_evento_cliente', {
      p_telefono: telefono,
      p_tipo: tipo,
      p_payload: payload,
    });
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[cliente-contexto] evento no registrado:', err.code || '', String(err.message || '').slice(0, 120));
    return false;
  }
}

// Ventana rodante: read-modify-write en estado_chat.contexto_bot. Suficiente
// para el volumen de WhatsApp mostrador; si dos turnos se cruzan se puede
// perder una entrada vieja de la ventana — tolerable (append-only eventos
// mantiene la verdad completa).
async function actualizarVentana(telefono, rol, contenido) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('estado_chat')
    .select('contexto_bot')
    .eq('telefono_cliente', telefono)
    .maybeSingle();
  const actual = data?.contexto_bot || {};
  const ventana = Array.isArray(actual.ventana) ? actual.ventana : [];
  ventana.push({ r: rol, c: String(contenido || '').slice(0, 160), t: Date.now() });
  while (ventana.length > VENTANA_MAX) ventana.shift();
  const { error } = await supabase
    .from('estado_chat')
    .update({ contexto_bot: { ...actual, ventana } })
    .eq('telefono_cliente', telefono);
  if (error) throw error;
}

// #V52 · Memoria del hilo: read-modify-write en estado_chat.contexto_bot para
// acumular los últimos intents detectados y un contador por intent. Igual que la
// ventana, es tolerante a carreras (la verdad completa vive en cliente_eventos).
async function registrarIntent(telefono, intent) {
  if (!intent) return false;
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('estado_chat')
      .select('contexto_bot')
      .eq('telefono_cliente', telefono)
      .maybeSingle();
    const actual = data?.contexto_bot || {};
    const ultimos = Array.isArray(actual.ultimos_intents) ? actual.ultimos_intents.slice() : [];
    ultimos.push(intent);
    while (ultimos.length > INTENTS_MAX) ultimos.shift();
    const contadores = actual.contadores && typeof actual.contadores === 'object'
      ? { ...actual.contadores }
      : {};
    contadores[intent] = (Number(contadores[intent]) || 0) + 1;
    const { error } = await supabase
      .from('estado_chat')
      .update({ contexto_bot: { ...actual, ultimos_intents: ultimos, contadores } })
      .eq('telefono_cliente', telefono);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[cliente-contexto] intent no registrado:', String(err.message || '').slice(0, 120));
    return false;
  }
}

// Hook para grabarMensaje de src/services/bot.js — llamado sin await.
async function registrarMensaje(telefono, rol, contenido, canal) {
  const tipo = TIPO_MENSAJE[rol];
  if (!tipo) return;
  await registrarEvento(telefono, tipo, { canal, chars: String(contenido || '').length });
  try {
    await actualizarVentana(telefono, rol, contenido);
  } catch (err) {
    console.warn('[cliente-contexto] ventana no actualizada:', String(err.message || '').slice(0, 120));
  }
}

async function registrarTool(telefono, tool, ok) {
  await registrarEvento(telefono, 'tool_call', { tool, ok: Boolean(ok) });
}

async function registrarProductoVisto(telefono, idProducto) {
  if (!idProducto) return;
  await registrarEvento(telefono, 'producto_visto', { id_producto: String(idProducto) });
}

async function registrarCarrito(telefono, accion, ok) {
  await registrarEvento(telefono, 'carrito_accion', { accion, ok: Boolean(ok) });
}

async function registrarCompra(telefono) {
  await registrarEvento(telefono, 'compra', { ok: true });
}

async function registrarHandoff(telefono, motivoLen) {
  // motivo NOT guardado completo (anti-PII): solo longitud y flag.
  await registrarEvento(telefono, 'handoff', { motivo_len: Number(motivoLen) || 0 });
}

// #V51 · Telemetría de latencia/uso por turno del bot. Anti-PII: solo números y
// nombres de herramientas (definidas en openai-tools.json), nunca contenido.
async function registrarRespuestaBot(telefono, { latency_ms, tools, iterations, handoff, intent } = {}) {
  await registrarEvento(telefono, 'bot_respuesta', {
    latency_ms: Number(latency_ms) || 0,
    tools: Array.isArray(tools) ? tools.slice(0, 10) : [],
    iterations: Number(iterations) || 0,
    handoff: Boolean(handoff),
    intent: intent ? String(intent).slice(0, 20) : null,
  });
}

// #V30 · 1 round-trip: snapshot {cliente, estado, eventos[≤30]} vía RPC
// contexto_cliente_snapshot. Meta p95 < 300 ms (scripts/bench-v30.js).
async function snapshotContexto(telefono) {
  const { data, error } = await getSupabase().rpc('contexto_cliente_snapshot', {
    p_telefono: telefono,
  });
  if (error) throw error;
  return data;
}

module.exports = {
  registrarEvento,
  registrarMensaje,
  registrarTool,
  registrarProductoVisto,
  registrarCarrito,
  registrarCompra,
  registrarHandoff,
  registrarRespuestaBot,
  registrarIntent,
  snapshotContexto,
  VENTANA_MAX,
};
