'use strict';

// ===============================================================
// #V30 — Backfill de datos no estructurados (idempotente, re-corrible).
// Fuente verdad: sql/migracion-v30-datos-no-estructurados.sql §1 (perfil jsonb).
// Copia de legado: public.clientes.habitos_consumo (TEXT) -> perfil jsonb.
// NO regenera eventos; solo el perfil estructurado inicial de cada cliente.
// Exitos: segun plan §8 paso 5 -> "{total, ok, no_habito}" con ok>=1.
// ===============================================================

const { getSupabase } = require('../src/lib/supabase');

async function main() {
  const supabase = getSupabase();
  console.log('[v30-backfill] fase 1/2: leer clientes con habitos_consumo (legado)...');

  const { data: clientes, error: errRead } = await supabase
    .from('clientes')
    .select('telefono, habitos_consumo')
    .not('habitos_consumo', 'is', null);

  if (errRead) throw errRead;
  console.log(`[v30-backfill] leidos ${(clientes || []).length} clientes con habitos.`);

  const out = { total: 0, ok: 0, sin_habito: 0, errores: [] };

  for (const c of clientes || []) {
    out.total++;
    const hab = String(c.habitos_consumo || '').trim();
    if (!hab || hab === 'null' || hab === '{}') { out.sin_habito++; continue; }

    const perfil = {
      intereses: [],
      categorias: {},
      alertas: [],
      fuente: 'legado_habitos_consumo',
      habitos_bruto: hab.slice(0, 500),
    };

    try {
      const { error: errUpd } = await supabase
        .from('clientes')
        .update({ perfil: perfil })
        .eq('telefono', c.telefono);
      if (errUpd) throw errUpd;
      out.ok++;
    } catch (e) {
      out.errores.push({ telefono: c.telefono, msg: String(e.message || e) });
    }
  }

  console.log(`[v30-backfill] resumen: total=${out.total} ok=${out.ok} sin_habito=${out.sin_habito} errores=${out.errores.length}`);
  if (out.errores.length) {
    console.error('[v30-backfill] errores (primeros 5):', JSON.stringify(out.errores.slice(0, 5), null, 2));
  }

  if (out.ok < 1) {
    console.error('[v30-backfill] NO_COMMIT: 0 perfiles escritos — revisar datos/permisos.');
    process.exit(1);
  }
  console.log('[v30-backfill] OK: espejo #V30 listo.');
  return out;
}

main().catch((e) => { console.error('[v30-backfill] ERROR:', e); process.exit(1); });
