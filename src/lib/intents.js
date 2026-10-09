'use strict';

// #V52 · Router determinista de intents (SIN LLM). Clasifica el mensaje del
// cliente en un intent con scope definido y decide qué herramientas exponer.
// Estrategia "structured-guided": el prompt base (bot_config/system.txt) queda
// intacto y se ANEXAN overlays cortos por intent; la exposición de tools es
// CONSERVADORA (core siempre presente; saludo/general/handoff = todas).
// Puro: sin fs, sin red, sin Supabase → testeable con `node scripts/test-intents.js`.

const INTENTS = ['saludo', 'buscar', 'carrito', 'puntos', 'handoff', 'general'];

// Herramientas imprescindibles en cualquier turno: el grounding de precio/stock
// y la vía de escape a humano nunca deben desaparecer.
const TOOLS_CORE = ['consultar_precio_y_stock', 'solicitar_asistencia_humana'];

// null => exponer TODAS las herramientas (fallback seguro ante baja confianza).
const TOOLS_POR_INTENT = {
  buscar: [...TOOLS_CORE, 'agregar_al_carrito'],
  carrito: [...TOOLS_CORE, 'agregar_al_carrito', 'ver_resumen_carrito', 'actualizar_estado_pedido'],
  puntos: [...TOOLS_CORE, 'consultar_puntos'],
  saludo: null,
  general: null,
  handoff: null,
};

// Orden de desempate (mayor prioridad primero). Ante empate gana el primero.
const PRIORIDAD = ['handoff', 'carrito', 'puntos', 'buscar', 'saludo'];

// Se aplica sobre el texto YA normalizado (minúsculas, sin acentos).
const REGLAS = [
  {
    intent: 'handoff',
    peso: 3,
    re: /\b(hablar con|hablar a|una persona|un humano|farmaceutic\w*|especialista\w*|operador\w*|auditor|agente|asesor\w*|emergencia\w*|urgencia|urgent\w*|reaccion\w*|sintoma\w*|embaraz\w*|amamant\w*|lactan\w*|receta\w*|posolog\w*|dosis|me duele|dolor fuerte|dolor de pecho|sangra\w*|fiebre alta|convulsion\w*|me falta el aire|no puedo respirar)\b/i,
  },
  {
    intent: 'puntos',
    peso: 3,
    re: /\b(punto|puntos|saldo|beneficio|beneficios|fideliza\w*|recompensa\w*|canje\w*|canjear)\b/i,
  },
  {
    intent: 'carrito',
    peso: 3,
    re: /\b(carrito|resumen|mi compra|lo quiero|la quiero|quiero ese|quiero esa|quiero esos|quiero esas|confirmo|confirmar|confirmado|reservar|reserva|reservado|pedido|total)\b/i,
  },
  {
    intent: 'carrito',
    peso: 1,
    re: /\b(anad\w*|agrega\w*|agregar\w*|quita\w*|elimin\w*|retira\w*|mete\w*|llevo|sumale|suma)\b/i,
  },
  {
    intent: 'buscar',
    peso: 2,
    re: /\b(precio\w*|cuanto\w*|cuanta\w*|cuesta\w*|stock|disponib\w*|barat\w*|economic\w*|tienen|tienes|teneis|hay|venden|alternativa\w*|opcion\w*|opciones)\b/i,
  },
  {
    intent: 'buscar',
    peso: 1,
    re: /\b(busc\w*|producto\w*|medicament\w*|pastilla\w*|jarabe\w*|crema\w*|gel|comprimid\w*|capsula\w*|marca\w*|necesito|quiero|sirve)\b/i,
  },
  {
    intent: 'saludo',
    peso: 1,
    re: /\b(hola|buenas|buenos dias|buenas tardes|buenas noches|que tal|hey|gracias)\b/i,
  },
];

// Confirmaciones / selección de opción: sólo cuentan como CARRITO si hay
// contexto de compra (productos mostrados o hilo previo de buscar/carrito).
const RE_CONFIRMACION =
  /^(si|s|ok|okey|vale|dale|confirmo|confirmar|perfecto|de acuerdo|claro|listo|venga)$/;
const RE_OPCION = /^(el |la |los |las )?\d{1,2}$/;
const RE_ORDINAL = /\b(primer\w*|segund\w*|tercer\w*|cuart\w*|ese|esa|eso|esos|esas)\b/;

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ultimoIntent(contextoBot) {
  const arr = contextoBot && Array.isArray(contextoBot.ultimos_intents)
    ? contextoBot.ultimos_intents
    : [];
  const last = arr[arr.length - 1];
  return typeof last === 'string' ? last : (last && last.intent) || null;
}

// Clasifica el texto del cliente. Devuelve { intent, confianza, score, señales }.
//   confianza 'alta'  -> tools del intent
//   confianza 'media' -> tools del intent
//   confianza 'baja'  -> todas las tools (general)
function clasificar(texto, opts = {}) {
  const { contextoBot = {}, toolContext = {} } = opts;
  const t = normalizar(texto);
  const senales = [];
  const scores = { saludo: 0, buscar: 0, carrito: 0, puntos: 0, handoff: 0 };

  for (const regla of REGLAS) {
    const m = regla.re.exec(t);
    if (m) {
      scores[regla.intent] += regla.peso;
      senales.push(`${regla.intent}:${m[0]}`);
    }
  }

  const hayProductos = Boolean(toolContext) && Object.keys(toolContext).length > 0;
  const previo = ultimoIntent(contextoBot);
  const contextoCompra = hayProductos || previo === 'carrito' || previo === 'buscar';
  const esConfirmacion =
    RE_CONFIRMACION.test(t) || RE_OPCION.test(t) || RE_ORDINAL.test(t);

  if (esConfirmacion && contextoCompra) {
    senales.push('estado:confirmacion');
    return { intent: 'carrito', confianza: 'alta', score: scores.carrito, senales };
  }

  let intent = 'general';
  let bestScore = 0;
  for (const it of PRIORIDAD) {
    if (scores[it] > bestScore) {
      bestScore = scores[it];
      intent = it;
    }
  }
  let confianza = 'baja';
  if (bestScore >= 2) confianza = 'alta';
  else if (bestScore >= 1) confianza = 'media';
  if (confianza === 'baja') intent = 'general';

  return { intent, confianza, score: bestScore, senales };
}

// Filtra el array de tools (formato OpenAI) según intent/confianza.
// Devuelve el mismo array si no hay recorte (intent sin mapa o confianza baja).
function filtrarTools(tools, intent, confianza) {
  if (!Array.isArray(tools)) return tools;
  if (confianza === 'baja') return tools;
  const nombres = TOOLS_POR_INTENT[intent];
  if (!nombres) return tools;
  const set = new Set(nombres);
  return tools.filter((tl) => set.has(tl.name));
}

module.exports = {
  INTENTS,
  TOOLS_CORE,
  TOOLS_POR_INTENT,
  normalizar,
  clasificar,
  filtrarTools,
};
