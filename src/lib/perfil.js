'use strict';

// #V56 · Derivación del perfil de consumo de un cliente a partir de lo que ya
// compró (tabla `ventas`) y de lo que miró (`cliente_eventos` tipo
// `producto_visto`). Puro: sin fs, red ni Supabase → testeable con
// `node scripts/test-perfil.js`.
//
// El resultado se fusiona (merge) en `clientes.perfil` (JSONB) preservando las
// claves que NO gestionamos aquí (puntos, habitos, edad, alertas…). Lo LEE
// `src/services/ai.js` (PERFIL_CONSUMO) para personalizar las respuestas.

// Palabras que no aportan como "interés" (conectores, formas y unidades de medida).
const STOP = new Set([
  'para', 'con', 'sin', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'del', 'por',
  'mas', 'tipo', 'sabor', 'plus', 'forte', 'fuerte', 'vital',
  'comprimido', 'comprimidos', 'capsula', 'capsulas', 'tableta', 'tabletas',
  'jarabe', 'sobre', 'sobres', 'polvo', 'granulado', 'gotas', 'monodosis',
  'mililitro', 'gramo', 'gramos', 'miligramo', 'miligramos', 'microgramo',
  'litro', 'unidad', 'unidades', 'cada', 'recubierto', 'recubiertos',
  'unds', 'comp', 'caps', 'tabs', 'caja', 'cajas', 'tubo', 'frasco', 'blister',
  'envase', 'paquete', 'rollo', 'par',
]);

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tokens "significativos" de un nombre de producto (interés potencial).
function tokensDeNombre(nombre) {
  return normalizar(nombre)
    .split(' ')
    .filter((t) => t.length >= 4 && /^[a-z]+$/.test(t) && !STOP.has(t));
}

function contarCategorias(purchases) {
  const cuenta = {};
  for (const p of purchases || []) {
    if (!p || !p.categoria) continue;
    cuenta[p.categoria] = (cuenta[p.categoria] || 0) + 1;
  }
  return cuenta;
}

// Ponderación de intereses: una compra vale más que una simple vista.
function contarTokens(purchases, vistas) {
  const peso = new Map();
  const sumar = (nombre, w) => {
    for (const t of tokensDeNombre(nombre)) peso.set(t, (peso.get(t) || 0) + w);
  };
  for (const p of purchases || []) sumar(p && p.nombre, 2);
  for (const v of vistas || []) sumar(typeof v === 'string' ? v : v && v.nombre, 1);
  return peso;
}

function topTokens(peso, n = 8) {
  return [...peso.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([t]) => t);
}

function ultimaCompra(purchases) {
  let max = null;
  for (const p of purchases || []) {
    if (p && p.fecha && (!max || p.fecha > max)) max = p.fecha;
  }
  return max;
}

// purchases: [{ categoria, nombre, fecha }]; vistas: [nombre | {nombre}]
function calcularFragmento({ purchases = [], vistas = [] } = {}) {
  return {
    categorias: contarCategorias(purchases),
    intereses: topTokens(contarTokens(purchases, vistas), 8),
    ultima_compra: ultimaCompra(purchases),
    compras: purchaseCount(purchases),
  };
}

function purchaseCount(purchases) {
  return (purchases || []).length;
}

// Merge en el perfil existente: sobrescribe SOLO lo que gestionamos y preserva
// el resto (puntos, habitos, edad, alertas…). Nunca borra con datos vacíos.
function fusionarPerfil(actual, fragmento) {
  const base = actual && typeof actual === 'object' ? { ...actual } : {};
  if (fragmento && typeof fragmento === 'object') {
    if (fragmento.categorias && Object.keys(fragmento.categorias).length) base.categorias = fragmento.categorias;
    if (Array.isArray(fragmento.intereses) && fragmento.intereses.length) base.intereses = fragmento.intereses;
    if (fragmento.ultima_compra) base.ultima_compra = fragmento.ultima_compra;
    if (fragmento.compras) base.compras = fragmento.compras;
  }
  return base;
}

module.exports = { calcularFragmento, fusionarPerfil, tokensDeNombre, normalizar, STOP };
