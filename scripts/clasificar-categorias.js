'use strict';

// #V56 · Backfill de `productos.categoria_id` con el clasificador determinista
// de `src/lib/categorias.js`.
//
// Uso:
//   node scripts/clasificar-categorias.js                      → DRY-RUN (no escribe)
//   node scripts/clasificar-categorias.js --apply              → escribe categoria_id (solo NULL)
//   node scripts/clasificar-categorias.js --apply --force      → reclasifica también los ya asignados
//   node scripts/clasificar-categorias.js --from-json p.json   → offline (no toca BD)
//
// Requiere SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (ver .env). En dry-run imprime
// la distribución por categoría y muestras para revisión manual; el override
// puntual se hace desde el panel (POST /api/fidelizacion/producto-categoria).

const fs = require('fs');
const { clasificarProducto, CATEGORIAS } = require('../src/lib/categorias');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const JSON_IDX = args.indexOf('--from-json');
const FROM_JSON = JSON_IDX >= 0 ? args[JSON_IDX + 1] : null;
const MUESTRAS_POR_CAT = 8;
const CHUNK = 200;

async function cargarProductos() {
  if (FROM_JSON) {
    const data = JSON.parse(fs.readFileSync(FROM_JSON, 'utf8'));
    return { offline: true, rows: data };
  }
  const { getSupabase } = require('../src/lib/supabase');
  const sb = getSupabase();
  const page = 1000;
  const rows = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await sb
      .from('productos')
      .select('id,nombre,marca,descripcion,categoria_id')
      .eq('activo', true)
      .range(from, from + page - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return { offline: false, rows };
}

async function idsDeCategorias(sb) {
  const { data, error } = await sb.from('fidelizacion_categorias').select('id,nombre,activa');
  if (error) throw error;
  const map = {};
  for (const c of data || []) map[c.nombre] = c;
  return map;
}

async function main() {
  const { offline, rows } = await cargarProductos();

  const clasificados = [];
  let yaAsignados = 0;
  let sinClasificar = 0;
  const dist = {};
  const muestras = {};
  for (const c of CATEGORIAS) {
    dist[c] = 0;
    muestras[c] = [];
  }

  for (const p of rows) {
    const res = clasificarProducto(p);
    const tieneCategoria = p.categoria_id != null;
    if (tieneCategoria && !FORCE) {
      yaAsignados += 1;
      continue;
    }
    if (!res.categoria) {
      sinClasificar += 1;
      continue;
    }
    dist[res.categoria] += 1;
    if (muestras[res.categoria].length < MUESTRAS_POR_CAT) muestras[res.categoria].push({ ...p, motivo: res.motivo });
    clasificados.push({ id: p.id, categoria: res.categoria, motivo: res.motivo });
  }

  console.log(`#V56 · clasificación de categorías ${offline ? '(offline)' : '(BD productos activos)'}`);
  console.log(`Total productos activos : ${rows.length}`);
  console.log(`Ya categorizados (skip) : ${yaAsignados}`);
  console.log(`Clasificables (backfill) : ${clasificados.length}`);
  console.log(`Sin clasificar (null)    : ${sinClasificar}`);
  console.log('Distribución propuesta:');
  for (const c of CATEGORIAS) console.log(`  ${c.padEnd(16)} ${dist[c]}`);
  console.log('Muestras:');
  for (const c of CATEGORIAS) {
    console.log(`  [${c}]`);
    if (!muestras[c].length) console.log('    (ninguna)');
    for (const m of muestras[c]) console.log(`    - ${m.nombre}  ← ${m.motivo}`);
  }

  if (!APPLY) {
    console.log('\nDRY-RUN: no se ha escrito nada. Repite con --apply para aplicar.');
    return;
  }
  if (offline) {
    console.log('\n--apply no aplica con --from-json (modo offline). Abortando.');
    process.exitCode = 1;
    return;
  }

  const { getSupabase } = require('../src/lib/supabase');
  const sb = getSupabase();
  const cats = await idsDeCategorias(sb);
  const porCategoria = {};
  for (const c of clasificados) (porCategoria[c.categoria] ||= []).push(c.id);

  let actualizados = 0;
  for (const [nombre, ids] of Object.entries(porCategoria)) {
    const cat = cats[nombre];
    if (!cat) {
      console.log(`Aviso: categoría "${nombre}" no existe en fidelizacion_categorias; se omite.`);
      continue;
    }
    for (let i = 0; i < ids.length; i += CHUNK) {
      const trozo = ids.slice(i, i + CHUNK);
      const { error } = await sb.from('productos').update({ categoria_id: cat.id }).in('id', trozo);
      if (error) throw error;
      actualizados += trozo.length;
    }
  }
  console.log(`\nAplicado: ${actualizados} productos clasificados.`);
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
