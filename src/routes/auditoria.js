'use strict';

// #V86 · Lectura de la auditoría para el gestor (solo lectura).
// `auditoria` es append-only y solo la escribe el servidor; aquí se expone
// paginada y filtrada, sin valores sensibles: `detalle` solo guarda los NOMBRES
// de los campos tocados, nunca su contenido.

const express = require('express');
const { getSupabase } = require('../lib/supabase');
const { requireAuth, requireRole } = require('../lib/auth');

const router = express.Router();

// Solo el gestor puede leer la auditoría.
router.use(requireAuth, requireRole('gestor'));

const CAMPOS = 'id, created_at, accion, entidad, entidad_id, detalle, usuario_nombre, ip';

// Sugerencias para el filtro (no es una lista cerrada: se filtra por igualdad).
const ACCIONES = [
  'login.ok',
  'login.fallo',
  'usuario.crear',
  'usuario.actualizar',
  'cliente.crear',
  'cliente.actualizar',
  'bot_config.update',
];

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function entero(valor, defecto, min, max) {
  const n = Number.parseInt(valor, 10);
  if (!Number.isFinite(n)) return defecto;
  return Math.min(max, Math.max(min, n));
}

function texto(valor, max) {
  if (typeof valor !== 'string') return '';
  return valor.trim().slice(0, max);
}

function fechaISO(valor, campo) {
  const s = texto(valor, 40);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`${campo} no es una fecha válida (usa ISO 8601).`);
    err.status = 400;
    err.statusCode = 400;
    throw err;
  }
  return d.toISOString();
}

router.get('/', asyncHandler(async (req, res) => {
  const limit = entero(req.query.limit, 50, 1, 200);
  const offset = entero(req.query.offset, 0, 0, 1000000);
  const accion = texto(req.query.accion, 60);
  const entidad = texto(req.query.entidad, 60);
  const usuario = texto(req.query.usuario, 60);
  const desde = fechaISO(req.query.desde, 'desde');
  const hasta = fechaISO(req.query.hasta, 'hasta');

  let q = getSupabase().from('auditoria').select(CAMPOS, { count: 'exact' });
  if (accion) q = q.eq('accion', accion);
  if (entidad) q = q.eq('entidad', entidad);
  if (usuario) q = q.eq('usuario_nombre', usuario);
  if (desde) q = q.gte('created_at', desde);
  if (hasta) q = q.lte('created_at', hasta);

  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  res.json({
    eventos: data || [],
    total: typeof count === 'number' ? count : null,
    limit,
    offset,
    acciones: ACCIONES,
  });
}));

module.exports = router;
