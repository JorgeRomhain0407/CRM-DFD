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
    // #V57b · Modelo por intent (opt-in). Por defecto INERTE: `ligero` vacío y
    // `intents` = {saludo}; además sin OPENAI_MODEL_LIGERO no hay ahorro posible,
    // así que el modelo sigue siendo `openai.model` hasta configurar ambas vars.
    modeloPorIntent: {
      enabled: env('BOT_MODELO_POR_INTENT', { fallback: '1' }) !== '0',
      ligero: env('OPENAI_MODEL_LIGERO'),
      intents: new Set(
        env('BOT_MODELO_INTENTS_LIGEROS', { fallback: 'saludo' })
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    },
  },
  // #V57a · Búsqueda de productos en una sola RPC (buscar_productos_bot).
  // Revertible sin tocar código: BOT_BUSQUEDA_RPC=0 usa el buscador JS clásico.
  busqueda: {
    rpc: env('BOT_BUSQUEDA_RPC', { fallback: '1' }) !== '0',
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
  // #V64 · Recomendaciones al cliente (tool `recomendar_productos`). Revertible
  // sin tocar código: BOT_RECOMENDACIONES=0 la retira de las tools del bot.
  // Además, recomendación PROACTIVA (opt-in, D06): BOT_RECOMENDACIONES_PROACTIVAS=1;
  // `proactivasDias` = antispam entre sugerencias.
  recomendaciones: {
    enabled: env('BOT_RECOMENDACIONES', { fallback: '1' }) !== '0',
    proactivas: env('BOT_RECOMENDACIONES_PROACTIVAS', { fallback: '0' }) === '1',
    proactivasDias: Number(process.env.BOT_RECOMENDACIONES_DIAS || 7),
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
