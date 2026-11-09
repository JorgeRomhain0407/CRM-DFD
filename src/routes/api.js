'use strict';

const express = require('express');
const config = require('../config');
const { toE164, assertE164, normalizarTelefonoVenezuela } = require('../lib/phone');
const { getSupabase, rpc } = require('../lib/supabase');
const { ensureCliente, hasPedidoConfirmado, tiposClientes, normalizarCedula, getRecomendaciones, construirPerfilConsumo, validarProductoIds, setClienteHabitos, registrarHabitosConsumo } = require('../services/customers');
const fid = require('../services/fidelizacion');
const { acumularPuntos } = require('../services/fidelizacion');
const { requireAuth, requireRole } = require('../lib/auth');
const { registrarAuditoria } = require('../services/auditoria');
const kb = require('../services/kb');
const { generarPropuestas } = require('../services/aprendizaje');

const router = express.Router();

const CLIENTE_SELECT = 'telefono, cedula, nombre, edad, habitos_consumo, fecha_registro, estado_chat ( estado, motivo_handoff, ultima_actualizacion ), cliente_habitos ( producto_id, origen, productos ( nombre ) )';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// #V65 · Normaliza la fila de cliente: expone `habitos` como lista plana
// ({ producto_id, nombre, origen }) y oculta el join crudo de Supabase.
function conHabitos(cliente) {
  if (!cliente) return cliente;
  const { cliente_habitos, ...rest } = cliente;
  const habitos = (cliente_habitos || [])
    .map((h) => ({ producto_id: h.producto_id, nombre: h.productos?.nombre || null, origen: h.origen }))
    .filter((h) => h.nombre);
  return { ...rest, habitos };
}

async function fetchClienteConHabitos(supabase, telefono) {
  const { data, error } = await supabase
    .from('clientes')
    .select(CLIENTE_SELECT)
    .eq('telefono', telefono)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// #V59 · Ya no hay clave compartida (x-api-key): todas las rutas exigen sesión.
router.use(requireAuth);

router.get('/productos', asyncHandler(async (req, res) => {
  const showAll = req.query.all === 'true';
  let query = getSupabase()
    .from('productos')
    .select('id, nombre, descripcion, precio, precio_usd, stock, activo, marca, fecha_vencimiento')
    .order('nombre');
  if (!showAll) query = query.eq('activo', true);
  const { data, error } = await query;
  if (error) throw error;
  res.json({ productos: data });
}));

router.get('/clientes', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  let query = getSupabase()
    .from('clientes')
    .select(CLIENTE_SELECT)
    .order('fecha_registro', { ascending: false })
    .limit(50);
  if (q) {
    const seguro = q.replace(/[%(),]/g, '');
    const esNumero = q.startsWith('+') || /^\d+$/.test(q);
    const patron = `%${seguro}%`;
    if (esNumero) {
      query = query.or(`telefono.ilike.${patron},cedula.ilike.${patron}`);
    } else {
      query = query.or(`nombre.ilike.${patron},cedula.ilike.${patron}`);
    }
  }
  const { data, error } = await query;
  if (error) throw error;
  const tipos = await tiposClientes((data || []).map((c) => c.telefono));
  res.json({
    clientes: (data || []).map((c) =>
      conHabitos({
        ...c,
        tipo: tipos[c.telefono] || (c.nombre ? 'cliente' : 'lead'),
      })
    ),
  });
}));

router.get('/clientes/:ident', asyncHandler(async (req, res) => {
  const supabase = getSupabase();
  const raw = String(req.params.ident || '').trim();
  if (!raw) return res.status(400).json({ error: 'Identificador vacío.' });

  let cliente = null;

  // 1) Búsqueda exacta por teléfono (E.164 o con el prefijo por defecto)
  if (raw.startsWith('+') || /^\d+$/.test(raw)) {
    const { data, error } = await supabase
      .from('clientes')
      .select(CLIENTE_SELECT)
      .eq('telefono', toE164(raw, config.defaultPhonePrefix))
      .maybeSingle();
    if (error) throw error;
    if (data) cliente = data;
  }

  // 2) Búsqueda exacta por cédula (normalizada)
  if (!cliente) {
    try {
      const cedula = normalizarCedula(raw);
      const { data, error } = await supabase
        .from('clientes')
        .select(CLIENTE_SELECT)
        .eq('cedula', cedula)
        .maybeSingle();
      if (error) throw error;
      if (data) cliente = data;
    } catch (err) {
      // Formato de cédula inválido => no hay match por cédula (no es un error real)
      if (!(err && err.message && err.message.startsWith('Cédula inválida'))) throw err;
    }
  }

  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const tienePedido = await hasPedidoConfirmado(cliente.telefono);
  res.json({
    cliente: conHabitos({
      ...cliente,
      tipo: tienePedido || cliente.nombre ? 'cliente' : 'lead',
    }),
  });
}));

router.get('/clientes/:ident/recomendaciones', asyncHandler(async (req, res) => {
  const raw = String(req.params.ident || '').trim();
  if (!raw) return res.status(400).json({ error: 'Identificador vacío.' });
  const telefono = assertE164(toE164(raw, config.defaultPhonePrefix));
  const recomendaciones = await getRecomendaciones(telefono);
  res.json({ recomendaciones });
}));

router.put('/clientes', asyncHandler(async (req, res) => {
  const supabase = getSupabase();

  // Teléfono actual = identificador de la ficha (E.164 o con prefijo por defecto)
  let telefonoActual;
  try {
    telefonoActual = assertE164(toE164(req.body.telefono, config.defaultPhonePrefix));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const payload = {};
  if (req.body.nombre !== undefined) {
    const nombre = String(req.body.nombre || '').trim().slice(0, 200);
    payload.nombre = nombre || null;
  }
  if (req.body.edad !== undefined) {
    const edad = req.body.edad === '' || req.body.edad == null ? null : Number(req.body.edad);
    if (edad !== null && (isNaN(edad) || edad < 0 || edad > 120)) {
      return res.status(400).json({ error: 'Edad inválida (0-120).' });
    }
    payload.edad = edad;
  }
  if (req.body.habitos_consumo !== undefined) {
    payload.habitos_consumo = String(req.body.habitos_consumo || '').trim().slice(0, 500) || null;
  }

  // #V65 · Hábitos = lista de producto_id del catálogo (reemplaza el texto libre).
  let habitosSolicitados;
  if (req.body.habitos !== undefined) {
    if (!Array.isArray(req.body.habitos)) {
      return res.status(400).json({ error: 'habitos debe ser una lista de producto_id.' });
    }
    for (const pid of req.body.habitos) {
      if (!UUID_RE.test(String(pid))) {
        return res.status(400).json({ error: `producto_id inválido: ${pid}` });
      }
    }
    habitosSolicitados = req.body.habitos.map((v) => String(v));
  }

  // #V73 (hallazgo 7.5 de #V65) · Rechaza la edición si algún producto_id no
  // existe o está inactivo, ANTES de tocar la ficha (así un error de datos no
  // deja al cliente sin hábitos ni actualiza el resto de campos a medias).
  if (habitosSolicitados !== undefined && habitosSolicitados.length) {
    const { invalidos } = await validarProductoIds(habitosSolicitados);
    if (invalidos.length) {
      return res.status(400).json({ error: `producto_id inexistente o inactivo: ${invalidos.join(', ')}` });
    }
  }

  // Cédula: solo se rellena si el campo está vacío
  const hayCedula = req.body.cedula !== undefined && String(req.body.cedula || '').trim() !== '';
  let cedula = null;
  if (hayCedula) {
    try {
      cedula = normalizarCedula(req.body.cedula);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // El teléfono SÍ es mutable: telefono_nuevo lo sustituye (ON UPDATE CASCADE en las FKs)
  let telefonoNuevo = telefonoActual;
  if (req.body.telefono_nuevo !== undefined && String(req.body.telefono_nuevo || '').trim() !== '') {
    try {
      telefonoNuevo = assertE164(toE164(req.body.telefono_nuevo, config.defaultPhonePrefix));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // Ficha existente?
  const { data: existente, error: errEx } = await supabase
    .from('clientes')
    .select('telefono, cedula')
    .eq('telefono', telefonoActual)
    .maybeSingle();
  if (errEx) throw errEx;

  if (hayCedula && cedula) {
    // Regla: la cédula es inmutable una vez fijada
    if (existente?.cedula && existente.cedula !== cedula) {
      return res.status(400).json({ error: 'La cédula ya está registrada y no se puede modificar.' });
    }
    // Regla: la cédula no puede pertenecer a otra ficha
    const { data: otro, error: errOtro } = await supabase
      .from('clientes')
      .select('telefono')
      .eq('cedula', cedula)
      .maybeSingle();
    if (errOtro) throw errOtro;
    if (otro && otro.telefono !== (existente?.telefono || telefonoNuevo)) {
      return res.status(409).json({ error: 'Esa cédula ya pertenece a otro cliente.' });
    }
  }

  if (telefonoNuevo !== telefonoActual) {
    const { data: dup, error: errDup } = await supabase
      .from('clientes')
      .select('telefono')
      .eq('telefono', telefonoNuevo)
      .maybeSingle();
    if (errDup) throw errDup;
    if (dup) return res.status(409).json({ error: 'Ya existe un cliente con ese teléfono.' });
  }

  let respuesta;
  if (existente) {
    const up = { ...payload };
    if (hayCedula && !existente.cedula) up.cedula = cedula;
    if (telefonoNuevo !== telefonoActual) up.telefono = telefonoNuevo;
    if (Object.keys(up).length) {
      const { error } = await supabase
        .from('clientes')
        .update(up)
        .eq('telefono', telefonoActual)
        .select()
        .single();
      if (error) throw error;
    }
  } else {
    const extras = { ...payload };
    if (hayCedula && cedula) extras.cedula = cedula;
    await ensureCliente(telefonoNuevo, extras);
  }

  // #V65 · Reemplaza los hábitos del cliente por la selección del panel.
  // (Solo se toca si el cliente envió el campo `habitos`.)
  if (habitosSolicitados !== undefined) {
    await setClienteHabitos(telefonoNuevo, habitosSolicitados, 'manual');
  }

  // Releer la ficha final (incluye el join de hábitos) para responder.
  respuesta = await fetchClienteConHabitos(supabase, telefonoNuevo);

  // #V60 (D04/R5) · Auditoría de edición de ficha (PII). Solo los nombres de
  // los campos tocados, nunca los valores.
  registrarAuditoria({
    accion: existente ? 'cliente.actualizar' : 'cliente.crear',
    entidad: 'clientes',
    entidadId: telefonoActual,
    campos: [
      ...Object.keys(payload),
      ...(habitosSolicitados !== undefined ? ['habitos'] : []),
      ...(hayCedula && cedula ? ['cedula'] : []),
      ...(telefonoNuevo !== telefonoActual ? ['telefono'] : []),
    ],
    usuario: req.user,
    ip: req.ip,
  });

  res.json({ cliente: conHabitos(respuesta) });
}));

router.patch('/estado-chat/:telefono', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.params.telefono, config.defaultPhonePrefix));
  const permitido = ['bot_activo', 'esperando_operador', 'humano_activo'];
  if (!permitido.includes(req.body.estado)) {
    return res.status(400).json({ error: 'estado inválido' });
  }

  await ensureCliente(telefono);

  const supabase = getSupabase();
  const payload = {
    estado: req.body.estado,
    motivo_handoff: req.body.motivo || null,
  };
  if (req.body.estado === 'bot_activo') payload.silenciado_desde = null;

  // Upsert: un cliente recién creado (o sin conversación previa)
  // puede no tener fila en estado_chat todavía.
  const { data: existente } = await supabase
    .from('estado_chat')
    .select('telefono_cliente')
    .eq('telefono_cliente', telefono)
    .maybeSingle();

  let data;
  if (existente) {
    const { data: d, error } = await supabase
      .from('estado_chat')
      .update(payload)
      .eq('telefono_cliente', telefono)
      .select()
      .single();
    if (error) throw error;
    data = d;
  } else {
    const { data: d, error } = await supabase
      .from('estado_chat')
      .insert({ telefono_cliente: telefono, ...payload })
      .select()
      .single();
    if (error) throw error;
    data = d;
  }

  res.json({ estado_chat: data });
}));

router.post('/ventas', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.body.telefono, config.defaultPhonePrefix));
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Incluye al menos un ítem.' });

  for (const item of items) {
    if (!item.producto_id || !UUID_RE.test(String(item.producto_id))) {
      return res.status(400).json({ error: `producto_id inválido: ${item.producto_id}` });
    }
    const qty = Number(item.cantidad);
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ error: `Cantidad inválida para producto ${item.producto_id}` });
    }
  }

  await ensureCliente(telefono);
  const resultados = [];
  for (const item of items) {
    const rows = await rpc('registrar_venta_mostrador', {
      p_telefono: telefono,
      p_producto: item.producto_id,
      p_cantidad: Number(item.cantidad),
      // #V59 · Atribución de la venta al operador logueado.
      p_operador_id: req.user.id,
      p_operador_nombre: req.user.nombre || req.user.usuario,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.ok) {
      return res.status(409).json({ error: row?.mensaje || 'No se pudo registrar la venta', resultados });
    }
    resultados.push({ ...item, ...row });
  }
  // #V36 · puntos por la venta del mostrador (fail-soft: no rompe la venta).
  try {
    const ref = `mostrador:${Date.now()}-${telefono}`;
    await acumularPuntos({ telefono, referencia: ref, items, canal: 'mostrador' });
  } catch (err) {
    console.error('[api] acumularPuntos mostrador', err.message);
  }
  // #V56 · refresca el perfil de consumo del cliente (fail-soft).
  construirPerfilConsumo(telefono).catch((err) => {
    console.error('[api] construirPerfilConsumo', err.message);
  });
  // #V65 · Alta automática de hábitos desde lo comprado (fail-soft).
  registrarHabitosConsumo(telefono).catch((err) => {
    console.error('[api] registrarHabitosConsumo', err.message);
  });
  res.status(201).json({ ok: true, resultados });
}));

router.get('/carrito/:telefono', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.params.telefono, config.defaultPhonePrefix));
  await rpc('purgar_carritos_expirados');
  const { data, error } = await getSupabase()
    .from('carritos_temporales')
    .select('id, cantidad, fecha_agregado, productos ( id, nombre, precio )')
    .eq('telefono_cliente', telefono)
    .order('fecha_agregado', { ascending: true });
  if (error) throw error;

  const lineas = (data || []).map((row) => {
    const precio = Number(row.productos.precio);
    return {
      id: row.id,
      producto_id: row.productos.id,
      nombre: row.productos.nombre,
      cantidad: row.cantidad,
      precio_unitario: precio,
      subtotal: Number((precio * row.cantidad).toFixed(2)),
      fecha_agregado: row.fecha_agregado,
    };
  });

  const total = Number(lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2));

  res.json({ lineas, total });
}));

router.delete('/carrito/:telefono/:itemId', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.params.telefono, config.defaultPhonePrefix));
  const { error } = await getSupabase()
    .from('carritos_temporales')
    .delete()
    .eq('telefono_cliente', telefono)
    .eq('id', req.params.itemId);
  if (error) throw error;
  res.json({ ok: true });
}));

/* ---------- Pedidos / carritos activos ---------- */

const ESTADOS_CARRITO = ['activo', 'pendiente_confirmacion', 'pedido', 'completado', 'cancelado'];

async function agregarDetalleCarrito(carrito) {
  const { data, error } = await getSupabase()
    .from('carritos_temporales')
    .select('id, cantidad, productos ( id, nombre, precio )')
    .eq('carrito_id', carrito.id)
    .order('fecha_agregado', { ascending: true });
  if (error) throw error;

  const lineas = (data || []).map((row) => {
    const precio = Number(row.productos.precio);
    return {
      id: row.id,
      producto_id: row.productos.id,
      nombre: row.productos.nombre,
      cantidad: row.cantidad,
      precio_unitario: precio,
      subtotal: Number((precio * row.cantidad).toFixed(2)),
    };
  });

  return {
    ...carrito,
    num_items: lineas.reduce((s, l) => s + l.cantidad, 0),
    total: Number(lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2)),
    lineas,
  };
}

router.get('/carritos', asyncHandler(async (req, res) => {
  const incluirCerrados = req.query.cerrados === 'true';
  let query = getSupabase()
    .from('carritos')
    .select('id, telefono_cliente, estado, actualizado_en, creado_en, clientes ( nombre )')
    .order('actualizado_en', { ascending: false })
    .limit(200);
  if (!incluirCerrados) {
    query = query.in('estado', ['activo', 'pendiente_confirmacion', 'pedido']);
  }
  const { data, error } = await query;
  if (error) throw error;

  const carritos = await Promise.all((data || []).map(agregarDetalleCarrito));
  res.json({
    carritos: carritos.map((c) => ({
      id: c.id,
      telefono: c.telefono_cliente,
      nombre: c.clientes?.nombre || null,
      estado: c.estado,
      num_items: c.num_items,
      total: c.total,
      actualizado_en: c.actualizado_en,
      creado_en: c.creado_en,
      lineas: c.lineas,
    })),
  });
}));

router.get('/carritos/:id', asyncHandler(async (req, res) => {
  const { data, error } = await getSupabase()
    .from('carritos')
    .select('id, telefono_cliente, estado, actualizado_en, creado_en, clientes ( nombre )')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'Carrito no encontrado.' });
  const detalle = await agregarDetalleCarrito(data);
  res.json({
    carrito: {
      id: detalle.id,
      telefono: detalle.telefono_cliente,
      nombre: detalle.clientes?.nombre || null,
      estado: detalle.estado,
      num_items: detalle.num_items,
      total: detalle.total,
      actualizado_en: detalle.actualizado_en,
      creado_en: detalle.creado_en,
      lineas: detalle.lineas,
    },
  });
}));

router.patch('/carritos/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!ESTADOS_CARRITO.includes(req.body.estado)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }
  const { data, error } = await getSupabase()
    .from('carritos')
    .update({ estado: req.body.estado })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  res.json({ carrito: data });
}));

router.post('/carritos/:id/pagar', asyncHandler(async (req, res) => {
  // #V65 · Necesitamos el cliente del carrito para el alta automática de hábitos.
  const { data: carrito } = await getSupabase()
    .from('carritos')
    .select('telefono_cliente')
    .eq('id', req.params.id)
    .maybeSingle();

  const rows = await rpc('cerrar_carrito_venta', {
    p_carrito: req.params.id,
    // #V59 · Atribución del despacho al operador logueado.
    p_operador_id: req.user.id,
    p_operador_nombre: req.user.nombre || req.user.usuario,
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.ok) {
    return res.status(409).json({ error: row?.mensaje || 'No se pudo despachar la venta.' });
  }
  // #V65 · Alta automática de hábitos desde lo despachado (fail-soft).
  if (carrito?.telefono_cliente) {
    registrarHabitosConsumo(carrito.telefono_cliente).catch((err) => {
      console.error('[api] registrarHabitosConsumo', err.message);
    });
  }
  res.json({
    ok: true,
    mensaje: row.mensaje,
    num_lineas: row.num_lineas,
    total: Number(row.total),
  });
}));

router.get('/ventas', asyncHandler(async (req, res) => {
  // #V95 · filtro opcional por teléfono (historial de la ficha del cliente)
  const telefonoFiltro = String(req.query.telefono || '').trim() || null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), telefonoFiltro ? 500 : 200);
  let query = getSupabase()
    .from('ventas')
    .select('id, cantidad, precio_unitario, canal, created_at, telefono_cliente, operador_nombre, clientes ( nombre ), productos ( id, nombre )')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (telefonoFiltro) query = query.eq('telefono_cliente', telefonoFiltro);
  const { data, error } = await query;
  if (error) throw error;

  const ventas = (data || []).map((v) => ({
    id: v.id,
    telefono: v.telefono_cliente,
    cliente_nombre: v.clientes?.nombre || null,
    producto_id: v.productos?.id || null,
    producto_nombre: v.productos?.nombre || null,
    cantidad: v.cantidad,
    precio_unitario: Number(v.precio_unitario),
    subtotal: Number((v.precio_unitario * v.cantidad).toFixed(2)),
    canal: v.canal,
    vendedor: v.operador_nombre || null,
    fecha: v.created_at,
  }));

  res.json({ ventas });
}));

router.get('/ventas/resumen', asyncHandler(async (req, res) => {
  // #V94 · filtro opcional por mes (YYYY-MM, hora de Venezuela); sin mes devuelve el histórico completo.
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? String(req.query.mes) : null;
  let query = getSupabase()
    .from('ventas')
    .select('canal, cantidad, precio_unitario, operador_nombre');
  if (mes) {
    const [yy, mm] = mes.split('-').map(Number);
    const hasta = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
    query = query
      .gte('created_at', `${mes}-01T00:00:00-04:00`)
      .lt('created_at', `${hasta}T00:00:00-04:00`);
  }
  const { data, error } = await query;
  if (error) throw error;

  let totalIngresos = 0;
  let totalUnidades = 0;
  const porCanal = {};
  const porVendedor = {};

  for (const v of data || []) {
    const subtotal = Number(v.precio_unitario) * v.cantidad;
    totalIngresos += subtotal;
    totalUnidades += v.cantidad;
    if (!porCanal[v.canal]) porCanal[v.canal] = { ingresos: 0, unidades: 0, ventas: 0 };
    porCanal[v.canal].ingresos += subtotal;
    porCanal[v.canal].unidades += v.cantidad;
    porCanal[v.canal].ventas += 1;
    // #V94 · atribución por operador (snapshot de nombre desde #V59)
    const vendedor = v.operador_nombre || 'Sin atribuir';
    if (!porVendedor[vendedor]) porVendedor[vendedor] = { ventas: 0, ingresos: 0, unidades: 0 };
    porVendedor[vendedor].ventas += 1;
    porVendedor[vendedor].ingresos += subtotal;
    porVendedor[vendedor].unidades += v.cantidad;
  }

  for (const k of Object.keys(porVendedor)) {
    porVendedor[k].ingresos = Number(porVendedor[k].ingresos.toFixed(2));
  }

  res.json({
    mes: mes || null,
    total_ingresos: Number(totalIngresos.toFixed(2)),
    total_unidades: totalUnidades,
    total_ventas: data?.length || 0,
    por_canal: porCanal,
    por_vendedor: porVendedor,
  });
}));

// =====================================================================
// #V54 · Analítica de conversación del bot (requiere sesión).
// Agrega cliente_eventos en una sola RPC (analitica_conversaciones) y
// deriva las tasas en JS (evita división por cero en SQL).
// =====================================================================
router.get('/analitica', asyncHandler(async (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
  const data = (await rpc('analitica_conversaciones', { p_dias: dias })) || {};
  const turnos = Number(data.turnos_bot) || 0;
  const conv = Number(data.conversaciones) || 0;
  const escaladas = Number(data.conversaciones_escaladas) || 0;
  const fallback = Number(data.fallback_turnos) || 0;
  res.json({
    ...data,
    dias,
    tasa_fallback: turnos ? Number((fallback / turnos).toFixed(4)) : 0,
    tasa_reconocimiento: turnos ? Number(((turnos - fallback) / turnos).toFixed(4)) : 0,
    tasa_escalado: conv ? Number((escaladas / conv).toFixed(4)) : 0,
  });
}));

// =====================================================================
// #V90 · Vencidos / por vencer por lote (solo gestor)
// =====================================================================
// Fuente: tabla `lotes` (la llena farmacia-sync desde el TPV). No se consulta
// el TPV aquí: si la sincronización está al día, el dato ya está en Supabase.
// El "hoy" se calcula en hora de Venezuela para no adelantar un día cuando el
// servidor está en UTC.

function fechaHoyCaracas() {
  // en-CA produce YYYY-MM-DD, que es lo que espera Postgres para DATE.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function sumarDiasISO(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diferenciaDiasISO(desdeISO, hastaISO) {
  const a = Date.parse(`${desdeISO}T00:00:00Z`);
  const b = Date.parse(`${hastaISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function redondear2(n) {
  return Math.round(n * 100) / 100;
}

function partirEnBloques(items, tamano) {
  const bloques = [];
  for (let i = 0; i < items.length; i += tamano) bloques.push(items.slice(i, i + tamano));
  return bloques;
}

// PostgREST devuelve como máximo 1000 filas por petición: se pagina hasta el
// final para que un lote nuevo no desaparezca del informe.
async function leerPaginado(construirQuery, tamano = 1000, maximo = 20000) {
  const filas = [];
  for (let desde = 0; desde < maximo; desde += tamano) {
    const { data, error } = await construirQuery().range(desde, desde + tamano - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    filas.push(...data);
    if (data.length < tamano) break;
  }
  return filas;
}

function resumirLotes(filas) {
  const productos = new Set();
  let unidades = 0;
  let valorUsd = 0;
  let valorBs = 0;
  let sinPrecio = 0;
  for (const f of filas) {
    productos.add(f.sku);
    unidades += f.stock;
    if (f.valor_usd == null) sinPrecio++;
    else valorUsd += f.valor_usd;
    if (f.valor_bs != null) valorBs += f.valor_bs;
  }
  return {
    lotes: filas.length,
    productos: productos.size,
    unidades,
    valor_usd: redondear2(valorUsd),
    valor_bs: redondear2(valorBs),
    sin_precio: sinPrecio,
  };
}

router.get('/vencidos', requireRole('gestor'), asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
  const dias = Math.min(Math.max(Number.parseInt(req.query.dias, 10) || 90, 1), 365);
  const hoy = fechaHoyCaracas();
  const limite = sumarDiasISO(hoy, dias);

  // Solo lotes activos con stock y que vencen dentro de la ventana (incluye
  // los ya vencidos, que son todos los anteriores a hoy).
  const lotes = await leerPaginado(() => getSupabase()
    .from('lotes')
    .select('sku, lote, fecha_vencimiento, stock')
    .eq('activo', true)
    .gt('stock', 0)
    .lte('fecha_vencimiento', limite)
    .order('fecha_vencimiento', { ascending: true })
    .order('sku', { ascending: true }));

  const skus = [...new Set(lotes.map((l) => String(l.sku)))];
  const porSku = new Map();
  for (const bloque of partirEnBloques(skus, 200)) {
    const { data, error } = await getSupabase()
      .from('productos')
      .select('sku, nombre, marca, precio, precio_usd')
      .in('sku', bloque);
    if (error) throw error;
    for (const p of data || []) porSku.set(String(p.sku), p);
  }

  const filas = lotes.map((l) => {
    const p = porSku.get(String(l.sku)) || {};
    const stock = Number(l.stock) || 0;
    const precioUsd = p.precio_usd == null ? null : Number(p.precio_usd);
    const precioBs = p.precio == null ? null : Number(p.precio);
    return {
      sku: String(l.sku),
      lote: String(l.lote || ''),
      producto: p.nombre || null,
      marca: p.marca || null,
      fecha_vencimiento: l.fecha_vencimiento,
      dias_restantes: diferenciaDiasISO(hoy, l.fecha_vencimiento),
      stock,
      precio_usd: Number.isFinite(precioUsd) ? precioUsd : null,
      valor_usd: Number.isFinite(precioUsd) ? redondear2(stock * precioUsd) : null,
      valor_bs: Number.isFinite(precioBs) ? redondear2(stock * precioBs) : null,
    };
  }).filter((f) => {
    if (!q) return true;
    return [f.producto, f.marca, f.sku, f.lote]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  const vencidos = filas.filter((f) => f.dias_restantes != null && f.dias_restantes < 0);
  const porVencer = filas.filter((f) => f.dias_restantes != null && f.dias_restantes >= 0);

  res.json({
    hoy,
    ventana_dias: dias,
    resumen: {
      vencidos: resumirLotes(vencidos),
      por_vencer: resumirLotes(porVencer),
    },
    vencidos,
    por_vencer: porVencer,
  });
}));

// =====================================================================
// #V92 · Cola de fichas del TPV pendientes de completar (solo gestor)
// =====================================================================
// `clientes_tpv_cola` la llena farmacia-sync (#V89) cuando una ficha del TPV
// no se puede crear sola (sin teléfono válido o dato duplicado). Aquí el
// gestor completa el teléfono y el RPC `clientes_tpv_importar` crea/enlaza la
// ficha. El CRM no escribe en el TPV: solo importa datos.

const COLA_MOTIVOS = new Set([
  'sin_telefono',
  'telefono_invalido',
  'telefono_duplicado',
  'cedula_duplicada',
]);
const COLA_ESTADOS = new Set(['pendiente', 'resuelto', 'descartado']);

function esErrorMigracionCola(err) {
  return /clientes_tpv_cola|clientes_tpv_importar|does not exist|schema cache|could not find the function/i
    .test(String((err && err.message) || ''));
}

function mensajeMigracionCola() {
  return 'La cola de fichas TPV no está disponible. Ejecuta sql/migracion-clientes-tpv.sql en Supabase.';
}

// El manejador global oculta el detalle de los 5xx; para la migración pendiente
// devolvemos un 503 con instrucción explícita en vez de "Error interno".
function conColaTpv(fn) {
  return asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (esErrorMigracionCola(err)) {
        return res.status(503).json({ error: mensajeMigracionCola() });
      }
      throw err;
    }
  });
}

function mensajeResolucionCola(estado) {
  if (estado === 'cola: telefono duplicado') {
    return 'Ese teléfono ya pertenece a otra ficha con una cédula distinta. Usa otro número o resuélvelo en Clientes.';
  }
  if (estado.startsWith('conflicto: cedula')) {
    return 'Esa cédula ya está vinculada a otra ficha del CRM. Una persona debe decidirlo en Clientes.';
  }
  if (estado === 'omitido: sin cedula valida') {
    return 'La ficha del TPV no trae una cédula válida; no se puede importar. Descártala.';
  }
  if (estado.startsWith('omitido')) {
    return 'La ficha del TPV no trae los datos mínimos para importarla.';
  }
  return `No se pudo resolver la ficha (${estado || 'sin respuesta del RPC'}).`;
}

// Lista las fichas pendientes, con el resumen por motivo y la ficha actual
// (si ya existe alguna por cédula o teléfono) para decidir sin adivinar.
router.get('/clientes-tpv-cola', requireRole('gestor'), conColaTpv(async (req, res) => {
  const supabase = getSupabase();
  const motivo = String(req.query.motivo || '').trim();
  const estado = String(req.query.estado || 'pendiente').trim();
  const q = String(req.query.q || '').trim().slice(0, 80);
  const limite = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 300);
  if (motivo && !COLA_MOTIVOS.has(motivo)) {
    return res.status(400).json({ error: 'Motivo inválido.' });
  }
  if (!COLA_ESTADOS.has(estado)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }

  // Resumen de TODO lo pendiente (no depende del filtro de la tabla).
  const pendientes = await leerPaginado(() => supabase
    .from('clientes_tpv_cola')
    .select('motivo')
    .eq('estado', 'pendiente'));
  const porMotivo = { sin_telefono: 0, telefono_invalido: 0, telefono_duplicado: 0, cedula_duplicada: 0 };
  for (const f of pendientes) {
    if (Object.prototype.hasOwnProperty.call(porMotivo, f.motivo)) porMotivo[f.motivo]++;
  }

  let query = supabase.from('clientes_tpv_cola').select('*').eq('estado', estado);
  if (motivo) query = query.eq('motivo', motivo);
  if (q) {
    // Se limpian los caracteres que rompen la sintaxis de `or` de PostgREST.
    const patron = `%${q.replace(/[%,()]/g, ' ').trim()}%`;
    if (patron !== '%%') {
      query = query.or(`cedula.ilike.${patron},nombre.ilike.${patron},telefono_tpv.ilike.${patron}`);
    }
  }
  const { data: filasData, error: filasError } = await query
    .order('updated_at', { ascending: false })
    .limit(limite);
  if (filasError) throw filasError;
  const filas = filasData || [];

  // Enriquecer con la ficha que ya exista (por cédula o por teléfono) para
  // que el gestor vea el conflicto antes de decidir.
  const cedulas = [...new Set(filas.map((f) => f.cedula).filter(Boolean))];
  const telefonos = [...new Set(filas
    .map((f) => normalizarTelefonoVenezuela(f.telefono_tpv))
    .filter(Boolean))];
  const porCedula = new Map();
  const porTelefono = new Map();

  try {
    for (const bloque of partirEnBloques(cedulas, 200)) {
      const { data, error } = await supabase
        .from('clientes')
        .select('telefono, cedula, nombre')
        .in('cedula', bloque);
      if (error) throw error;
      for (const c of data || []) porCedula.set(c.cedula, c);
    }
    for (const bloque of partirEnBloques(telefonos, 200)) {
      const { data, error } = await supabase
        .from('clientes')
        .select('telefono, cedula, nombre')
        .in('telefono', bloque);
      if (error) throw error;
      for (const c of data || []) porTelefono.set(c.telefono, c);
    }
  } catch (err) {
    // La cola se puede ver aunque falle el enriquecimiento: no se bloquea.
    console.warn('[cola-tpv] no se pudieron leer las fichas actuales:', err.message);
  }

  res.json({
    estado,
    motivo: motivo || null,
    limite,
    resumen: { pendientes: pendientes.length, por_motivo: porMotivo },
    total: filas.length,
    filas: filas.map((f) => {
      const telNorm = normalizarTelefonoVenezuela(f.telefono_tpv);
      return {
        ...f,
        telefono_normalizado: telNorm,
        ficha_por_cedula: f.cedula ? porCedula.get(f.cedula) || null : null,
        ficha_por_telefono: telNorm ? porTelefono.get(telNorm) || null : null,
      };
    }),
  });
}));

// Resuelve una ficha pendiente asignándole el teléfono real del cliente.
// Llama al mismo RPC que usa el sincronizador para no duplicar reglas.
router.post('/clientes-tpv-cola/:id/resolver', requireRole('gestor'), conColaTpv(async (req, res) => {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Id de ficha inválido.' });

  const b = req.body || {};
  const telefono = normalizarTelefonoVenezuela(b.telefono ?? b.telefono_asignado);
  if (!telefono) {
    return res.status(400).json({
      error: 'Teléfono inválido. Escribe el número real (ej. 0424-1234567 o +58 424 1234567).',
    });
  }

  const { data: fila, error: filaError } = await getSupabase()
    .from('clientes_tpv_cola')
    .select('*')
    .eq('id', id)
    .eq('estado', 'pendiente')
    .maybeSingle();
  if (filaError) throw filaError;
  if (!fila) {
    return res.status(404).json({ error: 'Esa ficha ya no está pendiente (o no existe).' });
  }

  const { data: salidaData, error: salidaError } = await getSupabase().rpc('clientes_tpv_importar', {
    p_tpv_cliente_id: fila.tpv_cliente_id,
    p_cedula: fila.cedula,
    p_nombre: fila.nombre,
    p_telefono: telefono,
    p_ciudad: fila.ciudad,
    p_direccion: fila.direccion,
    p_ultima_compra: fila.ultima_compra,
  });
  if (salidaError) throw salidaError;
  const salida = Array.isArray(salidaData) ? salidaData[0] : salidaData;

  const estadoRpc = String((salida && salida.out_estado) || '');
  const resuelta = ['creada', 'enriquecida', 'enriquecida_por_telefono', 'actualizada'].includes(estadoRpc);
  if (!resuelta) {
    return res.status(409).json({
      error: mensajeResolucionCola(estadoRpc),
      estado: estadoRpc || null,
      telefono: (salida && salida.out_telefono) || null,
    });
  }

  const { data: actualizada, error: updateError } = await getSupabase()
    .from('clientes_tpv_cola')
    .update({
      estado: 'resuelto',
      // Se guarda el teléfono de la ficha resultante: en un match por cédula
      // el RPC puede enlazar una ficha que ya existía con otro número.
      telefono_asignado: (salida && salida.out_telefono) || telefono,
      resuelto_en: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (updateError) throw updateError;

  registrarAuditoria({
    accion: 'clientes_tpv_cola.resolver',
    entidad: 'clientes_tpv_cola',
    entidadId: id,
    campos: ['telefono_asignado'],
    usuario: req.user,
    ip: req.ip,
  });

  res.json({
    ok: true,
    estado: estadoRpc,
    telefono: (salida && salida.out_telefono) || telefono,
    fila: actualizada,
  });
}));

// Descarta una ficha que no se puede (o no se quiere) importar.
router.post('/clientes-tpv-cola/:id/descartar', requireRole('gestor'), conColaTpv(async (req, res) => {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Id de ficha inválido.' });

  const { data: actualizada, error: updateError } = await getSupabase()
    .from('clientes_tpv_cola')
    .update({ estado: 'descartado', resuelto_en: new Date().toISOString() })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select()
    .maybeSingle();
  if (updateError) throw updateError;
  if (!actualizada) {
    return res.status(404).json({ error: 'Esa ficha ya no está pendiente (o no existe).' });
  }

  registrarAuditoria({
    accion: 'clientes_tpv_cola.descartar',
    entidad: 'clientes_tpv_cola',
    entidadId: id,
    usuario: req.user,
    ip: req.ip,
  });

  res.json({ ok: true, fila: actualizada });
}));

// =====================================================================
// #V36 · Fidelización (solo gestor: no visible para operadores)
// =====================================================================

// Convierte a número solo si viene informado (si no, undefined = "no tocar").
const num = (v) => (v === undefined || v === '' || v === null ? undefined : Number(v));

// Resumen de puntos de un cliente: saldo, movimientos y recompensas. Solo gestor.
router.get('/fidelizacion/:telefono', requireRole('gestor'), asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.params.telefono, config.defaultPhonePrefix));
  const resumen = await fid.getSaldo(telefono);
  res.json({ telefono, ...resumen });
}));

// Config del programa. Solo gestor.
router.get('/fidelizacion-config', requireRole('gestor'), asyncHandler(async (_req, res) => {
  const cfg = await fid.getConfigTabla();
  const recompensas = await fid.getRecompensas();
  const categorias = await fid.getCategorias();
  res.json({ config: cfg, recompensas, categorias });
}));

// Editar la config del programa (tasa, bonus, mínimos, activar). Solo gestor.
router.put('/fidelizacion-config', requireRole('gestor'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const actualizado = await fid.setConfig({
    activo: typeof b.activo === 'boolean' ? b.activo : undefined,
    puntos_por_usd: num(b.puntos_por_usd),
    bonificacion_categoria: num(b.bonificacion_categoria),
    canje_minimo_puntos: num(b.canje_minimo_puntos),
    canje_max_porcentaje: num(b.canje_max_porcentaje),
    vigencia_dias: num(b.vigencia_dias),
    nota: b.nota,
  });
  if (!actualizado) {
    return res.status(500).json({ error: 'No se pudo guardar la configuración.' });
  }
  res.json({ ok: true, config: actualizado });
}));

// Crear o editar una recompensa/oferta. Solo gestor.
router.post('/fidelizacion-recompensas', requireRole('gestor'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !Number.isInteger(Number(b.puntos_costo)) || Number(b.puntos_costo) <= 0) {
    return res.status(400).json({ error: 'Nombre y puntos_costo (> 0) son obligatorios.' });
  }
  const guardada = await fid.upsertRecompensa({
    id: b.id,
    nombre: String(b.nombre).slice(0, 120),
    descripcion: b.descripcion ? String(b.descripcion).slice(0, 500) : null,
    tipo: b.tipo || 'descuento',
    puntos_costo: Number(b.puntos_costo),
    valor: num(b.valor) ?? 0,
    unidad: b.unidad || 'bs',
    limite: num(b.limite) ?? null,
    activa: b.activa !== false,
    orden: num(b.orden) ?? 0,
  });
  if (!guardada) return res.status(500).json({ error: 'No se pudo guardar la recompensa.' });
  res.status(b.id ? 200 : 201).json({ ok: true, recompensa: guardada });
}));

// Eliminar una recompensa. Solo gestor.
router.delete('/fidelizacion-recompensas/:id', requireRole('gestor'), asyncHandler(async (req, res) => {
  const ok = await fid.deleteRecompensa(req.params.id);
  if (!ok) return res.status(400).json({ error: 'id inválido o no se pudo eliminar.' });
  res.json({ ok: true });
}));

// Canjear una recompensa para un cliente (descuento calculado). Solo gestor.
const MOTIVOS_CANJE = {
  programa_inactivo: 'El programa de fidelización no está activo.',
  recompensa_no_disponible: 'Esa recompensa no existe o está desactivada.',
  minimo_no_alcanzado: 'El cliente todavía no alcanza el mínimo de puntos para canjear.',
  puntos_insuficientes: 'El cliente no tiene puntos suficientes para esa recompensa.',
  recompensa_agotada: 'Esa recompensa ya alcanzó su límite de usos.',
  monto_pedido_requerido: 'Indica el monto del pedido: esta recompensa es un porcentaje.',
  cliente_no_existe: 'Ese teléfono no está registrado como cliente.',
  recompensa_invalida: 'La recompensa indicada no es válida.',
  rpc_no_disponible: 'El sistema de puntos no está disponible ahora mismo.',
};

router.post('/fidelizacion/canjear', requireRole('gestor'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const telefono = assertE164(toE164(b.telefono, config.defaultPhonePrefix));
  const resultado = await fid.canjearPuntos({
    telefono,
    recompensaId: b.recompensa_id,
    referencia: b.referencia || `panel:${Date.now()}`,
    montoPedido: num(b.monto_pedido) ?? 0,
  });
  if (!resultado.ok) {
    const status = resultado.motivo === 'programa_inactivo' ? 409 : 400;
    return res.status(status).json({
      ...resultado,
      error: MOTIVOS_CANJE[resultado.motivo] || `No se pudo canjear (${resultado.motivo || 'error'}).`,
    });
  }
  res.json(resultado);
}));

// Ajuste manual de puntos (suma o resta). Solo gestor (es una corrección de saldo).
const MOTIVOS_AJUSTE = {
  puntos_cero: 'Indica cuántos puntos sumar o restar (no puede ser 0).',
  saldo_insuficiente: 'El cliente no tiene saldo suficiente para restar esos puntos.',
  programa_inactivo: 'El programa de fidelización no está activo.',
  cliente_no_existe: 'Ese teléfono no está registrado como cliente.',
  rpc_no_disponible: 'El sistema de puntos no está disponible ahora mismo.',
};

router.post('/fidelizacion/ajustar', requireRole('gestor'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const telefono = assertE164(toE164(b.telefono, config.defaultPhonePrefix));
  const resultado = await fid.ajusteManual({
    telefono,
    puntos: Number(b.puntos),
    motivo: b.motivo,
    referencia: b.referencia,
  });
  if (!resultado.ok) {
    return res.status(400).json({
      ...resultado,
      error: MOTIVOS_AJUSTE[resultado.motivo] || `No se pudo ajustar (${resultado.motivo || 'error'}).`,
    });
  }
  res.json(resultado);
}));

// Asignar/quitar la categoría curada de un producto (multiplicador de puntos). Solo gestor.
router.post('/fidelizacion/producto-categoria', requireRole('gestor'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const ok = await fid.asignarCategoriaProducto(b.producto_id, b.categoria_id);
  if (!ok) return res.status(400).json({ error: 'producto_id o categoria_id inválidos.' });
  res.json({ ok: true });
}));

// =====================================================================
// #V55 · Base de conocimiento (KB/FAQ) + bucle de aprendizaje (propose-only).
// Grounding del bot + vista "Conocimiento" del panel (gestor).
// =====================================================================

// Listado de entradas, filtrable por estado (propuesta/aprobada/rechazada/archivada).
router.get('/kb', asyncHandler(async (req, res) => {
  const estado = String(req.query.estado || '').trim() || undefined;
  const entradas = await kb.listarKB({ estado });
  res.json({ entradas });
}));

// Alta manual de una entrada (nace como propuesta salvo que se elija aprobada).
router.post('/kb', requireRole('gestor'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const entrada = await kb.crearKB({
    pregunta: b.pregunta,
    respuesta: b.respuesta,
    tags: b.tags,
    estado: b.estado,
    origen: 'manual',
    nota: b.nota,
  });
  res.status(201).json({ entrada });
}));

// Analizar conversaciones y proponer entradas nuevas (propose-only; nunca activa).
// Debe declararse antes de rutas con :id para no colisionar en POST.
router.post('/kb/generar-propuestas', requireRole('gestor'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const resultado = await generarPropuestas({
    dias: Number(b.dias) || 30,
    minRepeticiones: Number(b.minRepeticiones) || 2,
    maxPropuestas: Number(b.maxPropuestas) || 10,
  });
  res.json(resultado);
}));

// Edición de una entrada (pregunta/respuesta/tags/estado).
router.put('/kb/:id', requireRole('gestor'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const entrada = await kb.actualizarKB(req.params.id, {
    pregunta: b.pregunta,
    respuesta: b.respuesta,
    tags: b.tags,
    estado: b.estado,
  });
  res.json({ entrada });
}));

// Aprobar una propuesta (exige que tenga respuesta; si no, 400).
router.post('/kb/:id/aprobar', requireRole('gestor'), asyncHandler(async (req, res) => {
  const entrada = await kb.aprobarKB(req.params.id);
  res.json({ entrada });
}));

// Rechazar una propuesta (opcionalmente con nota/motivo).
router.post('/kb/:id/rechazar', requireRole('gestor'), asyncHandler(async (req, res) => {
  const entrada = await kb.rechazarKB(req.params.id, req.body?.nota);
  res.json({ entrada });
}));

// Borrar una entrada.
router.delete('/kb/:id', requireRole('gestor'), asyncHandler(async (req, res) => {
  await kb.borrarKB(req.params.id);
  res.json({ ok: true });
}));

// =====================================================================
// #V97 · Incidencias reportadas desde el panel (cualquier rol).
// Se guardan como eventos de auditoría (accion 'incidencia') para que
// el gestor las vea en la vista Auditoría sin migración nueva.
// =====================================================================
router.post('/incidencias', asyncHandler(async (req, res) => {
  const tipo = String(req.body?.tipo || '').trim();
  const texto = String(req.body?.detalle || '').trim();
  if (!tipo) return res.status(400).json({ error: 'Elige el tipo de incidencia.' });
  if (texto.length < 10) return res.status(400).json({ error: 'Describe la incidencia (mínimo 10 caracteres).' });

  const { error } = await getSupabase().from('auditoria').insert({
    accion: 'incidencia',
    entidad: 'incidencia',
    entidad_id: null,
    detalle: { tipo, texto: texto.slice(0, 1000) },
    usuario_id: req.user.id,
    usuario_nombre: req.user.usuario,
  });
  if (error) return res.status(503).json({ error: 'No se pudo registrar la incidencia. Inténtalo de nuevo.' });
  res.json({ ok: true });
}));

router.get('/incidencias', asyncHandler(async (req, res) => {
  let query = getSupabase()
    .from('auditoria')
    .select('id, created_at, detalle, usuario_id, usuario_nombre')
    .eq('accion', 'incidencia');
  // El operador solo ve las suyas; el gestor las verá todas en Auditoría.
  if (req.user.rol !== 'gestor') query = query.eq('usuario_id', req.user.id);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  res.json({ incidencias: data || [] });
}));

module.exports = router;
