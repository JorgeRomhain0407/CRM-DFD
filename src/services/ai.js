'use strict';

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('../config');
const { getSupabase } = require('../lib/supabase');
const { registrarTool, registrarProductoVisto, registrarRespuestaBot, registrarIntent } = require('./cliente-contexto');
const { ejecutarHerramienta, solicitarAsistenciaHumana } = require('./tools');
const { getClienteConEstado, getClienteHabitos } = require('./customers');
const { getBotConfig } = require('./bot');
const { buscarKBTexto, marcarUso } = require('./kb');
const { clasificar, filtrarTools } = require('../lib/intents');
const { capaFallback, ACUSE_REPETIDO } = require('../lib/fallback');

const TOOLS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'lib', 'openai-tools.json'), 'utf8')
);

const DEFAULT_SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'prompts', 'system.txt'),
  'utf8'
);

// #V52/#V53 · Overlays por intent (src/prompts/intents/<intent>.txt) y por capa
// de fallback (src/prompts/fallback/<capa>.txt). Se cargan una vez y se cachean.
// Si no existe el archivo, no se anexa nada.
const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const promptCache = new Map();
function leerPrompt(rel) {
  if (!rel || promptCache.has(rel)) return promptCache.get(rel) || '';
  let texto = '';
  try {
    texto = fs.readFileSync(path.join(PROMPTS_DIR, rel), 'utf8').trim();
  } catch {
    texto = '';
  }
  promptCache.set(rel, texto);
  return texto;
}
function overlayIntent(intent) {
  return intent ? leerPrompt(path.join('intents', `${intent}.txt`)) : '';
}
function overlayFallback(capa) {
  return capa && capa !== 'ninguna' ? leerPrompt(path.join('fallback', `${capa}.txt`)) : '';
}

// #V57b · Modelo por intent (opt-in). Con el flag apagado, `ligero` vacío o el
// intent fuera de la lista, devuelve el modelo normal: 100% inert por defecto.
function modeloDelTurno(intent) {
  const mpi = config.openai.modeloPorIntent;
  if (mpi.enabled && mpi.ligero && intent && mpi.intents.has(intent)) {
    return mpi.ligero;
  }
  return config.openai.model;
}

// #V55 · Bloque de conocimiento verificado (KB/FAQ). Groundea la respuesta en
// contenido aprobado por el operador; prohíbe inventar y cede ante herramientas.
function construirBloqueKB(matches) {
  if (!matches || !matches.length) return '';
  const lineas = matches
    .filter((m) => String(m.respuesta || '').trim())
    .map((m) => `P: ${m.pregunta}\nR: ${m.respuesta}`);
  if (!lineas.length) return '';
  return [
    'CONOCIMIENTO_VERIFICADO DE LA FARMACIA',
    '(Úsalo SOLO si responde a la consulta del cliente. No inventes ni completes datos que no estén aquí:',
    'si la pregunta no queda cubierta, dilo con honestidad y ofrece pasar con una persona. Si el cliente pide',
    'datos de SU cuenta, carrito, pedido o precios/stock, usa las herramientas; esto no las sustituye.)',
    '',
    ...lineas,
  ].join('\n');
}

// #V76 · Bloque con los resultados de inventario YA obtenidos (pre-fetch). Se
// inyecta en las instrucciones y se retira la tool de búsqueda para cerrar el
// turno en UNA sola llamada al modelo. Anti-PII y sin stock exacto (solo
// disponibilidad): no se filtra el número de unidades.
function construirBloquePrefetch(productos) {
  const lineas = productos.map((p, i) => {
    // #V72 · Solo disponibilidad cualitativa (nunca el número exacto de unidades).
    const disp = p.disponibilidad === 'ultimas_unidades'
      ? 'últimas unidades'
      : p.disponibilidad === 'agotado' || !p.disponible
        ? 'agotado'
        : 'disponible';
    const id = p.id ? ` · id_producto=${p.id}` : '';
    const usd = p.precio_usd ? ` (≈${p.precio_usd} USD)` : '';
    return `${i + 1}. ${p.nombre} — ${p.precio}${usd} · ${disp}${id}`;
  });
  return [
    'RESULTADOS_DE_INVENTARIO (YA OBTENIDOS en este turno; NO vuelvas a consultar el precio/stock):',
    ...lineas,
    'Presenta estos productos al cliente con el formato definido. Si ninguno encaja, dilo con honestidad y ofrece pasar con una persona.',
  ].join('\n');
}

function getOpenAI() {
  if (!config.openai.apiKey) {
    const err = new Error('OPENAI_API_KEY no configurada.');
    err.statusCode = 503;
    throw err;
  }
  return new OpenAI({ apiKey: config.openai.apiKey });
}

function etiquetaRol(rol) {
  if (rol === 'usuario') return 'Cliente';
  if (rol === 'operador') return 'Operador humano';
  return 'Defi';
}

async function buildAdditionalInstructions(cliente, telefono, toolContext, contextoBot = {}) {
  const nombre = cliente?.nombre || '(desconocido; recábalo con amabilidad si aún no lo has pedido)';
  const edad = cliente?.edad != null ? String(cliente.edad) : '(desconocida)';
  // #V65 · Hábitos = productos del catálogo (join cliente↔producto). Fallback al
  // texto legacy si el join aún no tiene filas para este cliente.
  let habitos = '(sin hábitos registrados)';
  try {
    const hs = await getClienteHabitos(telefono);
    const nombres = hs.map((h) => h.nombre).filter(Boolean);
    if (nombres.length) habitos = nombres.join(', ');
    else if (cliente?.habitos_consumo) habitos = String(cliente.habitos_consumo);
  } catch {
    if (cliente?.habitos_consumo) habitos = String(cliente.habitos_consumo);
  }
  const ctx = Object.values(toolContext || {}).slice(0, 12)
    .map((p) => `${p.nombre} id_producto=${p.id}`)
    .join('\n');
  const lines = [
    `TELEFONO_E164: ${telefono}`,
    `NOMBRE: ${nombre}`,
    `EDAD: ${edad}`,
    `HABITOS_CONSUMO: ${habitos}`,
    'Usa TELEFONO_E164 en todas las herramientas que pidan telefono_cliente.',
  ];

  // #V30/#V52 · Perfil ágil (JSONB): antes sólo se escribía; aquí se LEE por
  // primera vez para personalizar. Anti-PII: sólo intereses/categorías.
  const perfil = cliente?.perfil && typeof cliente.perfil === 'object' ? cliente.perfil : {};
  const intereses = Array.isArray(perfil.intereses) ? perfil.intereses.filter(Boolean).slice(0, 8) : [];
  const categorias = perfil.categorias && typeof perfil.categorias === 'object'
    ? Object.keys(perfil.categorias).slice(0, 8)
    : [];
  const perfilTxt = [...new Set([...intereses, ...categorias])];
  if (perfilTxt.length) {
    lines.push(`PERFIL_CONSUMO: ${perfilTxt.join(', ')}`);
  }

  // #V52 · Memoria del hilo (estado_chat.contexto_bot): intents recientes +
  // cola de la ventana rodante. Memoria interna; el modelo no debe citarla.
  const memoria = [];
  const ultimos = Array.isArray(contextoBot.ultimos_intents) ? contextoBot.ultimos_intents.slice(-5) : [];
  if (ultimos.length) {
    memoria.push(`  Hilo reciente: ${ultimos.map((x) => (typeof x === 'string' ? x : x.intent)).join(' → ')}`);
  }
  const ventana = Array.isArray(contextoBot.ventana) ? contextoBot.ventana.slice(-4) : [];
  for (const v of ventana) {
    if (v && v.c) memoria.push(`  ${etiquetaRol(v.r)}: ${String(v.c).slice(0, 120)}`);
  }
  if (memoria.length) {
    lines.push('', 'MEMORIA_INTERNA (no la cites textualmente; úsala para no perder el hilo):', ...memoria);
  }

  if (ctx) {
    lines.push(
      '',
      'Productos ya consultados en esta conversación (usa estos id_producto en agregar_al_carrito si el cliente se refiere a ellos):',
      ctx
    );
  }
  return lines.join('\n');
}

// Ventana real de contexto: los ÚLTIMOS N mensajes (no los primeros).
// Orden desc + limite + re-inversión => cronológico y pegado a la cola.
async function getHistorial(telefono, limite = 30) {
  const { data, error } = await getSupabase()
    .from('mensajes')
    .select('rol, contenido, created_at')
    .eq('telefono_cliente', telefono)
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw error;
  const input = [];
  for (const m of (data || []).reverse()) {
    const content = m.contenido;
    if (!content) continue;
    if (m.rol === 'usuario') {
      input.push({ role: 'user', content });
    } else if (m.rol === 'asistente') {
      input.push({ role: 'assistant', content });
    } else if (m.rol === 'operador') {
      // Mensaje escrito por el operador humano desde el panel: contexto
      // necesario para que el bot no lo ignore al retomar la conversación.
      input.push({
        role: 'user',
        content: `(Enviado al cliente por un operador humano, no por el bot): ${content}`,
      });
    }
  }
  return input;
}

function extractAssistantText(response) {
  if (!response?.output) return '';
  const parts = [];
  for (const item of response.output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === 'output_text') parts.push(c.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function functionCalls(response) {
  return (response?.output || []).filter((it) => it.type === 'function_call');
}

// #V45 · Acuse server-side al pasar la conversación a un humano.
const ACUSE_HANDOFF =
  'Perfecto ✅ Ya dejé avisado al equipo de la farmacia: una persona te escribe por este mismo chat en unos minutos. 😊';

async function responderConAsistente({ telefono, texto }) {
  const inicioTurno = Date.now();
  const toolsUsadas = new Set();
  // #V76 · Desglose de fases del turno (solo números, anti-PII) para diagnosticar
  // la latencia: preparación (BD) vs llamadas al modelo vs ejecución de tools,
  // junto con el tamaño de lo enviado al modelo (instrucciones/input/tools).
  const fases = { prep_ms: 0, model_ms: 0, tool_ms: 0 };
  const openai = getOpenAI();
  // #V76 · Paralelo: cliente+estado, config del bot (cacheada) e historial son
  // independientes; antes se esperaban en serie (~3 round-trips encadenados).
  const [{ cliente, estado }, botConfig, historial] = await Promise.all([
    getClienteConEstado(telefono),
    getBotConfig(),
    getHistorial(telefono),
  ]);
  const toolContext = estado?.last_tool_context || {};
  const contextoBot = estado?.contexto_bot || {};
  // El mensaje del usuario llega YA grabado (webhook.js / routes/bot.js lo
  // insertan antes de llamar aquí): getHistorial lo incluye sin necesidad
  // de un push manual que lo duplicaría.

  // #V52 · Router de intents (determinista). Con el flag apagado se comporta
  // como antes: intent general + TODAS las tools + sin overlay.
  const clasificacion = config.intents.enabled
    ? clasificar(texto, { contextoBot, toolContext })
    : { intent: 'general', confianza: 'baja', señales: [] };
  const intent = clasificacion.intent;
  const confianza = clasificacion.confianza;

  // #V53 · Fallback multicapa: racha de turnos sin entender. La racha se lee del
  // contexto previo (estado ya cargado) y se persiste después con registrarIntent.
  const fallbackSeguidos = Number(contextoBot.fallback_seguidos) || 0;
  const capa = config.intents.enabled
    ? capaFallback({ intent, confianza, fallbackSeguidos })
    : 'ninguna';

  if (config.intents.enabled) {
    registrarIntent(telefono, intent, { confianza }).catch(() => {});
  }

  // #V53 · Capa 3: el cliente lleva 2+ turnos sin que entendamos. Se escala de
  // forma determinista (sin llamar al modelo) para no dejarlo en un bucle.
  if (capa === 'escalar') {
    await solicitarAsistenciaHumana(
      { telefono_cliente: telefono, motivo: 'Varios mensajes seguidos sin poder entender la consulta.' },
      telefono,
      { causa: 'fallback_repetido', intent }
    );
    registrarRespuestaBot(telefono, {
      latency_ms: Date.now() - inicioTurno,
      tools: ['solicitar_asistencia_humana'],
      iterations: 0,
      handoff: true,
      intent,
    }).catch(() => {});
    return ACUSE_REPETIDO;
  }

  // #V76 · Pre-fetch determinista (opt-in, BOT_PREFETCH): para el intent `buscar`
  // resolvemos el inventario con UNA llamada a la RPC/JS ANTES del modelo y se lo
  // inyectamos; además retiramos la tool de búsqueda, de modo que el turno se
  // responde en UNA sola llamada al modelo (elimina el ida-y-vuelta tool→modelo).
  // Fail-soft: si el pre-fetch falla o no hay resultados, se conserva el camino
  // clásico (el modelo usará la tool con normalidad).
  const toolsPrefetchQuitar = new Set();
  let bloquePrefetch = '';
  if (config.prefetch.enabled && confianza !== 'baja' && intent === 'buscar') {
    try {
      const res = await ejecutarHerramienta(
        'consultar_precio_y_stock',
        {
          nombre_producto: texto,
          orden_precio: /barat|economic/i.test(texto) ? 'asc' : undefined,
        },
        { telefono, intent }
      );
      if (res?.ok && Array.isArray(res.productos) && res.productos.length) {
        registrarTool(telefono, 'consultar_precio_y_stock', true);
        toolsUsadas.add('consultar_precio_y_stock');
        for (const p of res.productos) {
          toolContext[p.id] = { id: p.id, nombre: p.nombre };
          registrarProductoVisto(telefono, p.id).catch(() => {});
        }
        bloquePrefetch = construirBloquePrefetch(res.productos);
        toolsPrefetchQuitar.add('consultar_precio_y_stock');
      }
    } catch {
      // fail-soft: sin pre-fetch el turno sigue por el camino clásico.
    }
  }

  // #V56 · La tool de recomendaciones es revertible: con BOT_RECOMENDACIONES=0 se
  // retira antes de filtrar por intent.
  const toolsDisponibles = config.recomendaciones.enabled
    ? TOOLS
    : TOOLS.filter((tl) => tl.name !== 'recomendar_productos');
  const toolsTurnoBase = config.intents.enabled ? filtrarTools(toolsDisponibles, intent, confianza) : toolsDisponibles;
  // #V76 · Retira del turno la tool cuyo resultado ya hemos pre-calculado.
  const toolsTurno = toolsPrefetchQuitar.size
    ? toolsTurnoBase.filter((tl) => !toolsPrefetchQuitar.has(tl.name))
    : toolsTurnoBase;
  // Capas 1/2 (aclarar/sugerir) usan su overlay; el resto, el overlay del intent.
  const overlay = config.intents.enabled
    ? (capa === 'aclarar' || capa === 'sugerir' ? overlayFallback(capa) : overlayIntent(intent))
    : '';

  // #V55 · Grounding KB/FAQ + #V76 · En paralelo: recuperar KB y construir las
  // instrucciones adicionales (que hace su propia lectura de hábitos) antes iban
  // en serie; ahora comparten un único round-trip de espera.
  const [kbMatches, additionalInstructions] = await Promise.all([
    config.kb.enabled
      ? buscarKBTexto(texto, { limite: config.kb.limite }).catch(() => [])
      : Promise.resolve([]),
    buildAdditionalInstructions(cliente, telefono, toolContext, contextoBot),
  ]);
  const bloqueKB = construirBloqueKB(kbMatches);

  const bloques = [botConfig?.system_prompt || DEFAULT_SYSTEM_PROMPT];
  if (overlay) bloques.push('', '---', overlay);
  if (bloqueKB) bloques.push('', '---', bloqueKB);
  if (bloquePrefetch) bloques.push('', '---', bloquePrefetch);
  bloques.push('', '---', additionalInstructions);
  const instructions = bloques.join('\n');

  if (kbMatches.length) {
    marcarUso(kbMatches.map((m) => m.id)).catch(() => {});
  }

  // bot_config.temperatura (schema CHECK 0-2) ahora se aplica de verdad.
  const temperatura = Number(botConfig?.temperatura);
  const opcionesModelo = { model: modeloDelTurno(intent), instructions };
  // #V76 (D06): con la política de tools por intent hay turnos sin herramientas
  // (saludo/general). `tools: []` no le aporta nada al modelo, así que se omite.
  if (toolsTurno.length) opcionesModelo.tools = toolsTurno;
  if (Number.isFinite(temperatura)) opcionesModelo.temperature = temperatura;
  // #V76 · Tope de salida opt-in (OPENAI_MAX_OUTPUT_TOKENS): acota la generación,
  // que domina la latencia por llamada.
  if (config.openai.maxOutputTokens) opcionesModelo.max_output_tokens = config.openai.maxOutputTokens;

  // #V76 · Tamaño de lo enviado (diagnóstico de latencia).
  fases.instr_chars = instructions.length;
  fases.tools_n = toolsTurno.length;
  fases.prefetch = bloquePrefetch ? 1 : 0;
  fases.input_msgs = Array.isArray(historial) ? historial.length : 0;
  fases.input_chars = JSON.stringify(historial).length;

  fases.prep_ms = Date.now() - inicioTurno;
  let tModelo = Date.now();
  let response = await openai.responses.create({
    ...opcionesModelo,
    input: historial,
  });
  fases.model_ms += Date.now() - tModelo;
  let prevResponseId = response.id;

  let iterations = 0;
  while (functionCalls(response).length > 0) {
    if (++iterations > 10) {
      throw new Error('Demasiadas llamadas a herramientas.');
    }
    const calls = functionCalls(response);
    const toolOutputs = [];
    let handoffEfectivo = false;
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        args = {};
      }
      const tHerramienta = Date.now();
      const result = await ejecutarHerramienta(call.name, args, { telefono, intent });
      fases.tool_ms += Date.now() - tHerramienta;
      toolsUsadas.add(call.name);
      // #V30/#V47 · evento tool_call, fire-and-forget.
      registrarTool(telefono, call.name, Boolean(result?.ok));
      toolOutputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
      if (call.name === 'consultar_precio_y_stock' && Array.isArray(result?.productos)) {
        for (const p of result.productos) {
          toolContext[p.id] = { id: p.id, nombre: p.nombre };
          // #V30/#V47 · evento producto_visto (solo id, anti-PII).
          registrarProductoVisto(telefono, p.id).catch(() => {});
        }
      }
      // #V45 · Handoff efectivo: la conversación termina aquí. El cliente
      // recibe un acuse determinista del servidor (no depende de la redacción
      // del modelo) y no se hace ninguna llamada adicional a OpenAI.
      if (call.name === 'solicitar_asistencia_humana' && result?.ok) {
        handoffEfectivo = true;
      }
    }
    if (handoffEfectivo) {
      // #V51 · Telemetría del turno (fire-and-forget, fail-soft).
      fases.out_chars = ACUSE_HANDOFF.length;
      registrarRespuestaBot(telefono, {
        latency_ms: Date.now() - inicioTurno,
        tools: [...toolsUsadas],
        iterations,
        handoff: true,
        intent,
        fases,
      }).catch(() => {});
      return ACUSE_HANDOFF;
    }
    tModelo = Date.now();
    response = await openai.responses.create({
      ...opcionesModelo,
      previous_response_id: prevResponseId,
      input: toolOutputs,
    });
    fases.model_ms += Date.now() - tModelo;
    prevResponseId = response.id;
  }

  const supabase = getSupabase();
  // Fusionar: re-leer el contexto actual (pudo ser actualizado por las tools,
  // p. ej. recordarRecomendacion con el contador de rotación) y solo añadir los
  // id->nombre vistos en este turno, SIN pisar el contador (veces/ultima).
  const { data: ctxActual } = await supabase
    .from('estado_chat')
    .select('last_tool_context')
    .eq('telefono_cliente', telefono)
    .maybeSingle();
  const ultimoCtx = ctxActual?.last_tool_context || {};
  for (const [id, v] of Object.entries(toolContext)) {
    if (!ultimoCtx[id]) ultimoCtx[id] = { id: v.id, nombre: v.nombre };
  }

  const { error: estError } = await supabase
    .from('estado_chat')
    .update({
      ultima_actualizacion: new Date().toISOString(),
      last_tool_context: ultimoCtx,
    })
    .eq('telefono_cliente', telefono);

  // #V51 · Telemetría del turno (fire-and-forget, fail-soft): latencia total,
  // herramientas usadas e iteraciones del bucle de OpenAI.
  const textoFinal = extractAssistantText(response) || 'Un momento, te atiendo enseguida.';
  fases.out_chars = textoFinal.length;
  registrarRespuestaBot(telefono, {
    latency_ms: Date.now() - inicioTurno,
    tools: [...toolsUsadas],
    iterations,
    intent,
    fases,
  }).catch(() => {});

  return textoFinal;
}

module.exports = { getOpenAI, responderConAsistente, DEFAULT_SYSTEM_PROMPT };