'use strict';

// D03 · Inspecciona un cliente y cuenta sus filas relacionadas (solo lectura).
// Uso: node scripts/check-cliente.js +34900989518
require('dotenv').config();

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEL = process.argv[2];

if (!BASE || !KEY) {
  console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}
if (!TEL) {
  console.error('Uso: node scripts/check-cliente.js <telefono E.164>');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function getCliente(tel) {
  const r = await fetch(`${BASE}/rest/v1/clientes?telefono=eq.${encodeURIComponent(tel)}&select=*`, { headers });
  if (!r.ok) throw new Error(`clientes HTTP ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}

async function contar(tabla, col, tel) {
  const r = await fetch(
    `${BASE}/rest/v1/${tabla}?${col}=eq.${encodeURIComponent(tel)}&select=${col}`,
    { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } }
  );
  if (!r.ok) return { tabla, error: `HTTP ${r.status}` };
  const cr = r.headers.get('content-range') || '';
  const total = cr.includes('/') ? Number(cr.split('/')[1]) : null;
  return { tabla, filas: Number.isFinite(total) ? total : null };
}

async function main() {
  const cliente = await getCliente(TEL);
  const tablas = [
    ['mensajes', 'telefono_cliente'],
    ['estado_chat', 'telefono_cliente'],
    ['cliente_eventos', 'telefono_cliente'],
    ['cliente_habitos', 'telefono_cliente'],
    ['carritos', 'telefono_cliente'],
    ['carritos_temporales', 'telefono_cliente'],
    ['puntos_movimientos', 'telefono_cliente'],
    ['ventas', 'telefono_cliente'],
  ];
  const conteos = [];
  for (const [t, c] of tablas) conteos.push(await contar(t, c, TEL));

  console.log(JSON.stringify({ telefono: TEL, existe: !!cliente, cliente, conteos }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('FALLO:', err.message || err);
  process.exit(1);
});
