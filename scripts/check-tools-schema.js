'use strict';

/*
 * #V63 (Fase 2) · Guardarraíl de esquemas de tools para la OpenAI Responses API.
 *
 * El 2026-10-13 se desplegó `recomendar_productos` con `"strict": true` pero con
 * `"tema"` fuera de `"required"` → OpenAI rechaza la llamada con
 * 400 invalid_function_parameters y el bot entero cae (por #V44 se ve como 503
 * en el panel). Ninguna batería offline lo detectó porque ninguna llamaba a
 * OpenAI con las tools.
 *
 * Este script es 100% offline (sin red, sin BD): valida el JSON de tools contra
 * las reglas que OpenAI exige cuando `strict` está activo:
 *   - `parameters.type` === 'object'
 *   - `additionalProperties` === false
 *   - `properties` es un objeto no vacío
 *   - `required` existe y es EXACTAMENTE el conjunto de claves de `properties`
 *     (en modo estricto OpenAI obliga a listar todas las propiedades)
 *   - ninguna clave de `required` ausente en `properties`, sin duplicados
 *   - cada propiedad declara `type` con un valor JSON Schema aceptado
 *   - `name` no vacío y único
 *
 * Uso:
 *   node scripts/check-tools-schema.js            # valida ./src/lib/openai-tools.json
 *   node scripts/check-tools-schema.js ruta.json  # valida otro archivo (QA / pruebas negativas)
 *
 * Salida: tabla por tool. Exit 0 si todo pasa; exit 1 con el detalle de cada fallo.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'src', 'lib', 'openai-tools.json');

const TIPOS_VALIDOS = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);

function tipoValido(tipo) {
  if (typeof tipo === 'string') return TIPOS_VALIDOS.has(tipo);
  if (Array.isArray(tipo)) return tipo.length > 0 && tipo.every((t) => tipoValido(t));
  return false;
}

function esObjetoPlano(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mismaLista(a, b) {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

// Devuelve un array de strings con los problemas encontrados para una tool.
function validarTool(tool, indice) {
  const errores = [];
  const etiqueta = `tools[${indice}]${tool && tool.name ? ` (${tool.name})` : ''}`;

  if (!esObjetoPlano(tool)) return [`${etiqueta}: no es un objeto.`];
  if (typeof tool.type !== 'string' || tool.type !== 'function') {
    errores.push(`${etiqueta}: 'type' debe ser "function".`);
  }
  if (typeof tool.name !== 'string' || !tool.name.trim()) {
    errores.push(`${etiqueta}: falta 'name'.`);
  }
  if (typeof tool.description !== 'string' || !tool.description.trim()) {
    errores.push(`${etiqueta}: falta 'description'.`);
  }

  const params = tool.parameters;
  if (!esObjetoPlano(params)) {
    errores.push(`${etiqueta}: falta 'parameters' (objeto).`);
    return errores;
  }
  if (params.type !== 'object') {
    errores.push(`${etiqueta}: parameters.type debe ser "object" (es ${JSON.stringify(params.type)}).`);
  }

  const props = params.properties;
  if (!esObjetoPlano(props) || !Object.keys(props).length) {
    errores.push(`${etiqueta}: 'parameters.properties' debe ser un objeto no vacío.`);
    return errores;
  }
  for (const [clave, def] of Object.entries(props)) {
    if (!esObjetoPlano(def)) {
      errores.push(`${etiqueta}: propiedad '${clave}' no es un objeto de esquema.`);
      continue;
    }
    if (!tipoValido(def.type)) {
      errores.push(`${etiqueta}: propiedad '${clave}' sin 'type' válido (${JSON.stringify(def.type)}).`);
    }
  }

  const clavesProps = Object.keys(props);

  if (tool.strict === true) {
    if (params.additionalProperties !== false) {
      errores.push(`${etiqueta}: strict=true exige parameters.additionalProperties === false.`);
    }
    const required = params.required;
    if (!Array.isArray(required)) {
      errores.push(`${etiqueta}: strict=true exige 'parameters.required' como array.`);
    } else {
      if (new Set(required).size !== required.length) {
        errores.push(`${etiqueta}: 'required' tiene duplicados.`);
      }
      const faltanEnRequired = clavesProps.filter((k) => !required.includes(k));
      const sobranEnRequired = required.filter((k) => !clavesProps.includes(k));
      if (faltanEnRequired.length) {
        errores.push(
          `${etiqueta}: strict=true exige que TODAS las propiedades estén en 'required'. Faltan: ${faltanEnRequired.join(', ')}.`
        );
      }
      if (sobranEnRequired.length) {
        errores.push(
          `${etiqueta}: 'required' menciona claves inexistentes en 'properties': ${sobranEnRequired.join(', ')}.`
        );
      }
      if (!mismaLista(required, clavesProps)) {
        errores.push(
          `${etiqueta}: 'required' (${required.length}) y 'properties' (${clavesProps.length}) deben coincidir exactamente en strict=true.`
        );
      }
    }
  } else if (params.required !== undefined && !Array.isArray(params.required)) {
    errores.push(`${etiqueta}: 'required' presente pero no es un array.`);
  }

  return errores;
}

function main() {
  const archivo = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;

  let bruto;
  try {
    bruto = fs.readFileSync(archivo, 'utf8');
  } catch (err) {
    console.error(`FALLO: no se pudo leer ${archivo}\n  ${err.message}`);
    process.exit(1);
  }

  let tools;
  try {
    tools = JSON.parse(bruto);
  } catch (err) {
    console.error(`FALLO: ${archivo} no es JSON válido\n  ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(tools)) {
    console.error(`FALLO: ${archivo} debe contener un array de tools.`);
    process.exit(1);
  }

  const todos = [];
  const nombres = new Set();
  tools.forEach((tool, i) => {
    const errs = validarTool(tool, i);
    if (tool && typeof tool.name === 'string' && tool.name) {
      if (nombres.has(tool.name)) errs.push(`tools[${i}]: nombre duplicado '${tool.name}'.`);
      nombres.add(tool.name);
    }
    todos.push({ indice: i, nombre: (tool && tool.name) || '(sin nombre)', strict: tool && tool.strict === true, errores: errs });
  });

  const ancho = Math.max(...todos.map((t) => t.nombre.length), 'tool'.length);
  console.log(`Esquema de tools: ${path.relative(process.cwd(), archivo) || archivo}`);
  console.log(`${'tool'.padEnd(ancho)} | strict | estado`);
  console.log(`${'-'.repeat(ancho)}-|--------|-------`);
  for (const t of todos) {
    console.log(`${t.nombre.padEnd(ancho)} | ${String(t.strict).padEnd(6)} | ${t.errores.length ? 'FALLA' : 'OK'}`);
  }

  const conError = todos.filter((t) => t.errores.length);
  if (conError.length) {
    console.error(`\nFALLO: ${conError.length}/${todos.length} tool(s) con errores de esquema:`);
    for (const t of conError) {
      for (const e of t.errores) console.error(`  - ${e}`);
    }
    console.error('\nRecuerda: con strict=true, OpenAI exige required === properties (todas).');
    process.exit(1);
  }

  console.log(`\nOK: ${todos.length}/${todos.length} tools válidas (strict y no strict).`);
}

main();
