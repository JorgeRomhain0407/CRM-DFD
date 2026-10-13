'use strict';

// #V59 · Endpoints de sesión del panel.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getSupabase } = require('../lib/supabase');
const {
  verifyPassword,
  createToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} = require('../lib/auth');
const { registrarAuditoria } = require('../services/auditoria');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Límite propio y más estricto que el general: frena la fuerza bruta.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.' },
});

const publicUser = (u) => ({ usuario: u.usuario, nombre: u.nombre, rol: u.rol });

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const usuario = String(req.body?.usuario || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  const { data, error } = await getSupabase()
    .from('usuarios')
    .select('id, usuario, nombre, rol, activo, token_version, password_hash')
    .eq('usuario', usuario)
    .maybeSingle();
  if (error) throw error;

  if (!data || !data.activo || !verifyPassword(password, data.password_hash)) {
    // #V60 (D04/R5) · Auditoría de intentos fallidos (fuerza bruta / cuenta).
    registrarAuditoria({ accion: 'login.fallo', entidad: 'usuarios', entidadId: usuario, ip: req.ip });
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  const { error: upErr } = await getSupabase()
    .from('usuarios')
    .update({ ultimo_login: new Date().toISOString() })
    .eq('id', data.id);
  if (upErr) console.error('[auth] ultimo_login:', upErr.message);

  // #V60 (D04/R5) · Auditoría de login correcto.
  registrarAuditoria({ accion: 'login.ok', entidad: 'usuarios', entidadId: data.id, usuario: data, ip: req.ip });

  setSessionCookie(res, createToken(data));
  res.json({ usuario: publicUser(data) });
}));

router.post('/logout', asyncHandler(async (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ usuario: publicUser(req.user) });
});

module.exports = router;
