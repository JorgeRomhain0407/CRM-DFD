'use strict';

const express = require('express');
const config = require('../config');
const { toE164, assertE164 } = require('../lib/phone');
const { getSupabase, rpc } = require('../lib/supabase');
const { ensureCliente } = require('../services/customers');

const router = express.Router();

function requireMostrador(req, res, next) {
  const key = req.get('x-api-key') || req.query.api_key;
  if (!key || key !== config.mostradorApiKey) {
    return res.status(401).json({ error: 'No autorizado. Envía header x-api-key.' });
  }
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.use(requireMostrador);

router.get('/productos', asyncHandler(async (_req, res) => {
  const { data, error } = await getSupabase()
    .from('productos')
    .select('id, nombre, descripcion, precio, stock, activo')
    .eq('activo', true)
    .order('nombre');
  if (error) throw error;
  res.json({ productos: data });
}));

router.get('/clientes', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  let query = getSupabase()
    .from('clientes')
    .select('telefono, nombre, edad, habitos_consumo, fecha_registro, estado_chat ( estado, motivo_handoff, ultima_actualizacion )')
    .order('fecha_registro', { ascending: false })
    .limit(50);
  if (q) {
    if (q.startsWith('+') || /^\d+$/.test(q)) {
      query = query.ilike('telefono', `%${q.replace(/%/g, '')}%`);
    } else {
      query = query.ilike('nombre', `%${q.replace(/%/g, '')}%`);
    }
  }
  const { data, error } = await query;
  if (error) throw error;
  res.json({ clientes: data });
}));

router.get('/clientes/:telefono', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.params.telefono, config.defaultPhonePrefix));
  const { data, error } = await getSupabase()
    .from('clientes')
    .select('telefono, nombre, edad, habitos_consumo, fecha_registro, estado_chat ( estado, motivo_handoff, ultima_actualizacion )')
    .eq('telefono', telefono)
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'Cliente no encontrado.' });
  res.json({ cliente: data });
}));

router.put('/clientes', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.body.telefono, config.defaultPhonePrefix));
  const payload = { telefono };
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

  await ensureCliente(telefono);
  const { data, error } = await getSupabase()
    .from('clientes')
    .update({
      nombre: payload.nombre,
      edad: payload.edad,
      habitos_consumo: payload.habitos_consumo,
    })
    .eq('telefono', telefono)
    .select()
    .single();
  if (error) throw error;
  res.json({ cliente: data });
}));

router.patch('/estado-chat/:telefono', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.params.telefono, config.defaultPhonePrefix));
  const permitido = ['bot_activo', 'esperando_operador', 'humano_activo'];
  if (!permitido.includes(req.body.estado)) {
    return res.status(400).json({ error: 'estado inválido' });
  }
  await ensureCliente(telefono);
  const { data, error } = await getSupabase()
    .from('estado_chat')
    .update({
      estado: req.body.estado,
      motivo_handoff: req.body.motivo || null,
    })
    .eq('telefono_cliente', telefono)
    .select()
    .single();
  if (error) throw error;
  res.json({ estado_chat: data });
}));

router.post('/ventas', asyncHandler(async (req, res) => {
  const telefono = assertE164(toE164(req.body.telefono, config.defaultPhonePrefix));
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Incluye al menos un ítem.' });

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.ok) {
      return res.status(409).json({ error: row?.mensaje || 'No se pudo registrar la venta', resultados });
    }
    resultados.push({ ...item, ...row });
  }
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

router.get('/ventas', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const { data, error } = await getSupabase()
    .from('ventas')
    .select('id, cantidad, precio_unitario, canal, created_at, telefono_cliente, clientes ( nombre ), productos ( nombre )')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const ventas = (data || []).map((v) => ({
    id: v.id,
    telefono: v.telefono_cliente,
    cliente_nombre: v.clientes?.nombre || null,
    producto_nombre: v.productos?.nombre || null,
    cantidad: v.cantidad,
    precio_unitario: Number(v.precio_unitario),
    subtotal: Number((v.precio_unitario * v.cantidad).toFixed(2)),
    canal: v.canal,
    fecha: v.created_at,
  }));

  res.json({ ventas });
}));

router.get('/ventas/resumen', asyncHandler(async (_req, res) => {
  const { data, error } = await getSupabase()
    .from('ventas')
    .select('canal, cantidad, precio_unitario');
  if (error) throw error;

  let totalIngresos = 0;
  let totalUnidades = 0;
  const porCanal = {};

  for (const v of data || []) {
    const subtotal = Number(v.precio_unitario) * v.cantidad;
    totalIngresos += subtotal;
    totalUnidades += v.cantidad;
    if (!porCanal[v.canal]) porCanal[v.canal] = { ingresos: 0, unidades: 0, ventas: 0 };
    porCanal[v.canal].ingresos += subtotal;
    porCanal[v.canal].unidades += v.cantidad;
    porCanal[v.canal].ventas += 1;
  }

  res.json({
    total_ingresos: Number(totalIngresos.toFixed(2)),
    total_unidades: totalUnidades,
    total_ventas: data?.length || 0,
    por_canal: porCanal,
  });
}));

module.exports = router;
