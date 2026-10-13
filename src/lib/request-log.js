'use strict';

// #V60 (D04/R5 · #V56) · Access log estructurado: una línea JSON por petición.
// Deliberadamente NO registra cuerpo, query ni cabeceras: solo método, ruta
// (sin query), estado, duración, IP y un id de correlación. Así el log sirve
// para diagnóstico y para trazar accesos sin volcar PII ni secretos
// (RGPD/LOPDGDD) y sin exponer tokens que viajan en query strings.

const crypto = require('crypto');

function requestLog() {
  return (req, res, next) => {
    const inicio = process.hrtime.bigint();
    const id = crypto.randomUUID();
    res.setHeader('X-Request-Id', id);

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
      const entry = {
        t: new Date().toISOString(),
        id,
        m: req.method,
        p: req.originalUrl.split('?')[0],
        s: res.statusCode,
        ms: Math.round(ms),
        ip: req.ip,
      };
      // stdout en una sola línea: fácil de ingerir y grep-ear.
      console.log(`[access] ${JSON.stringify(entry)}`);
    });

    next();
  };
}

module.exports = { requestLog };
