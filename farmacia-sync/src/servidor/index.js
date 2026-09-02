'use strict';

require('dotenv').config();

const express = require('express');
const { loadDriver } = require('../drivers');

const PORT = Number(process.env.FARMACIA_SYNC_PORT || 4000);
const API_TOKEN = process.env.FARMACIA_SYNC_TOKEN || ''; // si vacío, sin auth (lanzar warning)

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

app.get('/productos', requireAuth, async (_req, res) => {
  try {
    const driver = loadDriver(process.env.FARMACIA_SYNC_DB_TIPO);
    const config = {
      file: process.env.FARMACIA_SYNC_DB_FILE,
      server: process.env.FARMACIA_SYNC_DB_SERVER,
      port: process.env.FARMACIA_SYNC_DB_PORT,
      user: process.env.FARMACIA_SYNC_DB_USER,
      password: process.env.FARMACIA_SYNC_DB_PASSWORD,
      database: process.env.FARMACIA_SYNC_DB_DATABASE,
      tabla: process.env.FARMACIA_SYNC_DB_TABLA,
      where: process.env.FARMACIA_SYNC_DB_DONDE,
      columnas: {
        sku: process.env.FARMACIA_SYNC_COL_SKU,
        nombre: process.env.FARMACIA_SYNC_COL_NOMBRE,
        descripcion: process.env.FARMACIA_SYNC_COL_DESCRIPCION,
        precio: process.env.FARMACIA_SYNC_COL_PRECIO,
        stock: process.env.FARMACIA_SYNC_COL_STOCK,
      },
    };
    const productos = await driver.leerProductos(config);
    res.setHeader('X-Farmacia-Sync', '1.0');
    res.json({ productos });
  } catch (err) {
    console.error('[farmacia-sync] error en /productos', err);
    res.status(500).json({ error: 'Error al leer el catálogo del TPV', detalle: err.message });
  }
});

app.listen(PORT, () => {
  if (!API_TOKEN) {
    console.warn('[farmacia-sync] ⚠️  FARMACIA_SYNC_TOKEN vacío: el endpoint /productos está SIN autenticación.');
  }
  console.log(`[farmacia-sync] servidor escuchando en http://localhost:${PORT}`);
});
