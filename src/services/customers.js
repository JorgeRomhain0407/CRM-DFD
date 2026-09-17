'use strict';

const { getSupabase, rpc } = require('../lib/supabase');
const { assertE164 } = require('../lib/phone');

async function ensureCliente(telefono, extras = {}) {
  const phone = assertE164(telefono);
  const supabase = getSupabase();
  const { error: insertError } = await supabase
    .from('clientes')
    .upsert({ telefono: phone }, { onConflict: 'telefono', ignoreDuplicates: true });
  if (insertError) throw insertError;

  const cleanExtras = Object.fromEntries(
    Object.entries(extras).filter(([, value]) => value !== undefined)
  );
  if (Object.keys(cleanExtras).length) {
    const { error } = await supabase.from('clientes').update(cleanExtras).eq('telefono', phone);
    if (error) throw error;
  }

  const { error: estadoError } = await supabase.from('estado_chat').upsert(
    { telefono_cliente: phone },
    { onConflict: 'telefono_cliente', ignoreDuplicates: true }
  );
  if (estadoError) throw estadoError;

  return getClienteConEstado(phone);
}

async function getClienteConEstado(telefono) {
  const supabase = getSupabase();
  const { data: cliente, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('telefono', telefono)
    .maybeSingle();
  if (error) throw error;

  const { data: estado, error: estadoError } = await supabase
    .from('estado_chat')
    .select('*')
    .eq('telefono_cliente', telefono)
    .maybeSingle();
  if (estadoError) throw estadoError;

  return { cliente, estado };
}

// Cédula venezolana: prefijo V/E opcional + 5-9 dígitos.
// Se normaliza a mayúsculas sin separadores (ej: "v-12345678" -> "V12345678").
function normalizarCedula(input) {
  const limpio = String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[\s.\-–—]+/g, '');
  if (!/^[A-Z]?[0-9]{5,9}$/.test(limpio)) {
    throw new Error('Cédula inválida. Usa 5-9 dígitos con prefijo V/E opcional (ej: V12345678).');
  }
  return limpio;
}

const NOMBRE_PATTERN = /(?:me llamo|soy|mi nombre es)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\- ]{1,60})/i;

const NOMBRE_BLOCKLIST = new Set([
  'si', 'no', 'ok', 'vale', 'hola', 'gracias', 'buenos', 'buenas', 'quiero',
  'necesito', 'dame', 'compra', 'busca', 'busco', 'precio', 'hay', 'tengo',
  'tienes', 'tiene', 'comprar', 'me', 'mas', 'más', 'otra', 'algo', 'eso',
]);

const NOMBRE_INTENTO = new Set(['quiero', 'necesito', 'dame', 'comprar', 'busco', 'busca', 'precio']);

async function ultimoMensajeAsistente(telefono) {
  const { data, error } = await getSupabase()
    .from('mensajes')
    .select('contenido')
    .eq('telefono_cliente', telefono)
    .eq('rol', 'asistente')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.contenido || null;
}

function extraerNombreLibre(text) {
  const t = String(text || '')
    .trim()
    .replace(/[.,;!?]+$/, '')
    .trim();
  if (!t || /\d/.test(t) || t.length < 2 || t.length > 60) return null;
  if (t.includes(',')) return null;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length > 4) return null;
  if (tokens.some((tk) => tk.length < 2)) return null;
  const first = tokens[0].toLowerCase();
  if (NOMBRE_BLOCKLIST.has(first) || NOMBRE_INTENTO.has(first)) return null;
  if (tokens.length === 1 && first.length < 3) return null;
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\- ]+$/.test(t)) return null;
  return t;
}

async function maybePersistProfileFromText(telefono, text) {
  const { cliente } = await getClienteConEstado(telefono);
  const updates = {};
  if (!cliente?.nombre) {
    const named = text.match(NOMBRE_PATTERN)
      ? text.match(NOMBRE_PATTERN)[1].trim().replace(/[.,;!?]+$/, '')
      : null;
    if (!named) {
      const previo = await ultimoMensajeAsistente(telefono);
      if (/nomb|llamas|decirme qui[eé]n|qu[eé]n eres/i.test(previo || '')) {
        updates.nombre = extraerNombreLibre(text);
      }
    }
    if (named) updates.nombre = named;
  }
  if (cliente?.edad == null) {
    const aged = text.match(/(?:tengo|edad)?\s*(\d{1,3})\s*años/i);
    if (aged) {
      const edad = Number(aged[1]);
      if (edad >= 0 && edad <= 120) updates.edad = edad;
    }
  }
  if (Object.keys(updates).length) {
    const { error } = await getSupabase().from('clientes').update(updates).eq('telefono', telefono);
    if (error) throw error;
  }
}

async function hasPedidoConfirmado(telefono) {
  const { data, error } = await getSupabase()
    .from('carritos')
    .select('telefono_cliente')
    .eq('telefono_cliente', telefono)
    .in('estado', ['pedido', 'completado'])
    .limit(1);
  if (error) throw error;
  return (data?.length || 0) > 0;
}

async function tiposClientes(telefonos) {
  const unique = [...new Set((telefonos || []).filter(Boolean))];
  const tipos = {};
  if (!unique.length) return tipos;
  const { data, error } = await getSupabase()
    .from('carritos')
    .select('telefono_cliente')
    .in('telefono_cliente', unique)
    .in('estado', ['pedido', 'completado']);
  if (error) throw error;
  for (const row of data || []) tipos[row.telefono_cliente] = 'cliente';
  return tipos;
}

async function registrarHabitosConsumo(telefono) {
  const supabase = getSupabase();
  const { data: lineas, error: lineasError } = await supabase
    .from('carritos_temporales')
    .select('cantidad, productos ( nombre )')
    .eq('telefono_cliente', telefono);
  if (lineasError) throw lineasError;
  if (!lineas?.length) return;

  const nombres = lineas.map((l) => `${l.cantidad}x ${l.productos.nombre}`);
  const { data: cliente } = await supabase
    .from('clientes')
    .select('habitos_consumo')
    .eq('telefono', telefono)
    .maybeSingle();
  if (!cliente) return;

  const prev = String(cliente.habitos_consumo || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const final = [...nombres.filter((n) => !prev.includes(n)), ...prev].slice(0, 20);
  await supabase
    .from('clientes')
    .update({ habitos_consumo: final.join(', ').slice(0, 500) })
    .eq('telefono', telefono);
}

async function claimWebhookEvent(waMessageId) {
  if (!waMessageId) return true;
  const { error } = await getSupabase().from('webhook_events').insert({ wa_message_id: waMessageId });
  if (error && error.code === '23505') return false;
  if (error) throw error;
  return true;
}

/* ---------- Recomendaciones híbridas (criterio visible) ---------- */
const MAX_RECOMENDACIONES = 6;
const RECOMENDACION_PRIORIDAD = { habito: 4, co_ocurrencia: 3, contenido: 2, populares: 1 };

async function getRecomendaciones(telefono) {
  const supabase = getSupabase();

  const cedulaNormalizada = normalizarCedula(telefono);
  const idUnico = cedulaNormalizada || telefono;

  // 1) Catálogo activo (una sola consulta, de la que sacamos todo)
  const { data: catalogo, error: errCat } = await supabase
    .from('productos')
    .select('id, nombre, descripcion, precio, precio_usd, stock')
    .eq('activo', true)
    .order('nombre');
  if (errCat) throw errCat;
  const porNombre = new Map();
  for (const p of catalogo || []) {
    for (const n of [p.nombre, p.descripcion || '']) {
      if (n) porNombre.set(String(n).trim().toLowerCase(), p);
    }
  }
  const porId = new Map((catalogo || []).map((p) => [p.id, p]));

  // 2) Historial de ventas del cliente (qué ya lleva → excluir)
  const { data: misVentas, error: errV } = await supabase
    .from('ventas')
    .select('producto_id')
    .eq('telefono_cliente', telefono);
  if (errV) throw errV;
  const yaTiene = new Set((misVentas || []).map((v) => v.producto_id));

  // 3) Hábitos declarados → coincidencia por token en catálogo
  const rec = new Map(); // producto_id -> { ...producto, criterio, etiqueta, motivo, prioridad }
  function agregar(producto, criterio, etiqueta, motivo, prioridad) {
    const p = porId.get(producto.id);
    if (!p || yaTiene.has(p.id)) return;
    const prev = rec.get(p.id);
    if (prev && prev.prioridad >= prioridad) return;
    rec.set(p.id, {
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion || '',
      precio: Number(p.precio),
      precio_usd: Number(p.precio_usd || 0),
      stock: p.stock,
      criterio,
      etiqueta,
      motivo: motivo || etiqueta,
      prioridad,
    });
  }

  const habitos = String(cliente?.habitos_consumo || '')
    .split(/[,\s]+/)
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 2)
    .slice(0, 8);
  for (const h of habitos) {
    const { data, error } = await supabase
      .from('productos')
      .select('id')
      .ilike('nombre', `%${String(h).replace(/[%()]/g, '')}%`)
      .eq('activo', true)
      .limit(3);
    if (error) throw error;
    for (const row of data || []) {
      const p = porId.get(row.id);
      agregar(p, 'habito', 'Compra habitual', `Coincide con su hábito «${h}».`, RECOMENDACION_PRIORIDAD.habito);
    }
  }

  // 4) Co-ocurrencia: clientes que compraron lo mismo → qué más llevan
  if (yaTiene.size) {
    const { data: todas, error: errT } = await supabase
      .from('ventas')
      .select('telefono_cliente, producto_id')
      .limit(400);
    if (errT) throw errT;
    const conLoMismo = new Map(); // telefono -> Set(producto_id)
    for (const v of todas || []) {
      if (v.telefono_cliente === telefono) continue;
      if (!yaTiene.has(v.producto_id)) continue;
      if (!conLoMismo.has(v.telefono_cliente)) conLoMismo.set(v.telefono_cliente, new Set());
      conLoMismo.get(v.telefono_cliente).add(v.producto_id);
    }
    const frec = new Map(); // producto_id -> nº compras
    for (const v of todas || []) {
      if (v.telefono_cliente === telefono) continue;
      const grupo = conLoMismo.get(v.telefono_cliente);
      if (!grupo || yaTiene.has(v.producto_id)) continue;
      if (!grupo.size) continue;
      frec.set(v.producto_id, (frec.get(v.producto_id) || 0) + 1);
    }
    const top = [...frec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [pid, n] of top) {
      const p = porId.get(pid);
      if (!p) continue;
      agregar(p, 'co_ocurrencia', 'Los que llevan lo mismo también llevan', `Otros clientes con tu mismo perfil compran ${n}× este producto.`, RECOMENDACION_PRIORIDAD.co_ocurrencia);
    }
  }

  // 5) Contenido: tokens de lo que ya lleva vs catálogo
  const tokens = new Set();
  for (const pid of yaTiene) {
    const p = porId.get(pid);
    if (!p) continue;
    for (const t of String(p.nombre).toLowerCase().split(/[^a-záéíóúñü]+/)) {
      if (t.length > 3 && !['con','para','cada','plus','x'].includes(t)) tokens.add(t);
    }
  }
  for (const t of [...tokens].slice(0, 5)) {
    const { data, error } = await supabase
      .from('productos')
      .select('id')
      .ilike('nombre', `%${t}%`)
      .eq('activo', true)
      .limit(2);
    if (error) throw error;
    for (const row of data || []) {
      const p = porId.get(row.id);
      if (!p) continue;
      agregar(p, 'contenido', 'Le puede interesar', `Se parece a «${p.nombre}» que ya compró.`, RECOMENDACION_PRIORIDAD.contenido);
    }
  }

  // 6) Relleno: más vendidos (arranque en frío para clientes sin historial)
  const { data: ventasGlobal, error: errG } = await supabase
    .from('ventas')
    .select('producto_id')
    .limit(400);
  if (!errG) {
    const frec = new Map();
    for (const v of ventasGlobal || []) frec.set(v.producto_id, (frec.get(v.producto_id) || 0) + 1);
    const top = [...frec.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_RECOMENDACIONES);
    for (const [pid] of top) {
      const p = porId.get(pid);
      if (!p) continue;
      agregar(p, 'populares', 'Más vendido', 'Uno de los más pedidos de la farmacia.', RECOMENDACION_PRIORIDAD.populares);
    }
  }

  return [...rec.values()]
    .sort((a, b) => b.prioridad - a.prioridad)
    .slice(0, MAX_RECOMENDACIONES);
}

module.exports = {
  ensureCliente,
  getClienteConEstado,
  normalizarCedula,
  maybePersistProfileFromText,
  hasPedidoConfirmado,
  tiposClientes,
  registrarHabitosConsumo,
  claimWebhookEvent,
  getRecomendaciones,
};
