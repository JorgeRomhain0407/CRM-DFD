'use strict';

require('dotenv').config();

const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';
const isDev = process.env.NODE_ENV === 'development';

// #V60 (D04/R3) · Fail-closed de configuración. Antes solo se lanzaba si
// NODE_ENV=production; con NODE_ENV sin fijar (o distinto) un despliegue
// accidental arrancaba con secretos predecibles de desarrollo. Ahora una
// variable `required` sin valor SIEMPRE lanza, salvo en desarrollo explícito
// (NODE_ENV=development), donde se usa un valor de desarrollo y se avisa.
function env(name, { required = false, fallback = '' } = {}) {
  const value = process.env[name];
  if (value) return value;
  if (!required) return fallback;
  if (isDev) {
    console.warn(`[config] ${name} sin definir: se usa un valor de DESARROLLO (nunca en producción).`);
    return fallback;
  }
  throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
}

// Secreto de sesión solo para desarrollo. Se genera aleatorio por proceso
// (nunca el literal predecible de antes): en dev las sesiones no sobreviven
// a un reinicio, que es lo deseable. En producción SESSION_SECRET es obligatorio.
const devSessionSecret =
  isDev && !process.env.SESSION_SECRET ? crypto.randomBytes(48).toString('hex') : '';

module.exports = {
  isProd,
  // #V49 · Deja el servicio escuchando solo en 127.0.0.1 cuando está detrás de
  // nginx: nadie debe tocar el puerto 3000 directamente (se saltaría TLS y el
  // rate limit). Sin HOST definido, conserva el comportamiento anterior (0.0.0.0).
  port: Number(process.env.PORT || 3000),
  host: env('HOST', { fallback: '0.0.0.0' }),
  defaultPhonePrefix: env('DEFAULT_PHONE_PREFIX', { fallback: '+34' }),
  meta: {
    verifyToken: env('META_VERIFY_TOKEN', { required: true, fallback: 'dev-verify-token' }),
    appSecret: env('META_APP_SECRET'),
    accessToken: env('META_ACCESS_TOKEN'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
  },
  openai: {
    apiKey: env('OPENAI_API_KEY', { required: true }),
    model: env('OPENAI_MODEL', { fallback: 'gpt-4o-mini' }),
  },
  // #V52 · Router de intents (tools por intent + overlays de prompt + memoria).
  // Revertible sin tocar código: BOT_INTENTS=0 restaura el comportamiento previo.
  intents: {
    enabled: env('BOT_INTENTS', { fallback: '1' }) !== '0',
  },
  // #V55 · Grounding en la base de conocimiento (KB/FAQ). Revertible sin tocar
  // código: BOT_KB=0 desactiva la inyección de conocimiento verificado.
  kb: {
    enabled: env('BOT_KB', { fallback: '1' }) !== '0',
    limite: Number(process.env.BOT_KB_LIMITE || 3),
  },
  supabase: {
    url: env('SUPABASE_URL', { required: true }),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY', { required: true }),
  },
  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN'),
    chatId: env('TELEGRAM_CHAT_ID'),
  },
  // #V59 · Sesiones del panel. En producción SESSION_SECRET es obligatorio
  // (fail-closed): sin él no se firman/validan las cookies de sesión. En
  // desarrollo (NODE_ENV=development explícito) se usa uno aleatorio por proceso.
  sessionSecret: env('SESSION_SECRET', { required: true, fallback: devSessionSecret }),
  sessionMaxAgeSec: Number(process.env.SESSION_MAX_AGE_SEC || 60 * 60 * 12),
  // Usuario gestor que se crea automáticamente la primera vez (tabla vacía).
  gestorInicial: {
    usuario: env('GESTOR_INICIAL_USUARIO'),
    password: env('GESTOR_INICIAL_PASSWORD'),
    nombre: env('GESTOR_INICIAL_NOMBRE', { fallback: 'Gestor' }),
  },
  // URL pública del panel del mostrador (para enlaces en las notificaciones).
  // Sin PANEL_URL configurado: se arma una a partir del puerto local.
  panelUrl: env('PANEL_URL', { fallback: `http://localhost:${process.env.PORT || 3000}` }),
  // Minutos de espera sin atención en esperando_operador antes de re-alertar.
  handoffAlertaMinutos: Number(process.env.HANDOFF_ALERTA_MINUTOS || 30),
};
