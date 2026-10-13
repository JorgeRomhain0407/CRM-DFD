'use strict';

// #V55 · Servicio de la base de conocimiento (KB/FAQ). Persistencia + caché de
// las entradas APROBADAS (las únicas que el bot puede usar para groundear). El
// matcher determinista vive en `src/lib/kb.js` (puro); aquí solo se accede a BD.

const { getSupabase } = require('../lib/supabase');
const { buscarKB } = require('../lib/kb');

// Igual que la caché de bot_config (#V51): la KB se lee en cada turno del LLM y
// casi nunca cambia. TTL 45 s + invalidación al escribir.
const KB_TTL_MS = 45 * 1000;
let kbCache = { value: null, expires: 0 };

const ESTADOS = ['propuesta', 'aprobada', 'rechazada', 'archivada'];
const CAMPOS = 'id, pregunta, respuesta, tags, estado, origen, nota, veces_usada, aprobada_at, created_at, updated_at';

function limpiarTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    const s = String(t || '').trim().toLowerCase().slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

function invalidarCache() {
  kbCache = { value: null, expires: 0 };
}

async function getKBAprobadas() {
  const ahora = Date.now();
  if (kbCache.value && ahora < kbCache.expires) return kbCache.value;
  const { data, error } = await getSupabase()
    .from('kb_faq')
    .select(CAMPOS)
    .eq('estado', 'aprobada')
    .order('veces_usada', { ascending: false });
  if (error) throw error;
  kbCache = { value: data || [], expires: ahora + KB_TTL_MS };
  return kbCache.value;
}

async function listarKB({ estado } = {}) {
  let query = getSupabase().from('kb_faq').select(CAMPOS);
  if (estado && ESTADOS.includes(estado)) query = query.eq('estado', estado);
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getKB(id) {
  const { data, error } = await getSupabase()
    .from('kb_faq')
    .select(CAMPOS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function crearKB({ pregunta, respuesta, tags, estado = 'propuesta', origen = 'manual', nota } = {}) {
  const p = String(pregunta || '').trim();
  if (p.length < 3) {
    const err = new Error('La pregunta es obligatoria.');
    err.statusCode = 400;
    throw err;
  }
  const fila = {
    pregunta: p,
    respuesta: String(respuesta || '').trim(),
    tags: limpiarTags(tags),
    estado: ESTADOS.includes(estado) ? estado : 'propuesta',
    origen: origen === 'aprendizaje' ? 'aprendizaje' : 'manual',
    nota: nota != null ? String(nota).slice(0, 500) : null,
  };
  if (fila.estado === 'aprobada') fila.aprobada_at = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from('kb_faq')
    .insert(fila)
    .select(CAMPOS)
    .single();
  if (error) throw error;
  invalidarCache();
  return data;
}

async function actualizarKB(id, { pregunta, respuesta, tags, estado } = {}) {
  const payload = {};
  if (pregunta !== undefined) {
    const p = String(pregunta || '').trim();
    if (p.length < 3) {
      const err = new Error('La pregunta es obligatoria.');
      err.statusCode = 400;
      throw err;
    }
    payload.pregunta = p;
  }
  if (respuesta !== undefined) payload.respuesta = String(respuesta || '').trim();
  if (tags !== undefined) payload.tags = limpiarTags(tags);
  if (estado !== undefined && ESTADOS.includes(estado)) {
    payload.estado = estado;
    if (estado === 'aprobada') payload.aprobada_at = new Date().toISOString();
  }
  if (!Object.keys(payload).length) {
    const err = new Error('Nada que actualizar.');
    err.statusCode = 400;
    throw err;
  }
  const { data, error } = await getSupabase()
    .from('kb_faq')
    .update(payload)
    .eq('id', id)
    .select(CAMPOS)
    .single();
  if (error) throw error;
  invalidarCache();
  return data;
}

async function borrarKB(id) {
  const { error } = await getSupabase().from('kb_faq').delete().eq('id', id);
  if (error) throw error;
  invalidarCache();
  return { ok: true };
}

async function aprobarKB(id) {
  const entrada = await getKB(id);
  if (!entrada) {
    const err = new Error('Entrada no encontrada.');
    err.statusCode = 404;
    throw err;
  }
  if (!String(entrada.respuesta || '').trim()) {
    const err = new Error('No se puede aprobar una entrada sin respuesta (grounding).');
    err.statusCode = 400;
    throw err;
  }
  return actualizarKB(id, { estado: 'aprobada' });
}

async function rechazarKB(id, nota) {
  if (nota !== undefined && nota !== null) {
    const { error } = await getSupabase()
      .from('kb_faq')
      .update({ nota: String(nota).slice(0, 500) })
      .eq('id', id);
    if (error) throw error;
  }
  return actualizarKB(id, { estado: 'rechazada' });
}

// Búsqueda de grounding: devuelve las entradas aprobadas más relevantes.
async function buscarKBTexto(texto, opts) {
  const kb = await getKBAprobadas();
  return buscarKB(texto, kb, opts);
}

// Incremento atómico del contador de uso (best-effort, fire-and-forget).
async function marcarUso(ids) {
  const lista = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!lista.length) return;
  const { error } = await getSupabase().rpc('kb_faq_marcar_uso', { p_ids: lista });
  if (error) return; // fail-soft: la métrica no debe romper el turno
  invalidarCache();
}

// #V55 · Alta de una PROPUESTA de aprendizaje. Idempotente por pregunta_norm:
// si ya existe (cualquier estado) devuelve null (omitida). No auto-activa nada.
async function crearPropuesta({ pregunta, respuesta = '', tags, nota } = {}) {
  const p = String(pregunta || '').trim();
  if (p.length < 3) return null;
  const { data, error } = await getSupabase()
    .from('kb_faq')
    .upsert(
      {
        pregunta: p,
        respuesta: String(respuesta || '').trim(),
        tags: limpiarTags(tags),
        estado: 'propuesta',
        origen: 'aprendizaje',
        nota: nota != null ? String(nota).slice(0, 500) : null,
      },
      { onConflict: 'pregunta_norm', ignoreDuplicates: true }
    )
    .select(CAMPOS);
  if (error) throw error;
  invalidarCache();
  return (data && data[0]) || null;
}

module.exports = {
  ESTADOS,
  getKBAprobadas,
  listarKB,
  getKB,
  crearKB,
  actualizarKB,
  borrarKB,
  aprobarKB,
  rechazarKB,
  crearPropuesta,
  buscarKBTexto,
  marcarUso,
};
