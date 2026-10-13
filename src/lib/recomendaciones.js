'use strict';

// #V56 · Piezas PURAS del motor de recomendaciones y del perfil de consumo.
// Sin fs, sin red, sin Supabase → testeable con `node scripts/test-recomendaciones.js`.
// El motor completo (con acceso a datos) vive en services/customers.js.

// Prioridad de los criterios de recomendación (mayor = mejor). El orden relativo
// previo (#V51: habito > co_ocurrencia > contenido > populares) se conserva; #V56
// inserta `categoria` (afinidad por categoría curada) entre hábito y co-ocurrencia.
const RECOMENDACION_PRIORIDAD = {
  habito: 5,
  categoria: 4,
  co_ocurrencia: 3,
  contenido: 2,
  populares: 1,
};

const MAX_RECOMENDACIONES = 6;
const MAX_INTERESES = 8;

// Agrega filas de compra
//   [{ cantidad, productos: { nombre, categoria_id, fidelizacion_categorias: { nombre } } }]
// en un perfil { intereses: [...], categorias: { <nombre>: <unidades> } }:
//   · intereses = productos más comprados (cap MAX_INTERESES).
//   · categorias = conteo de unidades por categoría curada (categoria_id →
//     fidelizacion_categorias.nombre). Sin categoría → no genera entrada.
function resumirPerfilConsumo(filas) {
  const porCategoria = new Map();
  const porProducto = new Map();
  for (const f of filas || []) {
    const prod = f?.productos || {};
    const cant = Number(f?.cantidad) > 0 ? Number(f.cantidad) : 1;
    const nombre = String(prod.nombre || '').trim();
    const cat = String(prod.fidelizacion_categorias?.nombre || '').trim();
    if (cat) porCategoria.set(cat, (porCategoria.get(cat) || 0) + cant);
    if (nombre) porProducto.set(nombre, (porProducto.get(nombre) || 0) + cant);
  }

  const intereses = [...porProducto.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_INTERESES)
    .map(([nombre]) => nombre);

  const categorias = {};
  for (const [nombre, n] of [...porCategoria.entries()].sort((a, b) => b[1] - a[1])) {
    categorias[nombre] = n;
  }

  return { intereses, categorias };
}

module.exports = {
  RECOMENDACION_PRIORIDAD,
  MAX_RECOMENDACIONES,
  MAX_INTERESES,
  resumirPerfilConsumo,
};
