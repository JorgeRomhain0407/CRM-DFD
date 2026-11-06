'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.CRM_SYNC_URL || 'http://localhost:4000';
const TOKEN = process.env.CRM_SYNC_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Marca de agua de las pasadas incrementales. Vive junto al proyecto (en el PC
// de la farmacia) para no añadir otra tabla al CRM: si se pierde, la siguiente
// pasada es completa y el RPC es idempotente.
const ESTADO_PATH = path.join(__dirname, '..', '..', '.farmacia-sync-state.json');

// Se releen 2 días de margen: cubre relojes desfasados y filas que cambian
// mientras corre la pasada, sin reenviar los ~8.200 clientes cada 15 min.
const SOLAPE_DIAS = 2;

const SOLO_CLIENTES = process.argv.includes('--solo-clientes');
const CLIENTES_COMPLETO = process.argv.includes('--clientes-completo');
const SOLO_VENTAS = process.argv.includes('--solo-ventas');
const VENTAS_COMPLETO = process.argv.includes('--ventas-completo');

// Tope de páginas por pasada (500 facturas/página → 100.000 facturas). Evita
// que un error de paginación deje el proceso en bucle; la siguiente pasada
// continúa desde la marca de agua.
const MAX_PAGINAS_VENTAS = 200;

async function obtenerCatalogo() {
  const res = await fetch(`${URL}/productos`, {
    headers: TOKEN ? { 'x-api-key': TOKEN } : {},
  });
  if (!res.ok) {
    throw new Error(`API farmacia ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return { productos: data.productos || [], lotes: data.lotes || [] };
}

// Devuelve null si el servidor de la farmacia aún no tiene el endpoint (para
// que un despliegue desfasado no tumbe la sincronización del catálogo).
async function obtenerClientes(desde) {
  const qs = desde ? `?desde=${encodeURIComponent(desde)}` : '';
  const res = await fetch(`${URL}/clientes${qs}`, {
    headers: TOKEN ? { 'x-api-key': TOKEN } : {},
  });
  if (res.status === 404 || res.status === 501) {
    console.warn('[consumidor] el servidor de la farmacia no expone /clientes todavía; se omite.');
    return null;
  }
  if (!res.ok) {
    throw new Error(`API farmacia /clientes ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return data.clientes || [];
}

// Devuelve null si el servidor de la farmacia aún no tiene el endpoint (para
// que un despliegue desfasado no tumbe la sincronización del catálogo).
async function obtenerVentas(desde, limite = 500) {
  const qs = new URLSearchParams();
  if (desde) qs.set('desde', String(desde));
  qs.set('limite', String(limite));
  const res = await fetch(`${URL}/ventas?${qs.toString()}`, {
    headers: TOKEN ? { 'x-api-key': TOKEN } : {},
  });
  if (res.status === 404 || res.status === 501) {
    console.warn('[consumidor] el servidor de la farmacia no expone /ventas todavía; se omite.');
    return null;
  }
  if (!res.ok) {
    throw new Error(`API farmacia /ventas ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    ventas: data.ventas || [],
    hayMas: data.hay_mas === true,
  };
}

// JSON.stringify(NaN) es null, y un null en p_stock/p_precio haría fallar el
// INSERT del RPC: todo valor numérico pasa por aquí antes de enviarse.
function num(v, porDefecto = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : porDefecto;
}

async function mapLimit(items, limite, fn) {
  const salida = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      salida[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return salida;
}

// El RPC de lotes es idempotente (upsert por sku+lote), así que podemos
// enviar varias filas en paralelo sin riesgo; 10 evita saturar Supabase.
const CONCURRENCIA = 10;

function crearSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ROLE) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el .env del consumidor.');
  }
  return createClient(SUPABASE_URL, SUPABASE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ------------------------------------------------------------------------- */
/* Clientes del TPV (alta masiva + pasadas incrementales)                     */
/* ------------------------------------------------------------------------- */

function leerEstado() {
  try {
    return JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function guardarEstado(estado) {
  try {
    fs.writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn(`[consumidor] no se pudo guardar ${ESTADO_PATH}: ${err.message}`);
  }
}

function desdeConSolape(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - SOLAPE_DIAS);
  return d.toISOString();
}

// Misma regla que `normalizarCedula` del CRM: V/E opcional + 5-9 dígitos.
function normalizarCedulaTpv(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s.\-–—]+/g, '');
  return /^[A-Z]?[0-9]{5,9}$/.test(s) ? s : null;
}

// El TPV guarda teléfonos venezolanos como "04249263333" / "4249263333".
// Regla: 0 inicial → +58; 58 explícito → se respeta; 10 dígitos 2xx/4xx →
// +58. Cualquier otro formato devuelve null y la ficha va a la cola (nunca
// se inventa un número: el teléfono es la PK del CRM).
function normalizarTelefonoTpv(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);

  if (d.startsWith('58')) {
    // Algunos TPV guardan "+58 0424…": sobra el 0 después del código país.
    if (d.length > 2 && d[2] === '0') d = '58' + d.slice(3);
  } else if (d.startsWith('0')) {
    d = '58' + d.slice(1);
  } else if (d.length === 10 && /^[24]/.test(d)) {
    d = '58' + d;
  } else {
    return null;
  }

  const e164 = '+' + d;
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}

function clasificarEstadoCliente(estado) {
  const s = String(estado || '');
  if (s === 'creada') return 'creadas';
  if (s === 'enriquecida' || s === 'enriquecida_por_telefono' || s === 'actualizada') return 'enriquecidas';
  if (s.startsWith('cola:')) return 'cola';
  if (s.startsWith('conflicto:')) return 'conflictos';
  return 'omitidos';
}

async function sincronizarClientes(sb) {
  const estado = leerEstado();
  const desde = CLIENTES_COMPLETO ? null : desdeConSolape(estado.ultimaSyncClientes);
  const clientes = await obtenerClientes(desde);
  if (clientes === null) return null;

  const resumen = {
    leidos: clientes.length,
    creadas: 0,
    enriquecidas: 0,
    cola: 0,
    conflictos: 0,
    omitidos: 0,
    errores: 0,
  };

  // 5 en paralelo: cada fila es un RPC con lógica; no conviene saturar.
  let rpcNoDisponible = null;
  await mapLimit(clientes, 5, async (c) => {
    if (rpcNoDisponible) return;

    const cedula = normalizarCedulaTpv(c.cedula);
    if (!cedula) {
      resumen.omitidos++;
      return;
    }

    const { data, error } = await sb.rpc('clientes_tpv_importar', {
      p_tpv_cliente_id: c.tpvClienteId,
      p_cedula: cedula,
      p_nombre: c.nombre || null,
      p_telefono: normalizarTelefonoTpv(c.telefono),
      p_ciudad: c.ciudad || null,
      p_direccion: c.direccion || null,
      p_ultima_compra: c.ultimaCompra || null,
    });

    if (error) {
      resumen.errores++;
      // Migración sin aplicar / permisos: no tiene sentido seguir con 8.000 filas.
      if (/could not find the function|function .* does not exist|permission denied|schema cache/i.test(error.message)) {
        rpcNoDisponible = error.message;
        console.error(
          `[consumidor] RPC clientes_tpv_importar no disponible (${error.message}). ` +
            '¿Ejecutaste sql/migracion-clientes-tpv.sql en Supabase? Se omite el resto de la pasada.'
        );
        return;
      }
      if (resumen.errores <= 10) {
        console.error(`  ✗ cliente TPV ${c.tpvClienteId} (${cedula}): ${error.message}`);
      }
      return;
    }

    const fila = Array.isArray(data) ? data[0] : data;
    resumen[clasificarEstadoCliente(fila && fila.out_estado)]++;
  });

  // La marca de agua solo avanza si no hubo errores: si algo falló, la
  // siguiente pasada vuelve a cubrir la ventana y el RPC es idempotente.
  if (resumen.errores === 0 && clientes.length > 0) {
    const maxFecha = clientes.reduce((max, c) => {
      if (!c.actualizadoEn) return max;
      return !max || c.actualizadoEn > max ? c.actualizadoEn : max;
    }, null);
    if (maxFecha && (!estado.ultimaSyncClientes || maxFecha > estado.ultimaSyncClientes)) {
      estado.ultimaSyncClientes = maxFecha;
      guardarEstado(estado);
    }
  }

  return resumen;
}

function clasificarEstadoVenta(estado) {
  const s = String(estado || '');
  if (s === 'importada') return 'importadas';
  if (s === 'ya importada') return 'yaImportadas';
  if (s === 'sin ficha') return 'sinFicha';
  if (s === 'sin cedula') return 'sinCedula';
  return 'omitidas';
}

async function sincronizarVentas(sb) {
  const estado = leerEstado();
  let desde = VENTAS_COMPLETO ? 0 : Number(estado.ultimaFacturaTpv) || 0;
  // Las facturas pendientes que ya existían antes de esta pasada se reintentan
  // al final (las que falle ahora se reintentan en la siguiente).
  const inicioPasada = new Date().toISOString();

  const resumen = {
    leidas: 0,
    importadas: 0,
    yaImportadas: 0,
    sinFicha: 0,
    sinCedula: 0,
    omitidas: 0,
    habitos: 0,
    sinProducto: 0,
    errores: 0,
    paginas: 0,
    reintentadas: 0,
    recuperadas: 0,
    desde,
    hasta: desde,
  };

  let rpcNoDisponible = null;
  for (let pagina = 0; pagina < MAX_PAGINAS_VENTAS; pagina++) {
    const lote = await obtenerVentas(desde, 500);
    if (lote === null) return null;
    const ventas = lote.ventas;
    if (!ventas.length) break;

    resumen.paginas++;

    await mapLimit(ventas, 5, async (v) => {
      if (rpcNoDisponible) return;
      resumen.leidas++;

      const { data, error } = await sb.rpc('ventas_tpv_importar', {
        p_tpv_factura_id: v.tpvFacturaId,
        p_tpv_cliente_id: v.tpvClienteId,
        p_cedula: normalizarCedulaTpv(v.cedula),
        p_telefono: normalizarTelefonoTpv(v.telefono),
        p_fecha: v.fecha || null,
        p_monto_total: v.montoTotal,
        p_tasa: v.tasa,
        p_puntos_generados: v.puntosGenerados,
        p_puntos_consumidos: v.puntosConsumidos,
        p_lineas: v.lineas || [],
      });

      if (error) {
        resumen.errores++;
        if (/could not find the function|function .* does not exist|permission denied|schema cache/i.test(error.message)) {
          rpcNoDisponible = error.message;
          console.error(
            `[consumidor] RPC ventas_tpv_importar no disponible (${error.message}). ` +
              '¿Ejecutaste sql/migracion-ventas-tpv.sql en Supabase? Se omite el resto de la pasada.'
          );
          return;
        }
        if (resumen.errores <= 10) {
          console.error(`  ✗ factura TPV ${v.tpvFacturaId} (${v.cedula}): ${error.message}`);
        }
        return;
      }

      const fila = Array.isArray(data) ? data[0] : data;
      resumen[clasificarEstadoVenta(fila && fila.out_estado)]++;
      resumen.habitos += num(fila && fila.out_habitos);
      resumen.sinProducto += num(fila && fila.out_sin_producto);
    });

    // Si algo falló o la migración no está aplicada, no se avanza la marca de
    // agua: la próxima pasada reintenta la misma página (el RPC es idempotente).
    if (rpcNoDisponible || resumen.errores > 0) break;

    const maxId = ventas.reduce(
      (max, v) => (Number.isSafeInteger(v.tpvFacturaId) && v.tpvFacturaId > max ? v.tpvFacturaId : max),
      0
    );
    if (maxId > desde) {
      desde = maxId;
      resumen.hasta = maxId;
      estado.ultimaFacturaTpv = maxId;
      guardarEstado(estado);
    }

    if (!lote.hayMas || ventas.length < 500) break;
  }

  // Reintento de las facturas que quedaron sin ficha en pasadas anteriores: en
  // cuanto la ficha exista (alta masiva o alta manual), se recuperan solas sin
  // esperar a una pasada completa. Se limita a 200 por pasada.
  if (!rpcNoDisponible && resumen.errores === 0) {
    const { data: pendientes, error: errPend } = await sb
      .from('ventas_tpv')
      .select('tpv_factura_id, tpv_cliente_id, cedula, fecha, monto_total, tasa, puntos_generados, puntos_consumidos, lineas')
      .eq('estado', 'sin_ficha')
      .lt('updated_at', inicioPasada)
      .order('fecha', { ascending: true, nullsFirst: true })
      .limit(200);

    if (errPend) {
      console.warn(`[consumidor] no se pudieron leer las facturas sin ficha: ${errPend.message}`);
    } else {
      for (const v of pendientes || []) {
        const { data, error } = await sb.rpc('ventas_tpv_importar', {
          p_tpv_factura_id: v.tpv_factura_id,
          p_tpv_cliente_id: v.tpv_cliente_id,
          p_cedula: v.cedula,
          p_telefono: null,
          p_fecha: v.fecha,
          p_monto_total: v.monto_total,
          p_tasa: v.tasa,
          p_puntos_generados: v.puntos_generados,
          p_puntos_consumidos: v.puntos_consumidos,
          p_lineas: v.lineas || [],
        });
        if (error) {
          resumen.errores++;
          if (resumen.errores <= 10) {
            console.error(`  ✗ reintento factura TPV ${v.tpv_factura_id}: ${error.message}`);
          }
          continue;
        }
        resumen.reintentadas++;
        const fila = Array.isArray(data) ? data[0] : data;
        if (fila && fila.out_estado === 'importada') {
          resumen.recuperadas++;
          resumen.habitos += num(fila.out_habitos);
          resumen.sinProducto += num(fila.out_sin_producto);
        }
      }
    }
  }

  return resumen;
}

/* ------------------------------------------------------------------------- */
/* Catálogo (productos + lotes)                                              */
/* ------------------------------------------------------------------------- */

async function sincronizarSupabase(productos, lotes, sb) {
  let upsertados = 0;
  let errores = 0;

  // Primero TODOS los productos (el RPC de lotes recalcula la fecha de
  // vencimiento sobre la fila del producto: debe existir antes).
  await mapLimit(productos, CONCURRENCIA, async (p) => {
    const { error } = await sb.rpc('productos_tpv_upsert', {
      p_sku: p.sku,
      p_nombre: p.nombre,
      p_descripcion: p.descripcion || null,
      p_precio: num(p.precio),
      p_precio_usd: num(p.precioUsd),
      p_stock: num(p.stock),
      p_marca: p.marca || null,
    });
    if (error) {
      errores++;
      if (errores <= 10) console.error(`  ✗ ${p.sku} ${p.nombre}: ${error.message}`);
    } else {
      upsertados++;
    }
  });

  // Los drivers devuelven la fecha en camelCase (mssql) o snake_case (los
  // genéricos de lotes-utils); normalizamos y descartamos lo incompleto.
  // También descartamos lotes cuyo sku no esté en el catálogo: la tabla
  // `lotes` no tiene FK, así que entrarían como huérfanos.
  const skusCatalogo = new Set(productos.map((p) => String(p.sku)));
  const lotesValidos = (lotes || []).filter(
    (l) =>
      l &&
      l.sku &&
      l.lote &&
      (l.fechaVencimiento || l.fecha_vencimiento) &&
      skusCatalogo.has(String(l.sku))
  );
  const lotesDescartados = (lotes || []).length - lotesValidos.length;
  if (lotesDescartados > 0) {
    console.warn(`[consumidor] lotes descartados (sin sku en catálogo, sin lote o sin fecha): ${lotesDescartados}`);
  }

  let lotesOk = 0;
  let lotesErr = 0;
  await mapLimit(lotesValidos, CONCURRENCIA, async (l) => {
    const { error } = await sb.rpc('lotes_tpv_upsert', {
      p_sku: l.sku,
      p_lote: l.lote,
      p_fecha_vencimiento: l.fechaVencimiento || l.fecha_vencimiento,
      p_stock: num(l.stock),
    });
    if (error) {
      lotesErr++;
      if (lotesErr <= 10) console.error(`  ✗ lote ${l.sku}/${l.lote}: ${error.message}`);
    } else {
      lotesOk++;
    }
  });

  return {
    total: productos.length,
    upsertados,
    errores,
    totalLotes: lotesValidos.length,
    lotesOk,
    lotesErr,
  };
}

async function main() {
  const sb = crearSupabase();

  let resumenClientes = null;
  if (!SOLO_VENTAS) {
    console.log('[consumidor] sincronizando fichas de cliente del TPV …');
    resumenClientes = await sincronizarClientes(sb);
    if (resumenClientes) {
      console.log(
        `[consumidor] clientes TPV leídos ${resumenClientes.leidos}: ` +
          `${resumenClientes.creadas} creadas, ${resumenClientes.enriquecidas} enriquecidas, ` +
          `${resumenClientes.cola} a la cola, ${resumenClientes.conflictos} conflictos, ` +
          `${resumenClientes.omitidos} omitidos (${resumenClientes.errores} errores).`
      );
    }
    if (SOLO_CLIENTES) {
      if (resumenClientes && resumenClientes.errores > 0) process.exitCode = 1;
      return;
    }
  }

  // El catálogo va ANTES de las ventas: los hábitos necesitan el producto
  // (productos.id) ya sincronizado para poder enlazar el SKU vendido.
  let resumen = null;
  if (!SOLO_VENTAS) {
    console.log(`[consumidor] obteniendo catálogo de ${URL}/productos …`);
    const { productos, lotes } = await obtenerCatalogo();
    console.log(`[consumidor] recibidos ${productos.length} productos / ${lotes.length} lotes.`);

    resumen = await sincronizarSupabase(productos, lotes, sb);
    console.log(
      `[consumidor] sincronizados ${resumen.upsertados}/${resumen.total} productos (${resumen.errores} errores) ` +
        `y ${resumen.lotesOk}/${resumen.totalLotes} lotes (${resumen.lotesErr} errores).`
    );
  }

  console.log('[consumidor] importando ventas del TPV a hábitos …');
  const resumenVentas = await sincronizarVentas(sb);
  if (resumenVentas) {
    console.log(
      `[consumidor] ventas TPV leídas ${resumenVentas.leidas} (${resumenVentas.paginas} página(s), ` +
        `facturas ${resumenVentas.desde}→${resumenVentas.hasta}): ` +
        `${resumenVentas.importadas} importadas, ${resumenVentas.yaImportadas} ya importadas, ` +
        `${resumenVentas.sinFicha} sin ficha, ${resumenVentas.sinCedula} sin cédula, ` +
        `${resumenVentas.omitidas} omitidas (${resumenVentas.errores} errores). ` +
        `Hábitos nuevos: ${resumenVentas.habitos}; líneas sin producto en el CRM: ${resumenVentas.sinProducto}. ` +
        `Reintentos sin ficha: ${resumenVentas.reintentadas} (${resumenVentas.recuperadas} recuperadas).`
    );
  }
  if (SOLO_VENTAS) {
    if (resumenVentas && resumenVentas.errores > 0) process.exitCode = 1;
    return;
  }

  if (
    (resumen && (resumen.errores > 0 || resumen.lotesErr > 0)) ||
    (resumenClientes && resumenClientes.errores > 0) ||
    (resumenVentas && resumenVentas.errores > 0)
  ) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[consumidor]', err.message);
    process.exit(1);
  });
}

module.exports = {
  normalizarCedulaTpv,
  normalizarTelefonoTpv,
  desdeConSolape,
  clasificarEstadoCliente,
  clasificarEstadoVenta,
};
