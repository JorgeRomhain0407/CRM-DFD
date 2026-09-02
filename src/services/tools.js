'use strict';

const { getSupabase, rpc } = require('../lib/supabase');
const { assertE164 } = require('../lib/phone');
const { notifyHandoff } = require('./telegram');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function consultarPrecioYStock({ nombre_producto }) {
  const q = String(nombre_producto || '').trim();
  if (q.length < 2) {
    return { ok: false, mensaje: 'Indica un nombre de producto más concreto.' };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, descripcion, precio, stock')
    .eq('activo', true)
    .ilike('nombre', `%${q.replace(/%/g, '')}%`)
    .order('nombre')
    .limit(8);

  if (error) throw error;
  if (!data?.length) {
    return { ok: false, mensaje: 'No hay coincidencias en el inventario para esa búsqueda.' };
  }

  return {
    ok: true,
    productos: data.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precio: Number(p.precio),
      stock: p.stock,
      disponible: p.stock > 0,
    })),
  };
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
  return row || { ok: false, mensaje: 'No se pudo añadir al carrito.' };
}

async function verResumenCarrito({ telefono_cliente }, telefonoAutorizado) {
  const telefono = assertE164(telefonoAutorizado || telefono_cliente);
  await rpc('purgar_carritos_expirados');

  const { data, error } = await getSupabase()
    .from('carritos_temporales')
    .select('cantidad, fecha_agregado, productos ( id, nombre, precio, stock )')
    .eq('telefono_cliente', telefono)
    .order('fecha_agregado', { ascending: true });

  if (error) throw error;
  if (!data?.length) {
    return { ok: true, vacio: true, lineas: [], total: 0, caduca_en: null };
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
    sesion_iniciada: inicio,
    caduca_en: caduca.toISOString(),
  };
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

  const rows = await rpc('actualizar_estado_carrito', {
    p_telefono: telefono,
    p_estado: nuevoEstado,
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.ok) {
    return { ok: false, mensaje: row?.mensaje || 'No se pudo actualizar el estado.' };
  }

  return {
    ok: true,
    estado: nuevoEstado,
    mensaje: String(descripcion || '').trim()
      ? `Pedido marcado como "${nuevoEstado}". ${descripcion}`
      : `Pedido marcado como "${nuevoEstado}".`,
  };
}

async function solicitarAsistenciaHumana({ telefono_cliente, motivo }, telefonoAutorizado) {
  const telefono = assertE164(telefonoAutorizado || telefono_cliente);
  const motivoFinal = String(motivo || 'El cliente solicita un especialista.').slice(0, 500);

  const { error } = await getSupabase()
    .from('estado_chat')
    .upsert({
      telefono_cliente: telefono,
      estado: 'esperando_operador',
      motivo_handoff: motivoFinal,
      silenciado_desde: new Date().toISOString(),
    });
  if (error) throw error;

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

  const enlace = `http://localhost:3000/`;

  notifyHandoff({
    telefono,
    nombre: cliente?.nombre || null,
    motivo: motivoFinal,
    ultimosMensajes: (mensajes || []).reverse(),
    enlace,
  }).catch(() => {});

  return {
    ok: true,
    estado: 'esperando_operador',
    mensaje: 'Handoff registrado. El bot debe silenciarse.',
  };
}

async function ejecutarHerramienta(name, args, ctx) {
  switch (name) {
    case 'consultar_precio_y_stock':
      return consultarPrecioYStock(args);
    case 'agregar_al_carrito':
      return agregarAlCarrito(args, ctx.telefono);
    case 'ver_resumen_carrito':
      return verResumenCarrito(args, ctx.telefono);
    case 'actualizar_estado_pedido':
      return actualizarEstadoPedido(args, ctx.telefono);
    case 'solicitar_asistencia_humana':
      return solicitarAsistenciaHumana(args, ctx.telefono);
    default:
      return { ok: false, mensaje: `Herramienta desconocida: ${name}` };
  }
}

module.exports = {
  consultarPrecioYStock,
  agregarAlCarrito,
  verResumenCarrito,
  actualizarEstadoPedido,
  solicitarAsistenciaHumana,
  ejecutarHerramienta,
};
