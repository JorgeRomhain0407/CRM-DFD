'use strict';

const config = require('../config');

async function notifyHandoff({ telefono, nombre, motivo, ultimosMensajes, enlace }) {
  const { chatId, botToken } = config.telegram;
  if (!chatId || !botToken) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados — notificación omitida');
    return;
  }

  const lines = [
    `🚨 *Handoff — ${nombre || telefono}*`,
    `📞 ${telefono}`,
    motivo ? `💬 Motivo: ${motivo}` : '',
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

module.exports = { notifyHandoff };
