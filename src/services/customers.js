'use strict';

const { getSupabase, rpc } = require('../lib/supabase');
const { assertE164 } = require('../lib/phone');
const { RECOMENDACION_PRIORIDAD, MAX_RECOMENDACIONES, resumirPerfilConsumo } = require('../lib/recomendaciones');

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
  // #V76 · Paralelo: cliente y estado_chat son lecturas independientes (antes
  // iban en serie => 2 round-trips encadenados en CADA turno del bot).
  const [clienteRes, estadoRes] = await Promise.all([
    supabase.from('clientes').select('*').eq('telefono', telefono).maybeSingle(),
    supabase.from('estado_chat').select('*').eq('telefono_cliente', telefono).maybeSingle(),
  ]);
  if (clienteRes.error) throw clienteRes.error;
  if (estadoRes.error) throw estadoRes.error;
  return { cliente: clienteRes.data, estado: estadoRes.data };
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

// ¿El último mensaje del asistente pidió el nombre? (dispara la captura libre).
function asistentePidioNombre(previo) {
  return /nomb|llamas|decirme qui[eé]n|qu[eé]n eres|c[oó]mo te llamas|a nombre de qui[eé]n/i.test(
    String(previo || '')
  );
}

// Captura el nombre de un texto: primero el patrón explícito ("me llamo X"),
// y solo si el bot lo había pedido, acepta un nombre "libre" (p. ej. "Juan").
function extraerNombreDeMensaje(text, { pidioAsistente = false } = {}) {
  const m = String(text || '').match(NOMBRE_PATTERN);
  if (m) return m[1].trim().replace(/[.,;!?]+$/, '');
  if (pidioAsistente) return extraerNombreLibre(text);
  return null;
}

async function maybePersistProfileFromText(telefono, text) {
  const { cliente } = await getClienteConEstado(telefono);
  const updates = {};
  if (!cliente?.nombre) {
    const previo = await ultimoMensajeAsistente(telefono);
    const nombre = extraerNombreDeMensaje(text, { pidioAsistente: asistentePidioNombre(previo) });
    if (nombre) updates.nombre = nombre;
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
  return updates;
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

/* ---------- #V65 · Hábitos de consumo (join cliente↔producto) ---------- */

// Nombres de los productos marcados como hábito de un cliente.
async function getClienteHabitos(telefono) {
  const { data, error } = await getSupabase()
    .from('cliente_habitos')
    .select('producto_id, origen, productos ( id, nombre )')
    .eq('telefono_cliente', telefono)
    .order('creado_en', { ascending: true });
  if (error) throw error;
  return (data || []).map((h) => ({
    producto_id: h.producto_id,
    nombre: h.productos?.nombre || null,
    origen: h.origen,
  }));
}

// Reemplaza los hábitos de un cliente por la lista de producto_id dada.
// Solo acepta productos existentes y ACTIVOS del catálogo.
async function setClienteHabitos(telefono, productoIds, origen = 'manual') {
  const supabase = getSupabase();
  const ids = [
    ...new Set(
      (Array.isArray(productoIds) ? productoIds : [])
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    ),
  ];

  const { error: delError } = await supabase
    .from('cliente_habitos')
    .delete()
    .eq('telefono_cliente', telefono);
  if (delError) throw delError;

  if (!ids.length) return [];

  const { data: validos, error: errValid } = await supabase
    .from('productos')
    .select('id')
    .in('id', ids)
    .eq('activo', true);
  if (errValid) throw errValid;

  const validSet = new Set((validos || []).map((p) => p.id));
  const filas = ids
    .filter((id) => validSet.has(id))
    .map((producto_id) => ({ telefono_cliente: telefono, producto_id, origen }));
  if (!filas.length) return [];

  const { error: insError } = await supabase.from('cliente_habitos').insert(filas);
  if (insError) throw insError;
  return filas.map((f) => f.producto_id);
}

// #V65 · Alta automática: cada producto ya comprado (líneas del carrito
// formalizado o ventas de mostrador) se añade como hábito con origen 'compra'.
// Idempotente: NO pisa hábitos manuales/legacy ya existentes (ON CONFLICT).
async function registrarHabitosConsumo(telefono) {
  const supabase = getSupabase();
  const productoIds = new Set();

  const { data: lineas, error: lineasError } = await supabase
    .from('carritos_temporales')
    .select('producto_id')
    .eq('telefono_cliente', telefono);
  if (lineasError) throw lineasError;
  for (const l of lineas || []) if (l.producto_id) productoIds.add(l.producto_id);

  const { data: ventas, error: ventasError } = await supabase
    .from('ventas')
    .select('producto_id')
    .eq('telefono_cliente', telefono);
  if (ventasError) throw ventasError;
  for (const v of ventas || []) if (v.producto_id) productoIds.add(v.producto_id);

  if (!productoIds.size) return 0;

  const filas = [...productoIds].map((producto_id) => ({
    telefono_cliente: telefono,
    producto_id,
    origen: 'compra',
  }));
  const { error } = await supabase
    .from('cliente_habitos')
    .upsert(filas, { onConflict: 'telefono_cliente,producto_id', ignoreDuplicates: true });
  if (error) throw error;
  return filas.length;
}

/* ---------- Perfil de consumo (#V56) ---------- */

// Deriva el perfil de consumo del cliente desde su historial de ventas y lo
// fusiona en clientes.perfil (RPC `clientes_perfil_merge`, merge atómico que NO
// pisa puntos/habitos/edad). Fail-soft: si falla, solo loguea. Anti-PII: solo
// nombres de catálogo.
async function construirPerfilConsumo(telefono) {
  try {
    const { data, error } = await getSupabase()
      .from('ventas')
      .select('cantidad, productos ( nombre, categoria_id, fidelizacion_categorias ( nombre ) )')
      .eq('telefono_cliente', telefono);
    if (error) throw error;

    const resumen = resumirPerfilConsumo(data || []);
    const patch = {};
    if (resumen.intereses.length) patch.intereses = resumen.intereses;
    if (Object.keys(resumen.categorias).length) patch.categorias = resumen.categorias;
    if (!Object.keys(patch).length) return null;

    return await rpc('clientes_perfil_merge', { p_telefono: telefono, p_patch: patch });
  } catch (err) {
    console.warn('[customers] construirPerfilConsumo:', err?.message || err);
    return null;
  }
}

async function claimWebhookEvent(waMessageId) {
  if (!waMessageId) return true;
  const { error } = await getSupabase().from('webhook_events').insert({ wa_message_id: waMessageId });
  if (error && error.code === '23505') return false;
  if (error) throw error;
  return true;
}

/* ---------- Recomendaciones híbridas (criterio visible) ---------- */
// RECOMENDACION_PRIORIDAD y MAX_RECOMENDACIONES vienen de lib/recomendaciones.

async function getRecomendaciones(telefono) {
  const supabase = getSupabase();

  // 1) Catálogo activo. Paginado: Supabase recorta a 1000 filas por consulta y
  // el inventario real supera las 4000 → sin paginar, los productos fuera del
  // primer millar quedaban invisibles (porId.get() → undefined y crash en agregar).
  const catalogo = [];
  {
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, descripcion, precio, precio_usd, stock, categoria_id')
        .eq('activo', true)
        .order('nombre')
        .range(from, from + page - 1);
      if (error) throw error;
      catalogo.push(...(data || []));
      if (!data || data.length < page) break;
    }
  }
  const porNombre = new Map();
  for (const p of catalogo || []) {
    for (const n of [p.nombre, p.descripcion || '']) {
      if (n) porNombre.set(String(n).trim().toLowerCase(), p);
    }
  }
  const porId = new Map((catalogo || []).map((p) => [p.id, p]));

  // #V56 · Nombres de las categorías curadas (para etiquetar la afinidad).
  // Fail-soft: si la migración de fidelización no estuviera aplicada, se sigue.
  const nombreCategoria = new Map();
  try {
    const { data: cats, error: errCats } = await supabase
      .from('fidelizacion_categorias')
      .select('id, nombre');
    if (!errCats) for (const c of cats || []) nombreCategoria.set(c.id, c.nombre);
  } catch {
    /* sin categorías: la afinidad por categoría simplemente no aplica */
  }

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
    if (!producto) return;
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

  // 3) Hábitos declarados (#V65 · join cliente↔producto) → recomendar esos
  // productos del catálogo que el cliente aún no lleva.
  const habitos = await getClienteHabitos(telefono).catch(() => []);
  for (const h of habitos) {
    const p = porId.get(h.producto_id);
    if (!p) continue;
    agregar(p, 'habito', 'Compra habitual', `Marcado como hábito de consumo${h.nombre ? ` («${h.nombre}»)` : ''}.`, RECOMENDACION_PRIORIDAD.habito);
  }

  // 3b) #V56 · Categoría (curada): lo que ya compró agrupado por categoría
  // (Parafarmacia / Vitaminas / Dermocosmética) → otras opciones de esa misma
  // categoría que aún no tiene. Solo si el catálogo tiene `categoria_id`
  // asignado (ver scripts/clasificar-categorias.js).
  if (yaTiene.size) {
    const catCount = new Map();
    for (const pid of yaTiene) {
      const p = porId.get(pid);
      if (p && p.categoria_id) catCount.set(p.categoria_id, (catCount.get(p.categoria_id) || 0) + 1);
    }
    const topCats = [...catCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
    for (const cat of topCats) {
      const candidatos = (catalogo || [])
        .filter((p) => p.categoria_id === cat && Number(p.stock) > 0)
        .slice(0, 3);
      for (const p of candidatos) {
        agregar(p, 'categoria', 'Según tus intereses', 'Otra opción de una categoría que ya compras.', RECOMENDACION_PRIORIDAD.categoria);
      }
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

  // 5) Afinidad por categoría curada (#V56): categorías que más compra → otros
  // productos de esas mismas categorías que aún no lleva.
  const frecuenciaCategoria = new Map();
  for (const pid of yaTiene) {
    const cat = porId.get(pid)?.categoria_id;
    if (cat) frecuenciaCategoria.set(cat, (frecuenciaCategoria.get(cat) || 0) + 1);
  }
  const categoriasTop = [...frecuenciaCategoria.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [catId, n] of categoriasTop) {
    const etiquetaCat = nombreCategoria.get(catId) || 'su categoría';
    const ofertas = (catalogo || []).filter((p) => p.categoria_id === catId && !yaTiene.has(p.id));
    for (const p of ofertas.slice(0, 2)) {
      agregar(p, 'categoria', 'De tu categoría favorita', `Suele comprar en «${etiquetaCat}» (${n} ${n === 1 ? 'compra' : 'compras'}).`, RECOMENDACION_PRIORIDAD.categoria);
    }
  }

  // 6) Contenido: tokens de lo que ya lleva vs catálogo
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

  // 7) Relleno: más vendidos (arranque en frío para clientes sin historial)
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
  extraerNombreDeMensaje,
  asistentePidioNombre,
  hasPedidoConfirmado,
  tiposClientes,
  registrarHabitosConsumo,
  getClienteHabitos,
  setClienteHabitos,
  resumirPerfilConsumo,
  construirPerfilConsumo,
  claimWebhookEvent,
  getRecomendaciones,
  RECOMENDACION_PRIORIDAD,
};
