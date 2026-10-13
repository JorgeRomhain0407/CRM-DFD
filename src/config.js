'use strict';

require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

function env(name, { required = false, fallback = '' } = {}) {
  const value = process.env[name];
  if (required && !value && isProd) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value || fallback;
}

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
  // #V56 · Recomendaciones al cliente (tool `recomendar_productos`). Revertible
  // sin tocar código: BOT_RECOMENDACIONES=0 la retira de las tools del bot.
  recomendaciones: {
    enabled: env('BOT_RECOMENDACIONES', { fallback: '1' }) !== '0',
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
  // (fail-closed): sin él no se firman/validan las cookies de sesión.
  sessionSecret: env('SESSION_SECRET', { required: true, fallback: 'dev-session-secret-change-me' }),
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
