'use strict';

const { getSupabase, rpc } = require('../lib/supabase');
const { assertE164 } = require('../lib/phone');
const { notifyHandoff } = require('./telegram');
const { registrarHabitosConsumo, construirPerfilConsumo, getRecomendaciones } = require('./customers');
const config = require('../config');
const { registrarCarrito, registrarCompra, registrarHandoff, marcarPedidoEsperandoNombre } = require('./cliente-contexto');
const { acumularPuntos, getSaldo } = require('./fidelizacion');
const {
  tokensQuery,
  medularDe,
  patronBaseDe,
  esPrecioBarato,
  rankearCandidatos,
} = require('../lib/busqueda');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// #V57 · Búsqueda de productos: candidatos + puntuación + orden + rotación en
// UNA sola RPC (`buscar_productos_bot`) = un round-trip. Si la RPC no está (p.
// ej. migración sin aplicar) se cae de forma transparente al camino JS clásico,
// que produce EXACTAMENTE el mismo resultado (es la referencia de paridad).
async function consultarPrecioYStock({ nombre_producto, orden_precio }, telefono) {
  const raw = String(nombre_producto || '').trim();
  if (raw.length < 2) {
    return { ok: false, mensaje: 'Indica un nombre de producto más concreto.' };
  }

  const tokens = tokensQuery(raw);
  if (!tokens.length) {
    return { ok: false, mensaje: 'Indica un nombre de producto más concreto.' };
  }

  const esBarato = esPrecioBarato(raw, orden_precio);

  if (config.busqueda.rpc) {
    try {
      const res = await rpc('buscar_productos_bot', {
        p_query: raw,
        p_telefono: telefono || null,
        p_es_barato: esBarato,
        p_top: 3,
      });
      if (res && typeof res === 'object') return res;
    } catch (err) {
      avisarCaidaRPC(err);
    }
  }

  return consultarPrecioYStockJS(raw, tokens, esBarato, telefono);
}

let rpcAvisado = false;
function avisarCaidaRPC(err) {
  if (rpcAvisado) return;
  rpcAvisado = true;
  console.warn(
    '[tools] buscar_productos_bot no disponible; uso el buscador JS:',
    err?.message || err
  );
}

// Camino JS clásico. Es la REFERENCIA del test de paridad
// (scripts/test-busqueda-parity.js) y el fallback de la RPC.
async function consultarPrecioYStockJS(raw, tokens, esBarato, telefono) {
  if (String(raw || '').trim().length < 2 || !tokens || !tokens.length) {
    return { ok: false, mensaje: 'Indica un nombre de producto más concreto.' };
  }

  const rawTokens = String(raw).toLowerCase().split(/\s+/);
  const medular = medularDe(tokens);
  const patronBase = patronBaseDe(raw, medular);

  const supabase = getSupabase();
  const buscar = async (patron) => {
    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, descripcion, precio, precio_usd, stock, activo, marca, fecha_vencimiento')
      .eq('activo', true)
      .ilike('nombre', `%${patron.replace(/%/g, '')}%`)
      .order('nombre')
      .limit(30);
    if (error) throw error;
    return data || [];
  };

  let data = await buscar(patronBase);
  if (!data.length) {
    data = await buscar(medular);
  }
  if (!data.length) {
    return { ok: false, mensaje: 'No hay coincidencias en el inventario para esa búsqueda.' };
  }

  // Recuento previo de recomendaciones (rotación) y contexto persistido.
  const ctx = await leerContextoRotacion(supabase, telefono);

  const top = rankearCandidatos({ candidatos: data, tokens, rawTokens, esBarato, ctx, top: 3 });

  // Incrementar recuento de recomendación y persistir rotación.
  await recordarRecomendacion(supabase, telefono, ctx, top);

  return {
    ok: true,
    max_ofertas: 3,
    productos: top.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precio: Number(p.precio),
      precio_usd: Number(p.precio_usd || 0),
      stock: p.stock,
      disponible: p.stock > 0,
    })),
  };
}

// Lee el mapa de rotación guardado en estado_chat.last_tool_context.
async function leerContextoRotacion(supabase, telefono) {
  if (!telefono) return {};
  const { data } = await supabase
    .from('estado_chat')
    .select('last_tool_context')
    .eq('telefono_cliente', telefono)
    .maybeSingle();
  return data?.last_tool_context || {};
}

// Registra que esos productos se recomendaron ahora (rotación) y guarda el
// recuento actualizado en estado_chat.last_tool_context.
async function recordarRecomendacion(supabase, telefono, ctx, productos) {
  if (!telefono) return;
  const ahora = Date.now();
  for (const p of productos) {
    const prev = ctx[p.id] || { veces: 0, ultima: 0 };
    ctx[p.id] = {
      veces: (prev.veces || 0) + 1,
      ultima: ahora,
      nombre: p.nombre,
      id: p.id,
    };
  }
  // Asegurar que el cliente existe (estado_chat tiene FK a clientes) y persistir.
  await supabase.from('clientes').upsert({ telefono }, { onConflict: 'telefono', ignoreDuplicates: true });
  await supabase
    .from('estado_chat')
    .upsert(
      { telefono_cliente: telefono, last_tool_context: ctx },
      { onConflict: 'telefono_cliente' }
    );
}

// #V51 · Purga de carritos expirados fuera del camino caliente. La llama el
// cron de server.js (y una vez al arrancar). Fail-soft: un fallo de purga no
// debe tumbar el proceso.
async function purgarCarritosExpirados() {
  try {
    await rpc('purgar_carritos_expirados');
    return true;
  } catch (err) {
    console.warn('[tools] purgar_carritos_expirados:', err?.message || err);
    return false;
  }
}

async function agregarAlCarrito({ telefono_cliente, id_producto, cantidad }, telefonoAutorizado) {
  const telefono = assertE164(telefonoAutorizado || telefono_cliente);
  if (telefono_cliente && telefono_cliente !== telefono) {
    return { ok: false, mensaje: 'El teléfono no coincide con el remitente.' };
  }
  if (!UUID_RE.test(String(id_producto))) {
    return { ok: false, mensaje: 'id_producto no es un UUID válido.' };
  }
  const qty = Number(cantidad);
  if (!Number.isInteger(qty) || qty < 1) {
    return { ok: false, mensaje: 'Cantidad inválida.' };
  }

  const rows = await rpc('agregar_item_carrito', {
    p_telefono: telefono,
    p_producto: id_producto,
    p_cantidad: qty,
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  const resultado = row || { ok: false, mensaje: 'No se pudo añadir al carrito.' };
  // #V30/#V47 · evento carrito_accion, fire-and-forget.
  registrarCarrito(telefono, 'agregar', Boolean(resultado.ok)).catch(() => {});
  return resultado;
}

// #V28 — disclaimer obligatorio en el resumen del carrito/pedido (tasa de cambio al despacho)
const DISCLAIMER_RESUMEN_PEDIDO =
  'El monto total puede variar al momento del despacho por cambios en la tasa de cambio, etc.';

async function verResumenCarrito({ telefono_cliente }, telefonoAutorizado) {
  const telefono = assertE164(telefonoAutorizado || telefono_cliente);
  // #V51 · La purga de carritos expirados salió de aquí (camino caliente) y
  // corre en un cron en server.js: cada ver_resumen_carrito pagaba un RPC extra.

  const { data, error } = await getSupabase()
    .from('carritos_temporales')
    .select('cantidad, fecha_agregado, productos ( id, nombre, precio, stock )')
    .eq('telefono_cliente', telefono)
    .order('fecha_agregado', { ascending: true });

  // #V28 — estado actual de la cabecera del carrito/pedido (public.carritos.estado)
  const { data: cab, error: cabErr } = await getSupabase()
    .from('carritos')
    .select('estado')
    .eq('telefono_cliente', telefono)
    .in('estado', ['activo', 'pendiente_confirmacion', 'pedido'])
    .order('actualizado_en', { ascending: false })
    .limit(1);
  if (cabErr) throw cabErr;
  const estadoActual = cab?.[0]?.estado || null;

  if (error) throw error;
  if (!data?.length) {
    return {
      ok: true,
      vacio: true,
      lineas: [],
      total: 0,
      estado_actual: estadoActual,
      caduca_en: null,
      disclaimer: DISCLAIMER_RESUMEN_PEDIDO,
    };
  }

  const inicio = data.reduce(
    (min, row) => (row.fecha_agregado < min ? row.fecha_agregado : min),
    data[0].fecha_agregado
  );
  const caduca = new Date(new Date(inicio).getTime() + 24 * 60 * 60 * 1000);

  const lineas = data.map((row) => {
    const precio = Number(row.productos.precio);
    return {
      producto_id: row.productos.id,
      nombre: row.productos.nombre,
      cantidad: row.cantidad,
      precio_unitario: precio,
      subtotal: Number((precio * row.cantidad).toFixed(2)),
    };
  });

  return {
    ok: true,
    vacio: false,
    lineas,
    total: Number(lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2)),
    estado_actual: estadoActual,
    sesion_iniciada: inicio,
    caduca_en: caduca.toISOString(),
    disclaimer: DISCLAIMER_RESUMEN_PEDIDO,
  };
}

// #V36 · Acumula puntos del carrito actual tras formalizar un pedido.
// La clave de idempotencia es el propio carrito_id, de modo que reintentos
// o dobles toques sobre el mismo pedido no generan un segundo asiento.
async function acumularPuntosPorCarrito(telefono) {
  const { data: carrito } = await getSupabase()
    .from('carritos')
    .select('id')
    .eq('telefono_cliente', telefono)
    .order('actualizado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!carrito?.id) return;

  // Filtra por el carrito_id confirmado, NO solo por telefono_cliente: si el
  // cliente tiene otro carrito abierto a medias, sus productos se sumarian a
  // esta compra y los puntos saldrian mal.
  const { data: items, error } = await getSupabase()
    .from('carritos_temporales')
    .select('producto_id, cantidad')
    .eq('carrito_id', carrito.id);
  if (error) throw error;
  if (!items?.length) return;

  return acumularPuntos({
    telefono,
    referencia: `whatsapp:pedido:${carrito.id}`,
    items,
    canal: 'whatsapp',
  });
}

async function actualizarEstadoPedido({ telefono_cliente, estado, descripcion }, telefonoAutorizado) {
  const telefono = assertE164(telefonoAutorizado || telefono_cliente);
  const estadoValido = ['pendiente_confirmacion', 'pedido'];
  const nuevoEstado = String(estado || '').trim();

  if (!estadoValido.includes(nuevoEstado)) {
    return {
      ok: false,
      mensaje: 'Estado inválido. Usa "pendiente_confirmacion" o "pedido". ' +
        `Uso: ${JSON.stringify({
          telefono_cliente: telefono,
          estado: 'pedido',
          descripcion: 'comentario opcional',
        })}`,
    };
  }

  // #V58 · Bloqueo determinista: un pedido NO se formaliza sin el NOMBRE del
  // cliente (requisito del mostrador para dejar el pedido a su nombre y
  // relacionarlo con su ficha). Si falta, se deja en 'pendiente_confirmacion',
  // se marca la espera y se pide el nombre; al capturarlo, el webhook finaliza
  // el pedido automáticamente sin depender del modelo.
  if (nuevoEstado === 'pedido') {
    const { data: cli } = await getSupabase()
      .from('clientes')
      .select('nombre')
      .eq('telefono', telefono)
      .maybeSingle();
    if (!String(cli?.nombre || '').trim()) {
      await rpc('actualizar_estado_carrito', { p_telefono: telefono, p_estado: 'pendiente_confirmacion' });
      await marcarPedidoEsperandoNombre(telefono, true);
      registrarCarrito(telefono, 'estado_pendiente_confirmacion', true).catch(() => {});
      return {
        ok: false,
        requiere_nombre: true,
        estado: 'pendiente_confirmacion',
        mensaje:
          'Falta el NOMBRE del cliente para reservar el pedido. Pídeselo con amabilidad ' +
          '(solo el nombre, sin datos sensibles); en cuanto lo dé, el pedido se confirma solo.',
      };
    }
  }

  const rows = await rpc('actualizar_estado_carrito', {
    p_telefono: telefono,
    p_estado: nuevoEstado,
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.ok) {
    registrarCarrito(telefono, `estado_${nuevoEstado}`, false).catch(() => {});
    return { ok: false, mensaje: row?.mensaje || 'No se pudo actualizar el estado.' };
  }
  // #V30/#V47 · evento carrito_accion (+ compra si quedó formalizado).
  registrarCarrito(telefono, `estado_${nuevoEstado}`, true).catch(() => {});
  if (nuevoEstado === 'pedido') {
    registrarCompra(telefono).catch(() => {});
    registrarHabitosConsumo(telefono).catch((err) => {
      console.error('[tools] registrarHabitosConsumo', err);
    });
    // #V56 · Refresca el perfil de consumo (intereses + categorías) tras la compra.
    construirPerfilConsumo(telefono).catch((err) => {
      console.error('[tools] construirPerfilConsumo', err);
    });
    // #V36 · puntos por la compra. Referencia estable = carrito_id + estado:
    // reprocesar el mismo pedido NO duplica puntos (ON CONFLICT en la RPC).
    acumularPuntosPorCarrito(telefono).catch((err) => {
      console.error('[tools] acumularPuntosPorCarrito', err);
    });
  }

  return {
    ok: true,
    estado: nuevoEstado,
    mensaje: String(descripcion || '').trim()
      ? `Pedido marcado como "${nuevoEstado}". ${descripcion}`
      : `Pedido marcado como "${nuevoEstado}".`,
  };
}

// #V58 · Determinista: si el cliente ya confirmó (quedó pendiente por falta de
// nombre) y ahora capturamos su nombre, formalizamos el pedido sin volver a
// pasar por el modelo. Devuelve { nombre } si se confirmó, o null.
async function confirmarPedidoPendientePorNombre(telefono) {
  const supabase = getSupabase();
  const { data: estado } = await supabase
    .from('estado_chat')
    .select('contexto_bot')
    .eq('telefono_cliente', telefono)
    .maybeSingle();
  if (!estado?.contexto_bot?.pedido_pendiente_nombre) return null;

  const { data: cli } = await supabase
    .from('clientes')
    .select('nombre')
    .eq('telefono', telefono)
    .maybeSingle();
  const nombre = String(cli?.nombre || '').trim();
  if (!nombre) return null;

  const { data: cab } = await supabase
    .from('carritos')
    .select('id')
    .eq('telefono_cliente', telefono)
    .eq('estado', 'pendiente_confirmacion')
    .order('actualizado_en', { ascending: false })
    .limit(1);
  if (!cab?.length) {
    marcarPedidoEsperandoNombre(telefono, false).catch(() => {});
    return null;
  }

  const rows = await rpc('actualizar_estado_carrito', { p_telefono: telefono, p_estado: 'pedido' });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.ok) return null;

  marcarPedidoEsperandoNombre(telefono, false).catch(() => {});
  registrarCarrito(telefono, 'estado_pedido', true).catch(() => {});
  registrarCompra(telefono).catch(() => {});
  registrarHabitosConsumo(telefono).catch((err) => {
    console.error('[tools] registrarHabitosConsumo', err);
  });
  acumularPuntosPorCarrito(telefono).catch((err) => {
    console.error('[tools] acumularPuntosPorCarrito', err);
  });
  return { nombre };
}

async function solicitarAsistenciaHumana({ telefono_cliente, motivo }, telefonoAutorizado, contexto = {}) {
  const telefono = assertE164(telefonoAutorizado || telefono_cliente);
  const motivoFinal = String(motivo || 'El cliente solicita un especialista.').slice(0, 500);
  const causa = contexto.causa ? String(contexto.causa).slice(0, 24) : 'llm';
  const intent = contexto.intent ? String(contexto.intent).slice(0, 20) : null;

  const { error } = await getSupabase()
    .from('estado_chat')
    .upsert({
      telefono_cliente: telefono,
      estado: 'esperando_operador',
      motivo_handoff: motivoFinal,
      silenciado_desde: new Date().toISOString(),
    });
  if (error) throw error;

  // #V30/#V47 · evento handoff (longitud del motivo + causa enum, anti-PII).
  // #V53 · `causa` distingue escalado por LLM, guardia, usuario, sensible,
  // frustración o fallback repetido: insumo de analítica (#V54).
  registrarHandoff(telefono, motivoFinal.length, causa).catch(() => {});

  const { data: cliente } = await getSupabase()
    .from('clientes')
    .select('nombre')
    .eq('telefono', telefono)
    .maybeSingle();

  const { data: mensajes } = await getSupabase()
    .from('mensajes')
    .select('rol, contenido')
    .eq('telefono_cliente', telefono)
    .order('created_at', { ascending: false })
    .limit(5);

  // #V45 · Enlace configurable al panel (antes: localhost hardcodeado, roto
  // en producción). Configurar PANEL_URL en el .env del VPS.
  const enlace = config.panelUrl;

  notifyHandoff({
    telefono,
    nombre: cliente?.nombre || null,
    motivo: motivoFinal,
    causa,
    intent,
    ultimosMensajes: (mensajes || []).reverse(),
    enlace,
  }).catch(() => {});

  return {
    ok: true,
    estado: 'esperando_operador',
    mensaje: 'Handoff registrado. El bot debe silenciarse.',
  };
}

// #V36 · Consulta de puntos (SOLO LECTURA). El canje lo confirma siempre un
// operador humano: el bot informa saldo y recompensas, nunca aplica el
// descuento ni promete uno por su cuenta.
async function consultarPuntos({ telefono_cliente }, telefonoAutorizado) {
  const telefono = assertE164(telefonoAutorizado || telefono_cliente);
  const resumen = await getSaldo(telefono);

  if (!resumen || resumen.programa_activo === false) {
    return {
      ok: true,
      programa_activo: false,
      mensaje: 'El programa de fidelización no está activo en este momento.',
      saldo: 0,
      recompensas: [],
    };
  }

  const saldo = Number(resumen.saldo_canjeable ?? resumen.saldo ?? 0);
  const recompensas = Array.isArray(resumen.recompensas) ? resumen.recompensas : [];
  const alcanzables = recompensas.filter((r) => r.alcanzable);

  return {
    ok: true,
    programa_activo: true,
    saldo,
    saldo_total: Number(resumen.saldo ?? saldo),
    minimo_canje: Number(resumen.canje_minimo ?? 0),
    recompensas: recompensas.map((r) => ({
      nombre: r.nombre,
      descripcion: r.descripcion,
      puntos_costo: r.puntos_costo,
      valor: r.valor,
      unidad: r.unidad,
      alcanzable: r.alcanzable,
    })),
    mensaje: alcanzables.length
      ? `Tiene ${saldo} puntos disponibles y puede canjear: ${alcanzables.map((r) => r.nombre).join(', ')}. Un operador confirma el canje.`
      : `Tiene ${saldo} puntos disponibles. El canje se activa al alcanzar el mínimo de ${Number(resumen.canje_minimo ?? 0)} puntos.`,
  };
}

// #V56 · Recomendaciones al cliente (SOLO LECTURA). Reutiliza el motor híbrido
// del panel (`getRecomendaciones`: hábito, categoría, co-ocurrencia, contenido,
// populares) y devuelve las mejores con su motivo. NUNCA añade al carrito.
async function recomendarProductos({ telefono_cliente }, telefonoAutorizado) {
  const telefono = assertE164(telefonoAutorizado || telefono_cliente);
  if (telefono_cliente && telefono_cliente !== telefono) {
    return { ok: false, mensaje: 'El teléfono no coincide con el remitente.' };
  }

  const recomendaciones = (await getRecomendaciones(telefono)) || [];
  const top = recomendaciones.slice(0, 3);
  if (!top.length) {
    return {
      ok: true,
      max_sugerencias: 3,
      recomendaciones: [],
      mensaje: 'Todavía no hay recomendaciones para este cliente; ofrécele el catálogo o pregúntale qué necesita.',
    };
  }

  return {
    ok: true,
    max_sugerencias: 3,
    recomendaciones: top.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      descripcion: r.descripcion || '',
      precio: r.precio,
      precio_usd: r.precio_usd,
      stock: r.stock,
      disponible: r.stock > 0,
      motivo: r.motivo,
    })),
  };
}

async function ejecutarHerramienta(name, args, ctx) {
  switch (name) {
    case 'consultar_precio_y_stock':
      return consultarPrecioYStock(args, ctx.telefono);
    case 'agregar_al_carrito':
      return agregarAlCarrito(args, ctx.telefono);
    case 'ver_resumen_carrito':
      return verResumenCarrito(args, ctx.telefono);
    case 'actualizar_estado_pedido':
      return actualizarEstadoPedido(args, ctx.telefono);
    case 'consultar_puntos':
      return consultarPuntos(args, ctx.telefono);
    case 'recomendar_productos':
      return recomendarProductos(args, ctx.telefono);
    case 'solicitar_asistencia_humana':
      return solicitarAsistenciaHumana(args, ctx.telefono, { intent: ctx.intent, causa: ctx.causa });
    default:
      return { ok: false, mensaje: `Herramienta desconocida: ${name}` };
  }
}

module.exports = {
  consultarPrecioYStock,
  consultarPrecioYStockJS,
  agregarAlCarrito,
  verResumenCarrito,
  actualizarEstadoPedido,
  consultarPuntos,
  recomendarProductos,
  solicitarAsistenciaHumana,
  confirmarPedidoPendientePorNombre,
  purgarCarritosExpirados,
  ejecutarHerramienta,
};
