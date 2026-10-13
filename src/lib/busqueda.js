'use strict';

// #V57 · Piezas PURAS del buscador de productos (sin I/O, sin Supabase).
// Única fuente de verdad de: normalización de tokens (unidades canónicas),
// matching tolerante, detección de "el más barato" y el ORDEN TOTAL de
// candidatos. El mismo comportamiento se replica en SQL
// (`public._v57_norm_tokens` / `public._v57_match_token` /
// `public.buscar_productos_bot`) y se verifica por paridad en
// `scripts/test-busqueda-parity.js`.
//
// IMPORTANTE (cambio de #V57): el orden de candidatos pasa a ser un ORDEN TOTAL
// determinista (venc NULLS LAST, luego precio desc, luego nombre asc). Antes el
// comparador usaba `if (a.venc && b.venc && ...)` — no transitivo — de modo que
// el resultado dependía del algoritmo de sort de V8. El nuevo orden es igual en
// JS y en SQL, se puede portar y elimina el no determinismo.

// Sinónimos de unidades de medida: mapea cada variante a su forma normalizada.
// Tanto el query del cliente como el nombre en BD se normalizan a estos tokens.
const UNIDADES = {
  g: 'gramo', gr: 'gramo', gramo: 'gramo', gramos: 'gramo',
  mg: 'miligramo', miligramo: 'miligramo', miligramos: 'miligramo',
  ml: 'mililitro', mililitro: 'mililitro', mililitros: 'mililitro',
  l: 'litro', litro: 'litro', litros: 'litro',
  mcg: 'microgramo', ug: 'microgramo', microgramo: 'microgramo', microgramos: 'microgramo',
  ui: 'ui', 'iu': 'ui', unidades: 'ui',
  comprimidos: 'comprimidos', comprimido: 'comprimidos', comp: 'comprimidos',
  capsulas: 'capsulas', capsula: 'capsulas', cápsulas: 'capsulas', caps: 'capsulas',
  monodosis: 'monodosis', dosis: 'monodosis',
};

// Tokens que representan unidades de medida: el match debe ser EXACTO (no por
// subcadena) para evitar que "gramo" matchee "miligramo" o "mililitro" a "litro".
const UNIDADES_EXACTAS = new Set([
  'gramo', 'miligramo', 'mililitro', 'litro', 'microgramo', 'ui',
  'comprimidos', 'capsulas', 'monodosis',
]);

const STOPWORDS = new Set([
  'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'quiero',
  'quieres', 'que', 'cuanto', 'cual', 'precio', 'tiene', 'tengo', 'hay', 'me', 'su',
  'en', 'y', 'a', 'al', 'se', 'por', 'para', 'con', 'ver', 'mi', 'tu', 'es',
]);

// ¿El token del nombre (nt) coincide con el token del query (tk)?
// Unidades: coincidencia exacta. Resto: subcadena (tolerante a plurales/raíces).
function matchToken(nt, tk) {
  if (UNIDADES_EXACTAS.has(tk)) return nt === tk;
  return nt.includes(tk) || tk.includes(nt);
}

// Normaliza un texto: minúsculas, quita acentos, separa números de letras y
// sustituye las medidas por su forma canónica. Devuelve la lista de tokens
// normalizados (SIN filtrar stopwords: los nombres de producto los conservan).
function normalizarTokens(texto) {
  const t = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[.,;:()]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return t.map((tok) => (UNIDADES[tok] ? UNIDADES[tok] : tok));
}

// Tokens "significativos" del query: longitud > 1 y no stopword.
function tokensQuery(texto) {
  return normalizarTokens(texto).filter((tk) => tk.length > 1 && !STOPWORDS.has(tk));
}

// El token normalizado más largo (desempate estable: el primero de igual longitud).
function medularDe(tokens) {
  return [...tokens].sort((a, b) => b.length - a.length)[0];
}

// Palabra "base" para el ILIKE: el token RAW (lowercase, sin normalizar unidades)
// más largo de longitud > 1 que no sea stopword; si no hay, el medular.
function patronBaseDe(textoRaw, medular) {
  const rawTokens = String(textoRaw).toLowerCase().split(/\s+/);
  const candidato = rawTokens
    .filter((tk) => tk.length > 1 && !STOPWORDS.has(tk))
    .sort((a, b) => b.length - a.length)[0];
  return candidato || medular;
}

// ¿El cliente pidió explícitamente lo más barato? (solo entonces `orden_precio`
// se honra). Copiado tal cual del buscador original.
function esPrecioBarato(textoRaw, ordenPrecio) {
  const raw = String(textoRaw || '');
  return (
    (ordenPrecio === 'asc' &&
      /barat|económic|econom|asequibl|precio.*(baj|m.?nim|menor)/i.test(raw)) ||
    /(m.?nim|baj|menor|más barato|mas barato).*precio/i.test(raw)
  );
}

// Orden TOTAL determinista (debe coincidir EXACTAMENTE con el ORDER BY de
// `public.buscar_productos_bot`).
//   1 coinciden desc · 2 marca desc · 3 [esBarato] precio asc · 4 veces asc ·
//   5 stock desc · 6 venc asc (NULLS LAST) · 7 precio desc · 8 nombre asc
function compararOrden(a, b, esBarato) {
  if (b.coinciden !== a.coinciden) return b.coinciden - a.coinciden;
  if (b.marca !== a.marca) return b.marca - a.marca;
  if (esBarato && a.precio !== b.precio) return a.precio - b.precio;
  if (a.veces !== b.veces) return a.veces - b.veces;
  if (b.stock !== a.stock) return b.stock - a.stock;
  if (a.venc == null && b.venc != null) return 1;
  if (a.venc != null && b.venc == null) return -1;
  if (a.venc != null && b.venc != null && a.venc !== b.venc) return a.venc - b.venc;
  if (b.precio !== a.precio) return b.precio - a.precio;
  if (a.nombre !== b.nombre) return a.nombre < b.nombre ? -1 : 1;
  return 0;
}

// Puntúa y ordena candidatos (ya traídos de la BD) y devuelve el top-N.
// ctx es el mapa de rotación (producto_id -> { veces, ultima, ... }).
function rankearCandidatos({ candidatos, tokens, rawTokens, esBarato = false, ctx = {}, top = 3 }) {
  const puntuados = [];
  for (const p of candidatos) {
    const tokensNombre = normalizarTokens(p.nombre);
    const coinciden = tokens.filter((tk) =>
      tokensNombre.some((nt) => matchToken(nt, tk))
    ).length;

    const nombreLower = String(p.nombre).toLowerCase();
    const marca = rawTokens.find(
      (tk) => tk.length > 3 && nombreLower.includes(tk) && nombreLower !== tk
    );

    puntuados.push({
      p,
      coinciden,
      marca: marca ? 1 : 0,
      veces: ctx[p.id]?.veces || 0,
      precio: Number(p.precio),
      stock: p.stock,
      nombre: p.nombre,
      venc: p.fecha_vencimiento ? new Date(p.fecha_vencimiento).getTime() : null,
    });
  }

  puntuados.sort((a, b) => compararOrden(a, b, esBarato));
  return puntuados.slice(0, top).map((r) => r.p);
}

module.exports = {
  UNIDADES,
  UNIDADES_EXACTAS,
  STOPWORDS,
  matchToken,
  normalizarTokens,
  tokensQuery,
  medularDe,
  patronBaseDe,
  esPrecioBarato,
  compararOrden,
  rankearCandidatos,
};
