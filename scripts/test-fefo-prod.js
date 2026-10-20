'use strict';

// #V87 · Auditoría FEFO con datos reales (SOLO LECTURA: no toca stock).
// Verifica, contra la BD de producción:
//   1) `productos.fecha_vencimiento` == MIN(vencimiento de lotes activos con stock).
//   2) Ningún producto activo con lotes queda sin fecha FEFO.
//   3) Los productos vencidos con stock NO se ofrecen (camino JS y RPC).
//   4) Paridad RPC `buscar_productos_bot` ↔ buscador JS (mismos ids y orden).
//   5) FEFO como desempate: en el orden real de producción, dentro de candidatos
//      empatados en todo menos la fecha, vence primero el más próximo (y sin
//      fecha, al final).
//
// Uso: node scripts/test-fefo-prod.js

require('dotenv').config();

const { getSupabase, rpc } = require('../src/lib/supabase');
const { consultarPrecioYStockJS } = require('../src/services/tools');
const {
  tokensQuery,
  medularDe,
  patronBaseDe,
  matchToken,
  normalizarTokens,
  rankearCandidatos,
} = require('../src/lib/busqueda');
const { fechaHoy } = require('../src/lib/fefo');

const HOY = fechaHoy();

let ok = 0;
let fail = 0;
const avisos = [];

function check(nombre, cond, extra) {
  if (cond) {
    ok += 1;
    console.log(`OK    ${nombre}`);
  } else {
    fail += 1;
    console.log(`FALLO ${nombre}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

async function fetchAll(tabla, columnas) {
  const sb = getSupabase();
  const paso = 1000;
  const filas = [];
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await sb
      .from(tabla)
      .select(columnas)
      .order('id')
      .range(desde, desde + paso - 1);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < paso) break;
  }
  return filas;
}

// Mismos candidatos que `consultarPrecioYStockJS` (sin rotación ni escritura).
async function candidatosDe(query) {
  const tokens = tokensQuery(query);
  const patron = patronBaseDe(query, medularDe(tokens));
  const { data, error } = await getSupabase()
    .from('productos')
    .select('id, nombre, precio, stock, marca, fecha_vencimiento')
    .eq('activo', true)
    .or(`fecha_vencimiento.gte.${HOY},fecha_vencimiento.is.null`)
    .ilike('nombre', `%${patron.replace(/%/g, '')}%`)
    .order('nombre')
    .limit(30);
  if (error) throw error;
  const rawTokens = String(query).toLowerCase().split(/\s+/);
  const cands = (data || []).map((p) => {
    const tokensNombre = normalizarTokens(p.nombre);
    const coinciden = tokens.filter((tk) => tokensNombre.some((nt) => matchToken(nt, tk))).length;
    const nombreLower = String(p.nombre).toLowerCase();
    const marca = rawTokens.find((tk) => tk.length > 3 && nombreLower.includes(tk) && nombreLower !== tk) ? 1 : 0;
    return {
      p,
      coinciden,
      marca,
      veces: 0,
      stock: Number(p.stock),
      venc: p.fecha_vencimiento ? new Date(p.fecha_vencimiento).getTime() : null,
    };
  });
  return { data: data || [], tokens, rawTokens, cands };
}

function ordenarFechas(fechas) {
  return fechas.slice().sort((a, b) => {
    if (a === b) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a - b;
  });
}

(async () => {
  const [productos, lotes] = await Promise.all([
    fetchAll('productos', 'id, sku, nombre, stock, activo, fecha_vencimiento'),
    fetchAll('lotes', 'id, sku, stock, activo, fecha_vencimiento'),
  ]);
  console.log(`Datos: ${productos.length} productos · ${lotes.length} lotes · hoy ${HOY}\n`);

  // 1) Fecha FEFO == MIN(lote activo con stock).
  const fefoPorSku = new Map();
  const stockPorSku = new Map();
  for (const l of lotes) {
    if (!l.activo || Number(l.stock) <= 0) continue;
    const prev = fefoPorSku.get(l.sku);
    if (!prev || l.fecha_vencimiento < prev) fefoPorSku.set(l.sku, l.fecha_vencimiento);
    stockPorSku.set(l.sku, (stockPorSku.get(l.sku) || 0) + Number(l.stock));
  }
  const conLotes = productos.filter((p) => p.activo && fefoPorSku.has(p.sku));
  const drift = conLotes.filter((p) => String(p.fecha_vencimiento || '') !== fefoPorSku.get(p.sku));
  check(
    'fecha_vencimiento == MIN(lote activo con stock)',
    drift.length === 0,
    drift.slice(0, 3).map((p) => ({ nombre: p.nombre, producto: p.fecha_vencimiento, lote: fefoPorSku.get(p.sku) }))
  );

  // 2) Ningún producto con lotes queda sin fecha.
  const sinFecha = conLotes.filter((p) => !p.fecha_vencimiento);
  check('productos con lotes tienen fecha FEFO', sinFecha.length === 0, sinFecha.slice(0, 3).map((p) => p.nombre));

  // 3) Los vencidos con stock no se ofrecen.
  const vencidos = productos
    .filter((p) => p.activo && Number(p.stock) > 0 && p.fecha_vencimiento && p.fecha_vencimiento < HOY)
    .sort((a, b) => Number(b.stock) - Number(a.stock));
  console.log(`Info: ${vencidos.length} productos activos vencidos con stock (no deben ofrecerse)`);

  for (const p of vencidos.slice(0, 3)) {
    const res = await consultarPrecioYStockJS(p.nombre, tokensQuery(p.nombre), false, null);
    const ids = res.ok ? res.productos.map((x) => x.id) : [];
    check(`no ofrece vencido: ${p.nombre.slice(0, 45)}`, res.ok && !ids.includes(p.id), { ok: res.ok, ofrecidos: ids.length });

    if (res.ok && ids.length) {
      const { data, error } = await getSupabase()
        .from('productos')
        .select('id, fecha_vencimiento')
        .in('id', ids);
      if (error) throw error;
      const malos = (data || []).filter((x) => x.fecha_vencimiento && x.fecha_vencimiento < HOY);
      check(`  ...y ninguno ofrecido está vencido`, malos.length === 0, malos);
    }
  }

  // 4) Paridad RPC ↔ JS + 5) FEFO como desempate en el orden real.
  const consultas = ['paracetamol 500', 'ibuprofeno', 'amoxicilina 500', 'omeprazol 20', 'dipirona'];
  let gruposConEmpate = 0;
  let gruposConFechasDistintas = 0;
  for (const q of consultas) {
    const { data, tokens, rawTokens, cands } = await candidatosDe(q);

    const rpcRes = await rpc('buscar_productos_bot', {
      p_query: q,
      p_telefono: null,
      p_es_barato: false,
      p_top: 3,
    });
    const jsRes = await consultarPrecioYStockJS(q, tokens, false, null);
    const idsRpc = (rpcRes?.productos || []).map((x) => x.id);
    const idsJs = (jsRes.productos || []).map((x) => x.id);
    check(`paridad RPC↔JS: "${q}"`, JSON.stringify(idsRpc) === JSON.stringify(idsJs), { rpc: idsRpc, js: idsJs });

    const orden = rankearCandidatos({ candidatos: data, tokens, rawTokens, esBarato: false, ctx: {}, top: 1000 });
    const posicion = new Map(orden.map((p, i) => [p.id, i]));
    const grupos = new Map();
    for (const c of cands) {
      const clave = `${c.coinciden}|${c.marca}|${c.veces}|${c.stock}`;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(c);
    }
    for (const grupo of grupos.values()) {
      if (grupo.length < 2) continue;
      gruposConEmpate += 1;
      const enOrden = grupo.slice().sort((a, b) => posicion.get(a.p.id) - posicion.get(b.p.id));
      const fechas = enOrden.map((c) => c.venc);
      if (new Set(fechas).size > 1) gruposConFechasDistintas += 1;
      check(
        `FEFO desempata en "${q}" (${grupo.length} empatados)`,
        JSON.stringify(fechas) === JSON.stringify(ordenarFechas(fechas)),
        { orden: enOrden.map((c) => `${c.p.nombre} ${c.p.fecha_vencimiento || '—'}`) }
      );
    }
  }

  // 6) Calidad de datos del TPV (avisos, no fallos).
  const conStockSinLotes = productos.filter((p) => p.activo && Number(p.stock) > 0 && !fefoPorSku.has(p.sku));
  if (conStockSinLotes.length) {
    avisos.push(`${conStockSinLotes.length} productos activos con stock y sin lotes (sin fecha FEFO; el bot los pone al final)`);
  }
  const distintosStock = productos.filter(
    (p) => p.activo && stockPorSku.has(p.sku) && Number(p.stock) !== stockPorSku.get(p.sku)
  );
  if (distintosStock.length) {
    avisos.push(`${distintosStock.length} productos con stock ≠ suma de lotes (los lotes cubren solo parte del inventario)`);
  }
  const lotesVencidos = lotes.filter((l) => l.activo && Number(l.stock) > 0 && l.fecha_vencimiento < HOY);
  if (lotesVencidos.length) {
    avisos.push(`${lotesVencidos.length} lotes vencidos con stock en la BD (limpieza = TPV)`);
  }

  console.log('');
  for (const a of avisos) console.log(`AVISO ${a}`);
  if (gruposConEmpate === 0) {
    console.log('Info: no hubo empates de stock entre candidatos → FEFO no intervino (red de seguridad)');
  } else {
    console.log(`Info: grupos empatados ${gruposConEmpate} (con fechas distintas: ${gruposConFechasDistintas})`);
  }
  console.log(`\n#V87 FEFO (prod, solo lectura): ${ok} OK / ${fail} FALLO`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
