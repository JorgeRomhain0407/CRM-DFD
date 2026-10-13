'use strict';

// #V59 · Gestión de usuarios del panel (solo gestor).
const express = require('express');
const { getSupabase } = require('../lib/supabase');
const { requireAuth, requireRole, hashPassword } = require('../lib/auth');
const { registrarAuditoria } = require('../services/auditoria');

const router = express.Router();

router.use(requireAuth, requireRole('gestor'));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const ROLES = ['operador', 'gestor'];
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;
const CAMPOS = 'id, usuario, nombre, rol, activo, ultimo_login, created_at';

const publicUser = (u) => ({
  id: u.id,
  usuario: u.usuario,
  nombre: u.nombre,
  rol: u.rol,
  activo: u.activo,
  ultimo_login: u.ultimo_login,
  created_at: u.created_at,
});

async function contarGestoresActivos() {
  const { count, error } = await getSupabase()
    .from('usuarios')
    .select('id', { count: 'exact', head: true })
    .eq('rol', 'gestor')
    .eq('activo', true);
  if (error) throw error;
  return count || 0;
}

router.get('/', asyncHandler(async (_req, res) => {
  const { data, error } = await getSupabase()
    .from('usuarios')
    .select(CAMPOS)
    .order('created_at', { ascending: true });
  if (error) throw error;
  res.json({ usuarios: (data || []).map(publicUser) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const usuario = String(req.body?.usuario || '').trim().toLowerCase();
  const nombre = String(req.body?.nombre || '').trim().slice(0, 120);
  const password = String(req.body?.password || '');
  const rol = String(req.body?.rol || 'operador');

  if (!USERNAME_RE.test(usuario)) {
    return res.status(400).json({ error: 'Usuario inválido: 3-32 caracteres (a-z, 0-9, . _ -).' });
  }
  if (!ROLES.includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido.' });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` });
  }

  const { data, error } = await getSupabase()
    .from('usuarios')
    .insert({
      usuario,
      nombre: nombre || usuario,
      rol,
      password_hash: hashPassword(password),
      activo: true,
      token_version: 1,
    })
    .select(CAMPOS)
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ese nombre de usuario ya existe.' });
    throw error;
  }
  // #V60 (D04/R5) · Auditoría de alta de usuario.
  registrarAuditoria({
    accion: 'usuario.crear',
    entidad: 'usuarios',
    entidadId: data.id,
    campos: ['usuario', 'nombre', 'rol'],
    usuario: req.user,
    ip: req.ip,
  });
  res.status(201).json({ usuario: publicUser(data) });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const supabase = getSupabase();
  const { data: actual, error: errGet } = await supabase
    .from('usuarios')
    .select(CAMPOS)
    .eq('id', req.params.id)
    .maybeSingle();
  if (errGet) throw errGet;
  if (!actual) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const payload = {};
  if (req.body?.nombre !== undefined) {
    payload.nombre = String(req.body.nombre || '').trim().slice(0, 120) || actual.usuario;
  }
  if (req.body?.rol !== undefined) {
    const rol = String(req.body.rol);
    if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido.' });
    payload.rol = rol;
  }
  if (req.body?.activo !== undefined) {
    payload.activo = Boolean(req.body.activo);
  }

  // ¿La actualización deja al usuario sin ser "gestor activo"?
  const eraGestorActivo = actual.rol === 'gestor' && actual.activo;
  const seraGestorActivo =
    (payload.rol ?? actual.rol) === 'gestor' && (payload.activo ?? actual.activo);
  if (eraGestorActivo && !seraGestorActivo) {
    if (actual.id === req.user.id) {
      return res.status(409).json({ error: 'No puedes desactivar ni degradar tu propia cuenta.' });
    }
    if ((await contarGestoresActivos()) <= 1) {
      return res.status(409).json({ error: 'Debe quedar al menos un gestor activo.' });
    }
  }

  // Cambio de contraseña (por el propio usuario o un gestor).
  if (req.body?.password !== undefined && req.body.password !== '') {
    const password = String(req.body.password);
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` });
    }
    payload.password_hash = hashPassword(password);
  }

  // Cualquier cambio de credenciales rol/estado invalida las sesiones abiertas.
  if (payload.password_hash || payload.rol !== undefined || payload.activo !== undefined) {
    payload.token_version = (actual.token_version ?? 1) + 1;
  }

  if (!Object.keys(payload).length) {
    return res.status(400).json({ error: 'Nada que actualizar.' });
  }

  const { data, error } = await supabase
    .from('usuarios')
    .update(payload)
    .eq('id', req.params.id)
    .select(CAMPOS)
    .single();
  if (error) throw error;
  // #V60 (D04/R5) · Auditoría: altas/bajas de rol, estado y contraseña.
  registrarAuditoria({
    accion: 'usuario.actualizar',
    entidad: 'usuarios',
    entidadId: data.id,
    campos: Object.keys(payload).map((c) => (c === 'password_hash' ? 'password' : c)),
    usuario: req.user,
    ip: req.ip,
  });
  res.json({ usuario: publicUser(data) });
}));

module.exports = router;
