'use strict';

// #V56 · I/O del perfil de consumo: lee ventas + vistas del cliente, deriva el
// fragmento (src/lib/perfil.js) y lo FUSIONA en `clientes.perfil` (JSONB).
// Fail-soft vía `actualizarPerfilSeguro` para poder llamarse fire-and-forget
// desde el cierre de compra sin bloquear el turno del bot.

const { getSupabase } = require('../lib/supabase');
const { calcularFragmento, fusionarPerfil } = require('../lib/perfil');

async function calcularFragmentoCliente(telefono) {
  const supabase = getSupabase();

  const { data: ventas, error: errV } = await supabase
    .from('ventas')
    .select('producto_id, created_at')
    .eq('telefono_cliente', telefono);
  if (errV) throw errV;

  const { data: eventos } = await supabase
    .from('cliente_eventos')
    .select('payload, created_at')
    .eq('telefono_cliente', telefono)
    .eq('tipo', 'producto_visto')
    .order('created_at', { ascending: false })
    .limit(50);

  const idsVentas = [...new Set((ventas || []).map((v) => v.producto_id).filter(Boolean))];
  const idsVistas = [...new Set((eventos || []).map((e) => e && e.payload && e.payload.id_producto).filter(Boolean))];
  const ids = [...new Set([...idsVentas, ...idsVistas])];

  const porId = new Map();
  if (ids.length) {
    const { data: prods, error: errP } = await supabase
      .from('productos')
      .select('id, nombre, categoria_id')
      .in('id', ids);
    if (errP) throw errP;
    for (const p of prods || []) porId.set(p.id, p);
  }

  const catIds = [...new Set([...porId.values()].map((p) => p.categoria_id).filter(Boolean))];
  const catNombre = new Map();
  if (catIds.length) {
    const { data: cats } = await supabase
      .from('fidelizacion_categorias')
      .select('id, nombre')
      .in('id', catIds);
    for (const c of cats || []) catNombre.set(c.id, c.nombre);
  }

  const purchases = (ventas || []).map((v) => {
    const p = porId.get(v.producto_id);
    return {
      categoria: p && p.categoria_id ? catNombre.get(p.categoria_id) || null : null,
      nombre: (p && p.nombre) || '',
      fecha: v.created_at,
    };
  });
  const vistas = idsVistas.map((id) => (porId.get(id) || {}).nombre).filter(Boolean);

  return calcularFragmento({ purchases, vistas });
}

async function actualizarPerfil(telefono) {
  const supabase = getSupabase();
  const fragmento = await calcularFragmentoCliente(telefono);
  const { data: cli } = await supabase
    .from('clientes')
    .select('perfil')
    .eq('telefono', telefono)
    .maybeSingle();
  const fusionado = fusionarPerfil(cli && cli.perfil, fragmento);
  fusionado.perfil_actualizado = new Date().toISOString();
  const { error } = await supabase.from('clientes').update({ perfil: fusionado }).eq('telefono', telefono);
  if (error) throw error;
  return fusionado;
}

async function actualizarPerfilSeguro(telefono) {
  try {
    return await actualizarPerfil(telefono);
  } catch (err) {
    console.warn('[perfil] no actualizado:', String((err && err.message) || err).slice(0, 140));
    return null;
  }
}

module.exports = { calcularFragmentoCliente, actualizarPerfil, actualizarPerfilSeguro };
