'use strict';

// #V55 · Matcher determinista de la base de conocimiento (KB/FAQ). SIN LLM,
// SIN embeddings: puntúa entradas por solapamiento de palabras/tags contra el
// texto del cliente. Puro (sin fs/red/Supabase) → testeable con
// `node scripts/test-kb.js`. El motor (ai.js) lo usa para GRONDAR la respuesta
// en conocimiento verificado (o para no responder y derivar a una persona).

const { normalizar } = require('./intents');

// Palabras vacías (ES) que no aportan señal para el matching.
const STOPWORDS = new Set([
  'que', 'con', 'sin', 'por', 'para', 'los', 'las', 'del', 'una', 'uno', 'unos',
  'unas', 'este', 'esta', 'esto', 'estos', 'estas', 'como', 'mas', 'pero', 'muy',
  'son', 'fue', 'ser', 'estoy', 'estan', 'hay', 'tiene', 'tienen', 'tengo',
  'puedo', 'puede', 'pueden', 'podria', 'quiero', 'necesito', 'hola', 'buenas',
  'gracias', 'usted', 'ustedes', 'solo', 'algo', 'algun', 'alguna', 'aqui',
  'alla', 'cuando', 'donde', 'porque', 'tambien', 'tambien', 'me', 'te', 'mi',
  'tu', 'su', 'se', 'es', 'si', 'no', 'ya', 'os', 'les', 'nos', 'al', 'el',
  'la', 'lo', 'un', 'les', 'a', 'y', 'o', 'en', 'de',
]);

function tokens(texto) {
  return normalizar(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// Coincidencia exacta o por prefijo (≥4 letras) para tolerar variantes
// ("hora" ↔ "horario", "pagar" ↔ "pago").
function coincideToken(t, conjunto) {
  if (conjunto.has(t)) return true;
  if (t.length < 4) return false;
  for (const b of conjunto) {
    if (b.length >= 4 && (b.startsWith(t) || t.startsWith(b))) return true;
  }
  return false;
}

function conjuntoPalabras(entrada) {
  const tags = Array.isArray(entrada?.tags) ? entrada.tags : [];
  const tagTokens = new Set();
  for (const tg of tags) {
    for (const t of tokens(tg)) tagTokens.add(t);
  }
  const pregTokens = new Set(tokens(entrada?.pregunta || ''));
  return { tagTokens, pregTokens };
}

// Puntúa una entrada contra el texto del cliente.
//   tags   → 3 puntos por palabra coincidente
//   pregunta → 1 punto por palabra coincidente
//   frase-tag completa presente en el texto → +2
// Devuelve { score, cobertura } (cobertura = palabras de la consulta cubiertas).
function puntuarEntrada(texto, entrada) {
  const q = tokens(texto);
  if (!q.length) return { score: 0, cobertura: 0, tagExact: 0 };
  const { tagTokens, pregTokens } = conjuntoPalabras(entrada);
  let score = 0;
  let matches = 0;
  let tagExact = 0;
  for (const t of q) {
    if (coincideToken(t, tagTokens)) {
      score += 3;
      matches += 1;
      if (tagTokens.has(t)) tagExact += 1;
    } else if (coincideToken(t, pregTokens)) {
      score += 1;
      matches += 1;
    }
  }
  const qNorm = normalizar(texto);
  const tags = Array.isArray(entrada?.tags) ? entrada.tags : [];
  for (const tg of tags) {
    const tn = normalizar(tg);
    if (tn.length >= 4 && qNorm.includes(tn)) score += 2;
  }
  return { score, cobertura: matches / q.length, tagExact };
}

// Devuelve las entradas aprobadas más relevantes para `texto`, ordenadas.
function buscarKB(texto, entradas, { limite = 3, minScore = 3, minCobertura = 0.34 } = {}) {
  const scored = [];
  for (const e of entradas || []) {
    if (e.estado && e.estado !== 'aprobada') continue;
    const { score, cobertura, tagExact } = puntuarEntrada(texto, e);
    // Cualifica si supera el puntaje mínimo Y (cubre suficiente consulta O
    // coincide al menos una etiqueta exacta, aunque el resto sea relleno).
    if (score >= minScore && (cobertura >= minCobertura || tagExact >= 1)) {
      scored.push({ ...e, _score: score, _cobertura: cobertura });
    }
  }
  scored.sort((a, b) => b._score - a._score || b._cobertura - a._cobertura);
  return scored.slice(0, limite);
}

// Palabras que no describen una consulta útil (saludos, relleno) — minería de
// aprendizaje (#V55).
const RUIDO = new Set([
  'hola', 'buenas', 'gracias', 'por', 'favor', 'ok', 'vale', 'si', 'no', 'una',
  'pregunta', 'consulta', 'ayuda', 'quisiera', 'podrian', 'pueden',
  'hacen', 'hacer', 'atienden', 'atiende', 'venden', 'vende',
]);

// ¿Es un mensaje del cliente una consulta aprovechable como FAQ candidata?
function esPreguntaUtil(texto) {
  const t = String(texto || '').trim();
  if (t.length < 8 || t.length > 200) return false;
  const tk = tokens(t).filter((w) => !RUIDO.has(w));
  if (tk.length < 2) return false;
  return /\?/.test(t) || /\b(cual|qué|que|cuanto|cuánto|cuantos|donde|dónde|como|cómo|cuando|tienen|tienes|aceptan|hacen|hay|puedo|se puede|es posible)\b/i.test(t);
}

// Etiquetas automáticas de una pregunta (tokens distintivos) — ayudan al matcher.
function tagsDePregunta(texto) {
  const vistos = new Set();
  const out = [];
  for (const t of tokens(texto)) {
    if (t.length < 4 || RUIDO.has(t) || vistos.has(t)) continue;
    vistos.add(t);
    out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

module.exports = { tokens, puntuarEntrada, buscarKB, STOPWORDS, esPreguntaUtil, tagsDePregunta };
