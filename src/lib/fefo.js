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
//   2) Entre opciones equivalentes, FEFO desempata: primero el que vence antes.
//      El orden real de producción es el de `buscar_productos_bot` (RPC) y su
//      espejo `compararOrden` (src/lib/busqueda.js):
//        coincidencia > marca > [precio si "el más barato"] > rotación >
//        stock > FEFO > precio > nombre
//      El stock va ANTES que FEFO a propósito: con datos reales, anteponer FEFO
//      cambiaba el top-3 en 13/14 consultas y ofrecía combos con 1-5 unidades
//      para consultas genéricas ("ibuprofeno" -> ibuprofeno+cafeína; "crema" ->
//      crema vaginal). FEFO solo debe decidir entre opciones con el mismo stock.
// `ordenarRecomendados` delega en `compararOrden` para que no vuelva a haber
// deriva entre el modelo documentado y lo que hace el bot.
// Es lógica pura y determinista (sin BD) para poder testearla en scripts/.

const { compararOrden } = require('./busqueda');

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

// Orden de prioridad (idéntico al de producción). Cada candidato:
// { p: { nombre, precio, stock }, coinciden, marca, veces, venc }.
// `esBarato` = el cliente pidió explícitamente lo más barato.
function ordenarRecomendados(candidatos, { esBarato = false } = {}) {
  const normalizados = candidatos.map((c) => {
    const p = c.p || {};
    return {
      ref: c,
      coinciden: Number(c.coinciden) || 0,
      marca: Number(c.marca) || 0,
      veces: Number(c.veces) || 0,
      precio: Number(p.precio) || 0,
      stock: Number(p.stock) || 0,
      venc: c.venc == null ? null : new Date(c.venc).getTime(),
      nombre: p.nombre || '',
    };
  });
  normalizados.sort((a, b) => compararOrden(a, b, esBarato));
  return normalizados.map((n) => n.ref);
}

module.exports = { fechaHoy, aFechaISO, estaVencido, filtrarVigentes, ordenarRecomendados };
