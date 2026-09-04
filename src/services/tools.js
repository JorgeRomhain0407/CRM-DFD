'use strict';

const { getSupabase, rpc } = require('../lib/supabase');
const { assertE164 } = require('../lib/phone');
const { notifyHandoff } = require('./telegram');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Sinónimos de unidades de medida: mapea cada variante a su forma normalizada.
// Tanto el query del cliente como el nombre en BD se normalizan a estos tokens.
const UNIDADES = {
  g: 'gramo', gr: 'gramo', gramo: 'gramo', gramos: 'gramo',
  mg: 'miligramo', miligramo: 'miligramo', miligramos: 'miligramo',
  ml: 'mililitro', mililitro: 'mililitro', mililitros: 'mililitro',
  l: 'litro', litro: 'litro', litros: 'litro',
  mcg: 'microgramo', ug: 'microgramo', microgramo: 'microgramo', microgramos: 'microgramo',
  ui: 'ui', 'iu': 'ui', unidades: 'ui',
  comprimidos: 'comprimidos', comprimido: 'comprimidos', comp: 'comprimidos',
  capsulas: 'capsulas', capsula: 'capsulas', cápsulas: 'capsulas', caps: 'capsulas',
  monodosis: 'monodosis', dosis: 'monodosis',
};

// Normaliza un texto: minúsculas, separa números de letras y sustituye las
// medidas por su forma canónica. Devuelve la lista de tokens normalizados.
const STOPWORDS = new Set([
  'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'quiero',
  'quieres', 'que', 'cuanto', 'cual', 'precio', 'tiene', 'tengo', 'hay', 'me', 'su',
  'en', 'y', 'a', 'al', 'se', 'por', 'para', 'con', 'ver', 'mi', 'tu', 'es',
]);

function normalizarTokens(texto) {
  const t = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[.,;:()]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return t.map((tok) => (UNIDADES[tok] ? UNIDADES[tok] : tok));
}

// Busca productos cuyo nombre (normalizado con sinónimos de unidad) contenga
// los tokens significativos del query: "1 gramo" == "1 g", mg == miligramo, etc.
// Devuelve como mucho 3 opciones, priorizando coincidencia > marca > stock >
// rotación (menos veces recomendado) > antigüedad de vencimiento (si existe la
// columna) > precio (asc si el cliente pide "el más barato").
async function consultarPrecioYStock({ nombre_producto, orden_precio }, telefono) {
  const raw = String(nombre_producto || '').trim();
  if (raw.length < 2) {
    return { ok: false, mensaje: 'Indica un nombre de producto más concreto.' };
  }

  const tokens = normalizarTokens(raw).filter((tk) => tk.length > 1 && !STOPWORDS.has(tk));
  if (!tokens.length) {
    return { ok: false, mensaje: 'Indica un nombre de producto más concreto.' };
  }

  const rawTokens = String(raw).toLowerCase().split(/\s+/);
  const medular = [...tokens].sort((a, b) => b.length - a.length)[0];
  const patronBase =
    rawTokens
      .filter((tk) => tk.length > 1 && !STOPWORDS.has(tk))
      .sort((a, b) => b.length - a.length)[0] || medular;

  const supabase = getSupabase();
  const buscar = async (patron) => {
    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, descripcion, precio, stock, created_at, updated_at')
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

  const esBarato = orden_precio === 'asc';
  const puntuados = [];
  for (const p of data) {
    const tokensNombre = normalizarTokens(p.nombre);
    const coinciden = tokens.filter((tk) =>
      tokensNombre.some((nt) => nt.includes(tk) || tk.includes(nt))
    ).length;

    // Marca: si en el nombre del producto hay un fragmento que también esté en
    // el query crudo y sea además una "palabra de marca" plausible.
    const nombreLower = String(p.nombre).toLowerCase();
    const marca = rawTokens.find(
      (tk) => tk.length > 3 && nombreLower.includes(tk) && nombreLower !== tk
    );

    const veces = ctx[p.id]?.veces || 0;
    const ultima = ctx[p.id]?.ultima || 0;
    const venc = p.fecha_vencimiento ? new Date(p.fecha_vencimiento).getTime() : null;

    puntuados.push({
      p,
      coinciden,
      marca: marca ? 1 : 0,
      veces,
      ultima,
      venc,
    });
  }

  // Orden de prioridad según los flags escogidos.
  puntuados.sort((a, b) => {
    // 1) Mejor coincidencia de tokens.
    if (b.coinciden !== a.coinciden) return b.coinciden - a.coinciden;
    // 2) Marca específica mencionada.
    if (b.marca !== a.marca) return b.marca - a.marca;
    // 3) Más stock.
    if (b.p.stock !== a.p.stock) return b.p.stock - a.p.stock;
    // 4) Rotación: menos veces recomendado primero.
    if (a.veces !== b.veces) return a.veces - b.veces;
    // 5) FEFO (si hubiera fechas): primero el que vence antes.
    if (a.venc && b.venc && a.venc !== b.venc) return a.venc - b.venc;
    // 6) Precio: más barato primero si "el más barato"; si no, más caro.
    return esBarato ? a.p.precio - b.p.precio : b.p.precio - a.p.precio;
  });

  const top = puntuados.slice(0, 3).map((r) => r.p);

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
  await supabase
    .from('estado_chat')
    .update({ last_tool_context: ctx })
    .eq('telefono_cliente', telefono);
}

// Marcador de posición: la búsqueda de marca se resuelve reutilizando los
// mismos resultados normalizados (el nombre del producto ya incluye la marca).
// Marcador de posición: la búsqueda de marca se resuelve reutilizando los
// mismos resultados normalizados (el nombre del producto ya incluye la marca).
function dameMarcaBuscada(_supabase, _raw) {
  return null;
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
      return consultarPrecioYStock(args, ctx.telefono);
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
