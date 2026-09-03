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
  port: Number(process.env.PORT || 3000),
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
  supabase: {
    url: env('SUPABASE_URL', { required: true }),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY', { required: true }),
  },
  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN'),
    chatId: env('TELEGRAM_CHAT_ID'),
  },
  mostradorApiKey: env('MOSTRADOR_API_KEY', { required: true, fallback: 'dev-mostrador-key' }),
  adminConfigKey: env('ADMIN_CONFIG_KEY'),
};
