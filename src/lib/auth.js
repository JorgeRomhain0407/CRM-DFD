'use strict';

// #V59 · Autenticación del panel (sustituye a la clave compartida x-api-key).
// Sesión = cookie HttpOnly firmada con HMAC (SESSION_SECRET). Contraseñas con
// scrypt. token_version permite invalidar sesiones (baja de usuario, cambio de
// contraseña o de rol) sin esperar a que caduque el token.

const crypto = require('crypto');
const config = require('../config');
const { getSupabase } = require('./supabase');

const COOKIE_NAME = 'dfd_session';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ----------------------------- contraseñas ----------------------------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    if (!salt.length || !expected.length) return false;
    const actual = crypto.scryptSync(String(password), salt, expected.length, { N, r, p });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------- sesión -------------------------------- */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signSession(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', config.sessionSecret).update(body).digest());
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', config.sessionSecret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

function createToken(usuario, maxAgeSec = config.sessionMaxAgeSec) {
  const now = Math.floor(Date.now() / 1000);
  return signSession({
    uid: usuario.id,
    rol: usuario.rol,
    tv: usuario.token_version,
    iat: now,
    exp: now + maxAgeSec,
  });
}

/* ------------------------------- cookies ------------------------------- */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function cookieAttrs(value, maxAgeSec) {
  const attrs = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.isProd) attrs.push('Secure');
  return attrs.join('; ');
}

function setSessionCookie(res, token) {
  res.append('Set-Cookie', cookieAttrs(token, config.sessionMaxAgeSec));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', cookieAttrs('', 0));
}

/* ------------------------------ middlewares ---------------------------- */

async function loadUsuarioById(id) {
  const { data, error } = await getSupabase()
    .from('usuarios')
    .select('id, usuario, nombre, rol, activo, token_version')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Verifica la cookie y revalida contra la BD en cada petición (barato: lookup
// por PK) para que desactivar a un usuario o cambiar su rol tenga efecto
// inmediato, sin depender del TTL del token.
function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const payload = verifySession(token);
  if (!payload) return res.status(401).json({ error: 'No autenticado.' });
  loadUsuarioById(payload.uid)
    .then((u) => {
      if (!u || !u.activo || u.token_version !== payload.tv) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Sesión no válida. Vuelve a entrar.' });
      }
      req.user = u;
      next();
    })
    .catch(next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
    }
    next();
  };
}

/* ------------------------------ bootstrap ------------------------------ */

// Crea el gestor inicial si la tabla está vacía y hay credenciales en el
// entorno. Sin usuarios y sin entorno: en producción no arranca (fail-closed),
// en desarrollo avisa.
async function ensureGestorInicial() {
  const { count, error } = await getSupabase()
    .from('usuarios')
    .select('id', { count: 'exact', head: true });
  if (error) {
    console.error('[auth] no se pudo comprobar usuarios:', error.message);
    return false;
  }
  if (count > 0) return false;

  const { usuario, password, nombre } = config.gestorInicial;
  if (!usuario || !password) {
    const msg =
      '[auth] La tabla usuarios está vacía y faltan GESTOR_INICIAL_USUARIO/GESTOR_INICIAL_PASSWORD.';
    if (config.isProd) throw new Error(msg);
    console.warn(`${msg} Crea un gestor a mano antes de usar el panel.`);
    return false;
  }

  const { error: insErr } = await getSupabase().from('usuarios').insert({
    usuario: usuario.toLowerCase(),
    nombre: nombre || 'Gestor',
    rol: 'gestor',
    password_hash: hashPassword(password),
    activo: true,
    token_version: 1,
  });
  if (insErr) throw insErr;
  console.log(`[auth] Gestor inicial "${usuario}" creado.`);
  return true;
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createToken,
  signSession,
  verifySession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  loadUsuarioById,
  requireAuth,
  requireRole,
  ensureGestorInicial,
};
