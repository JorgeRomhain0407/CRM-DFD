'use strict';

// #V56 · Clasificador determinista de productos en las categorías curadas del
// programa (Parafarmacia / Vitaminas / Dermocosmética), las mismas semilla de
// `public.fidelizacion_categorias`. Puro: sin fs, red ni Supabase → testeable
// con `node scripts/test-categorias.js`.
//
// Criterio CONSERVADOR: si el nombre no tiene señal clara (per ejemplo un
// medicamento con principio activo y dosis, pero sin marca/formato de categoría)
// devuelve `null` a propósito. La clasificación alimenta:
//   - el bonus 2x de puntos (productos.categoria_id → fidelizacion_categorias)
//   - las recomendaciones por categoría (getRecomendaciones)
// Es revisable a mano desde el panel (POST /api/fidelizacion/producto-categoria).

const CATEGORIAS = ['Dermocosmética', 'Vitaminas', 'Parafarmacia'];

// Puntuación mínima para clasificar (evita matches débiles de una sola palabra
// genérica). Cada categoría suma el peso de TODAS sus coincidencias.
const MIN_SCORE = 3;

// Guarda anti-medicamento: NO clasificamos fármacos aunque el nombre contenga
// una palabra de categoría (p. ej. "CLOTRIMAZOL CREMA VAGINAL", "MAGNESIO SOL
// INY"). Si el texto presenta una forma farmacéutica/vía clínica y no hay una
// señal fuerte de suplemento o marca dermo, devolvemos null.
const MED_FORMS = /\b(solucion inyectable|sol iny|inyectable|\biny\b|ampolla\w*|\bamps?\b|comprimid\w*|\bcomps?\b|\btabs?\b|tableta\w*|capsula\w*|\bcaps\b|suspension\w*|\bsusp\b|jarabe|gotas|sobres?\b|granulado\w*|supositorio\w*|ovulo\w*|pomada\w*|unguento\w*|via oral|suero oral|vaginal\w*|topica\w*|topico\w*|oftalmic\w*|otico\w*|rectal\w*)\b/;
const STRONG_SUPP = /\b(multivitamin|polivitamin)\w*|\bvitamin\w*|\bvit\b|\bac folico\b|complejo b|complejo vitamin\w*|\bcolageno\b|\bglucosamina\b|\bcondroitina\b|\bomega\b|\baminoacid\w*|\bsuplemento\w*|\boligoelemento\w*|\bpropoleo\b|jalea real|espirulina|ginseng|ginkgo|melatonina|creatina|glutamina|carnitina|\bcentrum\b|supradyn|pharmaton|multicentrum|berocca|vitaldin/;
const DM_BRAND = /\b(la roche|roche posay|cerave|isdin|avene|vichy|eucerin|bioderma|svr|sesderma|martiderm|singuladerm|cantabria|heliocare|uriage|ducray|klorane|neostrata|filorga|lancaster|sensilis|cumlaude|lepiderm|babaria|sebamed|frezy)\b/;

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cada regla: [regex sobre texto normalizado, peso]. El orden de CATEGORIAS es
// el desempate: a igual puntuación gana la categoría más arriba (dermo > vit >
// parafarmacia).
const REGLAS = {
  'Vitaminas': [
    [/\b(multivitamin|polivitamin)\w*/, 4],
    [/\bvitamin\w*|\bvit\b/, 3],
    [/\bcomplejo b\b|\bcomplejo vitamin\w*/, 4],
    [/\b(tiamina|riboflavina|piridoxina|cianocobalamina|biotina|niacin\w*)\b/, 3],
    [/\bacido (folico|ascorbico|pantotenico)\b/, 3],
    [/\b(omega|omg)\b|\baceite de (pescado|higado)\b/, 3],
    [/\b(calcio|magnesio|hierro|ferro|zinc|selenio|yodo|potasio)\b/, 3],
    [/\bcolageno\b/, 3],
    [/\b(glucosamina|condroitina|cartilago)\b/, 3],
    [/\b(l ?carnitina|taurina|creatina|aminoacid\w*|glutamina|arginina)\b/, 3],
    [/\b(jalea real|propoleo|equinacea|espirulina|ginseng|ginkgo|melatonina)\b/, 3],
    [/\b(suplemento\w*|nutricional\w*|oligoelemento\w*)\b/, 3],
    [/\b(centrum|supradyn|pharmaton|multicentrum|berocca|vitaldin|ferrovit|tardyferon|naturade|aderogyl)\b/, 4],
  ],
  'Dermocosmética': [
    [/\b(protector solar|fotoprotector\w*|pantalla solar|spf)\b/, 4],
    [/\b(gel de ducha|gel limpiador|limpiador facial|tonico\w*|agua micelar|desmaquillante\w*)\b/, 4],
    [/\b(la roche|roche posay|cerave|isdin|avene|vichy|eucerin|bioderma|svr|sesderma|martiderm|singuladerm|cantabria|heliocare|uriage|ducray|klorane|neostrata|filorga|lancaster|sensilis|cumlaude|lepiderm|babaria|sebamed|frezy)\b/, 4],
    [/\b(crema\w*|serum\w*|locion\w*|emulsion\w*|hidratante\w*|balsamo\w*)\b/, 3],
    [/\b(champu\w*|shampoo\w*|acondicionador\w*|anticaida)\b/, 3],
    [/\b(retinol|niacinamida|hialuronico|glicolico)\b/, 3],
    [/\b(antiarrugas|antiedad|reafirmante|facial|corporal|contorno de ojos)\b/, 2],
    [/\b(desodorante\w*|antitranspirante\w*)\b/, 3],
    [/\bsolar\b/, 3],
  ],
  'Parafarmacia': [
    [/\b(termometro\w*|tensiometro\w*|glucometro\w*|oximetro\w*|tiras reactivas|nebulizador\w*)\b/, 4],
    [/\b(baston\w*|muleta\w*|andador\w*|faja\w*|rodillera\w*|tobillera\w*|munera\w*|plantilla\w*|ortesis)\b/, 4],
    [/\b(preservativo\w*|lubricante\w*|test de embarazo|absorbente\w*|compresa\w*|salvaslip\w*|tampon\w*|toallita\w*)\b/, 4],
    [/\b(cepillo de dientes|pasta de dientes|enjuague bucal|hilo dental|crema dental|pasta dental|dentifrico\w*|colutorio\w*)\b/, 4],
    [/\b(gasa\w*|venda\w*|esparadrapo\w*|tirita\w*|aposito\w*)\b/, 3],
    [/\b(alcohol\w*|agua oxigenada|clorhexidina|povidona|betadine|antiseptic\w*|desinfectante\w*)\b/, 3],
    [/\b(jeringa\w*|jeringuilla\w*|aguja\w*|suero fisiologico|sonda\w*|irrigador\w*)\b/, 3],
    [/\b(panal\w*|biberon\w*|chupete\w*|sacaleches|papilla\w*)\b/, 3],
    [/\b(protesis|media de compresion|calcetin de compresion)\b/, 4],
  ],
};

// Devuelve { categoria, motivo, score }. categoria = null si no hay señal clara.
function clasificarProducto({ nombre, marca, descripcion } = {}) {
  const texto = normalizar([nombre, marca, descripcion].filter(Boolean).join(' '));
  if (!texto) return { categoria: null, motivo: null, score: 0 };

  const scores = {};
  const motivos = {};
  for (const [cat, reglas] of Object.entries(REGLAS)) {
    let s = 0;
    const hits = [];
    for (const [re, w] of reglas) {
      const m = re.exec(texto);
      if (m) {
        s += w;
        hits.push(m[0]);
      }
    }
    scores[cat] = s;
    motivos[cat] = hits;
  }

  let mejor = null;
  let mejorScore = 0;
  for (const cat of CATEGORIAS) {
    if (scores[cat] > mejorScore) {
      mejorScore = scores[cat];
      mejor = cat;
    }
  }
  if (!mejor || mejorScore < MIN_SCORE) return { categoria: null, motivo: null, score: mejorScore };

  // Guarda anti-medicamento (ver MED_FORMS arriba).
  if (MED_FORMS.test(texto) && !STRONG_SUPP.test(texto) && !DM_BRAND.test(texto)) {
    return { categoria: null, motivo: null, score: mejorScore };
  }

  return { categoria: mejor, motivo: (motivos[mejor] || []).join(', '), score: mejorScore };
}

module.exports = { clasificarProducto, CATEGORIAS, MIN_SCORE, normalizar };
