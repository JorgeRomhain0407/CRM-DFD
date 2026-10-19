'use strict';

// #V76 · Diagnóstico crudo de la llamada a OpenAI (Responses API).
// Aísla qué contribuye a la latencia del modelo: prompt base, tamaño del prompt,
// herramientas expuestas y modelo. NO toca Supabase ni el bot.
//
// Uso: node scripts/bench-openai-crudo.js [repeticiones]

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const REP = Math.max(1, Number(process.argv[2] || 3));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const system = fs.readFileSync(path.join(__dirname, '..', 'src', 'prompts', 'system.txt'), 'utf8');
const systemCorto = system.split('\n').slice(0, 25).join('\n');
const TOOLS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'openai-tools.json'), 'utf8'));

const inst = (field) => Object.values(field)[0];

async function medir(nombre, opciones) {
  const muestras = [];
  for (let i = 0; i < REP; i++) {
    const t0 = performance.now();
    try {
      await openai.responses.create(opciones);
      muestras.push(performance.now() - t0);
    } catch (err) {
      console.log(`  ${nombre}: ERROR ${err.status || ''} ${err.message}`);
      return;
    }
  }
  muestras.sort((a, b) => a - b);
  const p50 = muestras[Math.floor(muestras.length / 2)];
  const media = muestras.reduce((a, b) => a + b, 0) / muestras.length;
  console.log(`  ${nombre.padEnd(46)} p50=${p50.toFixed(0).padStart(5)} ms  media=${media.toFixed(0).padStart(5)} ms`);
}

async function main() {
  const modelos = [process.env.OPENAI_MODEL || 'gpt-4o-mini'];
  if (process.env.OPENAI_MODEL_LIGERO) modelos.push(process.env.OPENAI_MODEL_LIGERO);
  console.log(`repeticiones por variante: ${REP}\n`);

  for (const model of [...new Set(modelos)]) {
    console.log(`== modelo ${model} ==`);
    await medir('mínimo (instructions="OK", sin tools)', {
      model, instructions: 'Responde únicamente con la palabra OK.', input: 'Hola',
    });
    await medir('system.txt COMPLETO (sin tools)', {
      model, instructions: system, input: 'Hola',
    });
    await medir('system.txt CORTO 25 líneas (sin tools)', {
      model, instructions: systemCorto, input: 'Hola',
    });
    await medir(`system.txt completo + ${TOOLS.length} tools`, {
      model, instructions: system, tools: TOOLS, input: 'Hola',
    });
    const toolsCore = TOOLS.filter((t) => ['consultar_precio_y_stock', 'solicitar_asistencia_humana'].includes(t.name));
    await medir(`system.txt completo + ${toolsCore.length} tools core`, {
      model, instructions: system, tools: toolsCore, input: 'Hola',
    });

    // H2 · Historial: mensajes verbosos como las respuestas reales del bot.
    const msgLargo = 'Aquí tienes lo que encontré en el inventario de la farmacia: el producto solicitado está disponible, con un precio de venta al público de referencia. Recuerda que la disponibilidad puede variar; si gustas puedo reservarlo en tu carrito y pasarte el total con cualquier descuento aplicable. ¿Deseas que continúe?';
    const hist = (n) => {
      const arr = [];
      for (let i = 0; i < n; i++) {
        arr.push({ role: 'user', content: `consulta de prueba número ${i} sobre un medicamento` });
        arr.push({ role: 'assistant', content: msgLargo });
      }
      return arr;
    };
    for (const n of [6, 15, 30]) {
      await medir(`system + 7 tools + historial ${n * 2} msgs`, {
        model, instructions: system, tools: TOOLS, input: hist(n),
      });
    }
    console.log('');
  }

  console.log(`tamaño system.txt: ${system.length} bytes (~${Math.round(system.length / 4)} tokens aprox)`);
  console.log(`tamaño system corto: ${systemCorto.length} bytes`);
  console.log(`tools: ${TOOLS.length} definiciones, ${JSON.stringify(TOOLS).length} bytes (~${Math.round(JSON.stringify(TOOLS).length / 4)} tokens aprox)`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
