'use strict';

require('dotenv').config();

const express = require('express');
// Late binding a propósito: si algo del grafo de módulos forma un ciclo,
// `drivers.loadDriver` todavía no existe al destructurar y quedaba undefined
// para siempre (warning "non-existent property ... inside circular dependency").
const drivers = require('../drivers');

const PORT = Number(process.env.FARMACIA_SYNC_PORT || 4000);
const API_TOKEN = process.env.FARMACIA_SYNC_TOKEN || ''; // si vacío, sin auth (lanzar warning)
// 127.0.0.1 por defecto: el catálogo del TPV no se expone a la red local.
const HOST = process.env.FARMACIA_SYNC_HOST || '127.0.0.1';

const app = express();
app.use(express.json());

function requireAuth(req, res, next) {
  if (!API_TOKEN) return next();
  const key = req.get('x-api-key');
  if (!key || key !== API_TOKEN) {
    return res.status(401).json({ error: 'No autorizado. Envía header x-api-key.' });
  }
  next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'farmacia-sync', time: new Date().toISOString() });
});

function construirConfig() {
  return {
    file: process.env.FARMACIA_SYNC_DB_FILE,
    server: process.env.FARMACIA_SYNC_DB_SERVER,
    port: process.env.FARMACIA_SYNC_DB_PORT,
    user: process.env.FARMACIA_SYNC_DB_USER,
    password: process.env.FARMACIA_SYNC_DB_PASSWORD,
    database: process.env.FARMACIA_SYNC_DB_DATABASE,
    tabla: process.env.FARMACIA_SYNC_DB_TABLA,
    donde: process.env.FARMACIA_SYNC_DB_DONDE,
    perfil: process.env.FARMACIA_SYNC_PERFIL,
    columnas: {
      sku: process.env.FARMACIA_SYNC_COL_SKU,
      nombre: process.env.FARMACIA_SYNC_COL_NOMBRE,
      descripcion: process.env.FARMACIA_SYNC_COL_DESCRIPCION,
      precio: process.env.FARMACIA_SYNC_COL_PRECIO,
      stock: process.env.FARMACIA_SYNC_COL_STOCK,
      precioUsd: process.env.FARMACIA_SYNC_COL_PRECIOUSD,
      marca: process.env.FARMACIA_SYNC_COL_MARCA,
    },
    lotes: process.env.FARMACIA_SYNC_LOTES_TABLA?.trim()
      ? {
          tabla: process.env.FARMACIA_SYNC_LOTES_TABLA,
          donde: process.env.FARMACIA_SYNC_LOTES_DONDE,
          columnas: {
            sku: process.env.FARMACIA_SYNC_LOTES_COL_SKU,
            lote: process.env.FARMACIA_SYNC_LOTES_COL_LOTE,
            fechaVencimiento: process.env.FARMACIA_SYNC_LOTES_COL_FECHA_VENCIMIENTO,
            stock: process.env.FARMACIA_SYNC_LOTES_COL_STOCK,
          },
        }
      : null,
  };
}

app.get('/productos', requireAuth, async (_req, res) => {
  try {
    const driver = drivers.loadDriver(process.env.FARMACIA_SYNC_DB_TIPO);
    const config = construirConfig();

    const productos = await driver.leerProductos(config);
    // Los lotes se leen si hay tabla configurada o si el perfil del TPV los
    // provee (p.ej. soinfarma). Un fallo aquí nunca tumba el catálogo.
    const lotesActivo =
      (config.lotes || String(config.perfil || '').trim().toLowerCase() === 'soinfarma') &&
      typeof driver.leerLotes === 'function';
    let lotes = null;
    if (lotesActivo) {
      try {
        lotes = await driver.leerLotes(config);
      } catch (errLotes) {
        console.error('[farmacia-sync] error leyendo lotes:', errLotes.message);
        lotes = null;
      }
    }
    res.setHeader('X-Farmacia-Sync', '1.1');
    res.json({ productos, lotes });
  } catch (err) {
    console.error('[farmacia-sync] error en /productos', err);
    res.status(500).json({ error: 'Error al leer el catálogo del TPV', detalle: err.message });
  }
});

app.get('/clientes', requireAuth, async (req, res) => {
  try {
    const driver = drivers.loadDriver(process.env.FARMACIA_SYNC_DB_TIPO);
    if (typeof driver.leerClientes !== 'function') {
      return res.status(501).json({
        error: 'El driver configurado no soporta lectura de clientes (requiere mssql + perfil soinfarma).',
      });
    }

    const desde = req.query.desde ? String(req.query.desde) : null;
    if (desde && isNaN(new Date(desde).getTime())) {
      return res.status(400).json({ error: 'Parámetro "desde" inválido (usa ISO 8601).' });
    }

    const clientes = await driver.leerClientes(construirConfig(), { desde });
    res.setHeader('X-Farmacia-Sync', '1.2');
    res.json({ clientes, desde, total: clientes.length });
  } catch (err) {
    console.error('[farmacia-sync] error en /clientes', err);
    res.status(500).json({ error: 'Error al leer los clientes del TPV', detalle: err.message });
  }
});

app.listen(PORT, HOST, () => {
  if (!API_TOKEN) {
    console.warn('[farmacia-sync] ⚠️  FARMACIA_SYNC_TOKEN vacío: /productos y /clientes están SIN autenticación.');
  }
  console.log(`[farmacia-sync] servidor escuchando en http://${HOST}:${PORT}`);
});
