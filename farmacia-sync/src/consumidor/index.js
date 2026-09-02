'use strict';

require('dotenv').config();

const { execFileSync } = require('child_process');
const path = require('path');

const INTERVALO_MIN = (() => {
  const n = Number(process.env.CRM_SYNC_INTERVAL_MIN);
  return Number.isFinite(n) && n > 0 ? n : 15;
})();

function ejecutarSync() {
  const script = path.join(__dirname, 'sync.js');
  try {
    execFileSync(process.execPath, [script], { encoding: 'utf8' });
  } catch (err) {
    console.error('[consumidor] falló la ejecución de sync.js', err.stderr || err.message);
  }
}

console.log(`[consumidor] sincronización programada cada ${INTERVALO_MIN} minutos.`);
ejecutarSync();
setInterval(ejecutarSync, INTERVALO_MIN * 60 * 1000);