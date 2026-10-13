'use strict';

// #V57 · FEFO por lotes (motor de recomendación de consultar_precio_y_stock).
//
// `productos.fecha_vencimiento` es informativa y la calcula el RPC
// lotes_tpv_upsert como el MIN de vencimiento entre los lotes ACTIVOS con
// stock > 0 (ver farmacia-sync/sql/migracion-fefo-lotes.sql). Es decir, ya es
// la fecha FEFO real a nivel de producto (la del lote que caduca antes).
//
// Este módulo decide qué productos son ofrecibles y en qué orden se presentan:
//   1) Nunca se ofrece un producto ya vencido (no es vendible).
//   2) Entre opciones equivalentes, primero el que vence antes (FEFO), por
//      delante del stock, sin pisar la rotación (variedad) ni el precio cuando
//      el cliente pide explícitamente "lo más barato".
// Es lógica pura y determinista (sin BD) para poder testearla en scripts/.

// Fecha local del servidor como 'YYYY-MM-DD'.
function fechaHoy(ahora = new Date()) {
  const y = ahora.getFullYear();
  const m = String(ahora.getMonth() + 1).padStart(2, '0');
  const d = String(ahora.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Normaliza un valor de fecha (string ISO/date de PostgREST o Date) a
// 'YYYY-MM-DD'. Devuelve null si no es una fecha utilizable.
function aFechaISO(fecha) {
  if (!fecha) return null;
  if (typeof fecha === 'string') {
    const s = fecha.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) {
    const y = fecha.getUTCFullYear();
    const m = String(fecha.getUTCMonth() + 1).padStart(2, '0');
    const d = String(fecha.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

// ¿Venció? Sin fecha => no se considera vencido (no se sabe).
function estaVencido(fecha, hoy = fechaHoy()) {
  const f = aFechaISO(fecha);
  return f !== null && f < hoy;
}

// Descarta de los candidatos (cada uno con .venc) los ya vencidos.
function filtrarVigentes(candidatos, hoy = fechaHoy()) {
  return candidatos.filter((c) => !estaVencido(c.venc, hoy));
}

// Orden de prioridad. `esBarato` = el cliente pidió explícitamente lo más
// barato, en cuyo caso el precio manda (solo por encima de rotación/FEFO).
// Candidato: { p: { precio, stock }, coinciden, marca, veces, venc }.
function ordenarRecomendados(candidatos, { esBarato = false } = {}) {
  return candidatos.slice().sort((a, b) => {
    // 1) Mejor coincidencia de tokens.
    if (b.coinciden !== a.coinciden) return b.coinciden - a.coinciden;
    // 2) Marca específica mencionada.
    if (b.marca !== a.marca) return b.marca - a.marca;
    // 3) Precio: si el cliente pide "el más barato", el precio manda.
    if (esBarato && a.p.precio !== b.p.precio) return a.p.precio - b.p.precio;
    // 4) Rotación: menos veces recomendado primero (variar entre consultas).
    if (a.veces !== b.veces) return a.veces - b.veces;
    // 5) FEFO: primero el que vence antes; sin fecha conocida va al final.
    const av = a.venc || null;
    const bv = b.venc || null;
    if (av !== bv) {
      if (av === null) return 1;
      if (bv === null) return -1;
      return av < bv ? -1 : 1;
    }
    // 6) Más stock.
    if (b.p.stock !== a.p.stock) return b.p.stock - a.p.stock;
    // 7) Precio por defecto: más caro primero (para variedad).
    return b.p.precio - a.p.precio;
  });
}

module.exports = { fechaHoy, aFechaISO, estaVencido, filtrarVigentes, ordenarRecomendados };
