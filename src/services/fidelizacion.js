'use strict';

// #V36 · Fidelización por puntos (CRM DFD)
// Servicio fail-soft: nunca rompe el flujo de compra si el programa falla.
// Reglas: base en precio_usd, bonus por categoría curada (multiplicador de la
// config), flag activo en config (arranca FALSE).
//
// IMPORTANTE: todas las RPC van por el helper `rpc()` de lib/supabase, que
// Lanza si Supabase devuelve error. Con `sb.rpc()` a pelo se recibe el sobre
// { data, error } y una migración sin aplicar parecería un resultado vacío
// ("0 puntos") en vez de un fallo.

const { getSupabase, rpc } = require('../lib/supabase');

// Evita ensuciar el log con el mismo error en cada compra cuando la migración
// todavía no está aplicada (estado normal antes del despliegue).
const avisado = new Set();
function avisarUnaVez(clave, err) {
  if (avisado.has(clave)) return;
  avisado.add(clave);
  console.warn(`[fidelizacion] ${clave}: ${err.message}. Se avisa una sola vez; `
    + '¿está aplicada sql/migracion-fidelizacion.sql?');
}

function esUuid(v) {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
}

function normalizarItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const c = Number(it.cantidad || 1);
      return { producto_id: it.producto_id || it.id || it.producto, cantidad: Number.isInteger(c) && c > 0 ? c : 1 };
    })
    .filter((it) => esUuid(it.producto_id));
}

// Primera fila de una RPC que devuelve un objeto (no un array).
function primeraFila(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

// Respuesta uniforme cuando la parte de base de datos no está disponible.
function noDisponible(motivo) {
  return {
    disponible: false,
    ok: false,
    motivo,
    programa_activo: false,
    saldo: 0,
    saldo_canjeable: 0,
    movimientos: [],
    recompensas: [],
  };
}

async function getConfig() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('fidelizacion_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      avisarUnaVez('getConfig', error);
      return { activo: false, disponible: false };
    }
    return data || { activo: false, disponible: false };
  } catch (err) {
    avisarUnaVez('getConfig', err);
    return { activo: false, disponible: false };
  }
}

// Config cruda para el panel; null = la migración no está aplicada todavía.
async function getConfigTabla() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('fidelizacion_config').select('*').eq('id', 1).maybeSingle();
    if (error) {
      avisarUnaVez('getConfigTabla', error);
      return null;
    }
    return data || null;
  } catch (err) {
    avisarUnaVez('getConfigTabla', err);
    return null;
  }
}

async function setConfig(cfgParcial) {
  try {
    // PostgREST resuelve el RPC por la firma exacta de los argumentos que
    // llegan: si mandamos solo {activo}, no encuentra la función y devuelve
    // PGRST202. Fundemos siempre con la config actual + los valores por
    // defecto, para que el upsert reciba los 7 argumentos pase lo que pase.
    const actual = (await getConfigTabla()) || {};
    const base = (campo, defecto) => (actual[campo] === undefined || actual[campo] === null ? defecto : actual[campo]);
    const numero = (campo, defecto) => {
      const enviado = cfgParcial[campo];
      const n = Number(enviado);
      if (enviado !== undefined && enviado !== null && enviado !== '' && Number.isFinite(n)) return n;
      return Number(base(campo, defecto));
    };
    const data = await rpc('fidelizacion_config_upsert', {
      p_activo: cfgParcial.activo === undefined ? !!base('activo', false) : !!cfgParcial.activo,
      p_puntos_por_usd: numero('puntos_por_usd', 50),
      p_bonificacion_categoria: numero('bonificacion_categoria', 2),
      p_canje_minimo_puntos: numero('canje_minimo_puntos', 100),
      p_canje_max_porcentaje: numero('canje_max_porcentaje', 10),
      p_vigencia_dias: numero('vigencia_dias', 0),
      p_nota: cfgParcial.nota === undefined ? (base('nota', null) || null) : cfgParcial.nota || null,
    });
    return primeraFila(data);
  } catch (err) {
    avisarUnaVez('setConfig', err);
    return null;
  }
}

async function getSaldo(telefono) {
  if (!telefono) return noDisponible('sin_telefono');
  try {
    const data = await rpc('fidelizacion_saldo', { p_telefono: telefono });
    const r = primeraFila(data);
    if (!r || typeof r !== 'object') return noDisponible('respuesta_vacia');
    return { ...r, disponible: true };
  } catch (err) {
    avisarUnaVez('getSaldo', err);
    return noDisponible('rpc_no_disponible');
  }
}

async function acumularPuntos({ telefono, referencia, items, canal }) {
  const cfg = await getConfig();
  // Sin config legible NO se acumula: es el comportamiento fail-soft.
  if (!cfg.activo) {
    return { ok: false, motivo: 'programa_inactivo', puntos: 0, saldo: 0 };
  }
  const norm = normalizarItems(items);
  if (!norm.length) {
    return { ok: false, motivo: 'items_vacios', puntos: 0, saldo: 0 };
  }
  try {
    const data = await rpc('fidelizacion_acumular', {
      p_telefono: telefono,
      p_referencia: referencia,
      p_items: norm,
      p_canal: canal || null,
    });
    const r = primeraFila(data);
    if (r && r.ok) return r;
    return r || { ok: false, motivo: 'respuesta_vacia' };
  } catch (err) {
    avisarUnaVez('acumularPuntos', err);
    return { ok: false, motivo: 'rpc_no_disponible' };
  }
}

async function canjearPuntos({ telefono, recompensaId, referencia, montoPedido }) {
  // Valida la entrada ANTES de mirar la config: si el id viene mal, el
  // operador quiere saber eso, no un confuso "programa inactivo".
  if (!esUuid(recompensaId)) {
    return { ok: false, motivo: 'recompensa_invalida' };
  }
  const cfg = await getConfig();
  if (!cfg.activo) {
    return { ok: false, motivo: 'programa_inactivo' };
  }
  try {
    const data = await rpc('fidelizacion_canjear', {
      p_telefono: telefono,
      p_recompensa: recompensaId,
      p_referencia: referencia,
      p_monto_pedido: montoPedido == null ? 0 : Number(montoPedido),
    });
    return primeraFila(data) || { ok: false, motivo: 'respuesta_vacia' };
  } catch (err) {
    avisarUnaVez('canjearPuntos', err);
    return { ok: false, motivo: 'rpc_no_disponible' };
  }
}

async function ajusteManual({ telefono, puntos, motivo, referencia }) {
  const p = Number(puntos);
  if (!Number.isInteger(p) || p === 0) {
    return { ok: false, motivo: 'puntos_cero' };
  }
  try {
    const data = await rpc('fidelizacion_ajuste', {
      p_telefono: telefono,
      p_puntos: p,
      p_motivo: motivo || 'Ajuste manual del operador',
      p_referencia: referencia || null,
    });
    return primeraFila(data) || { ok: false, motivo: 'respuesta_vacia' };
  } catch (err) {
    avisarUnaVez('ajusteManual', err);
    return { ok: false, motivo: 'rpc_no_disponible' };
  }
}

async function getRecompensas() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('fidelizacion_recompensas')
      .select('id,nombre,descripcion,tipo,puntos_costo,valor,unidad,limite,activa,orden')
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true });
    if (error) {
      avisarUnaVez('getRecompensas', error);
      return [];
    }
    return data || [];
  } catch (err) {
    avisarUnaVez('getRecompensas', err);
    return [];
  }
}

async function upsertRecompensa(rec) {
  const campos = {
    nombre: rec.nombre,
    descripcion: rec.descripcion || null,
    tipo: rec.tipo || 'descuento',
    puntos_costo: rec.puntos_costo,
    valor: rec.valor ?? 0,
    unidad: rec.unidad || 'bs',
    limite: rec.limite ?? null,
    activa: rec.activa ?? true,
    orden: rec.orden ?? 0,
  };
  try {
    const sb = getSupabase();
    const q = rec.id
      ? sb.from('fidelizacion_recompensas').update(campos).eq('id', rec.id)
      : sb.from('fidelizacion_recompensas').insert(campos);
    const { data, error } = await q.select('*').maybeSingle();
    if (error) {
      console.error('[fidelizacion] upsertRecompensa error:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[fidelizacion] upsertRecompensa excepcion:', err.message);
    return null;
  }
}

async function deleteRecompensa(id) {
  if (!esUuid(id)) return false;
  try {
    const sb = getSupabase();
    const { error } = await sb.from('fidelizacion_recompensas').delete().eq('id', id);
    if (error) console.error('[fidelizacion] deleteRecompensa error:', error.message);
    return !error;
  } catch (err) {
    console.error('[fidelizacion] deleteRecompensa excepcion:', err.message);
    return false;
  }
}

async function getCategorias() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('fidelizacion_categorias')
      .select('id,nombre,multiplicador,activa')
      .order('nombre', { ascending: true });
    if (error) {
      avisarUnaVez('getCategorias', error);
      return [];
    }
    return data || [];
  } catch (err) {
    avisarUnaVez('getCategorias', err);
    return [];
  }
}

async function asignarCategoriaProducto(productoId, categoriaId) {
  if (!esUuid(productoId)) return false;
  try {
    const sb = getSupabase();
    const upd = esUuid(categoriaId) ? { categoria_id: categoriaId } : { categoria_id: null };
    const { error } = await sb.from('productos').update(upd).eq('id', productoId);
    if (error) console.error('[fidelizacion] asignarCategoriaProducto error:', error.message);
    return !error;
  } catch (err) {
    console.error('[fidelizacion] asignarCategoriaProducto excepcion:', err.message);
    return false;
  }
}

module.exports = {
  getConfig,
  getConfigTabla,
  setConfig,
  getSaldo,
  acumularPuntos,
  canjearPuntos,
  ajusteManual,
  getRecompensas,
  upsertRecompensa,
  deleteRecompensa,
  getCategorias,
  asignarCategoriaProducto,
};
