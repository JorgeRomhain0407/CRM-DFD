'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const webhookRouter = require('./routes/webhook');
const apiRouter = require('./routes/api');
const botRouter = require('./routes/bot');
const { iniciarVigilanteHandoff } = require('./services/handoff-timeout');

const app = express();

// Detras del proxy del VPS (X-Forwarded-For): sin esto express-rate-limit
// no identifica bien a los usuarios y ademas lanza ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Inténtalo de nuevo en un minuto.' },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'crm-dfd', uptime: process.uptime() });
});

app.use('/webhook', webhookLimiter, webhookRouter);
app.use('/api', apiLimiter, apiRouter);
app.use('/api/bot', apiLimiter, botRouter);

// Ruta de API desconocida: responder en JSON con el método y la ruta reales.
// Un "HTTP 404" mudo en el panel no dice nada; así el banner muestra
// exactamente qué se pidió y se puede diagnosticar sin abrir DevTools.
app.use('/api', (req, res) => {
  const ruta = req.originalUrl.split('?')[0];
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${ruta}` });
});

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  if (status >= 500) {
    console.error('[api] error interno:', err);
  }
  res.status(status).json({
    error: status >= 500 ? 'Error interno del servidor' : err.message,
  });
});

const server = app.listen(config.port, config.host, () => {
  // #V45 · Vigilante de handoffs: re-alerta al mostrador si nadie atiende.
  iniciarVigilanteHandoff();
  console.log(`CRM DFD escuchando en ${config.panelUrl}`);
  console.log(`Mostrador: ${config.panelUrl}`);
  console.log(`Webhook Meta: POST/GET ${config.panelUrl}/webhook`);
});

function shutdown(signal) {
  console.log(`\n[${signal}] Cerrando servidor...`);
  server.close(() => {
    console.log('Servidor cerrado.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forzando cierre.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
