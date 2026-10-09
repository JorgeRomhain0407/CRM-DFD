'use strict';

const config = require('../config');

async function notifyHandoff({ telefono, nombre, motivo, causa, intent, ultimosMensajes, enlace }) {
  const { chatId, botToken } = config.telegram;
  if (!chatId || !botToken) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados — notificación omitida');
    return;
  }

  const origen = causa && causa !== 'llm' ? ` · derivado por: *${causa}*` : '';
  const lines = [
    `🚨 *Handoff — ${nombre || telefono}*`,
    `📞 ${telefono}${origen}`,
    motivo ? `💬 Motivo: ${motivo}` : '',
    intent ? `🎯 Intención detectada: ${intent}` : '',
    '',
    '--- Últimos mensajes ---',
    ...(ultimosMensajes || []).map((m) => {
      const icon = m.rol === 'usuario' ? '👤' : m.rol === 'operador' ? '🧑' : '🤖';
      return `${icon} ${String(m.contenido).slice(0, 250)}`;
    }),
    '',
    enlace ? `🔗 Abrir conversación: ${enlace}` : '',
  ].filter(Boolean);

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[telegram] Error ${res.status}: ${body.slice(0, 300)}`);
  }
}

// Alerta operativa genérica (sin Markdown para no romper el parseo con
// texto de error que pueda contener asteriscos/underscores).
async function notifyAlerta({ telefono, error }) {
  const { chatId, botToken } = config.telegram;
  if (!chatId || !botToken) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados — alerta omitida');
    return;
  }
  const detalles = String(error || '').slice(0, 300) || '(sin detalle)';
  const text = `⚠️ FALLO DEL BOT\n📞 ${telefono || 'sin teléfono'}\n🧪 ${detalles}`;
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[telegram] Error ${res.status}: ${body.slice(0, 300)}`);
  }
}

module.exports = { notifyHandoff, notifyAlerta };
