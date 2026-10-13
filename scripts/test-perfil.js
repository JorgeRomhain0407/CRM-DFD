'use strict';

// #V56 · Batería del perfil de consumo (determinista, sin BD).
// Uso: `node scripts/test-perfil.js`

const { calcularFragmento, fusionarPerfil, tokensDeNombre } = require('../src/lib/perfil');

let ok = 0;
let fail = 0;
function check(desc, cond) {
  if (cond) ok += 1;
  else {
    fail += 1;
    console.log(`FALLO: ${desc}`);
  }
}

// --- tokens ------------------------------------------------------------------
check('descarta unidades y conectores',
  JSON.stringify(tokensDeNombre('Paracetamol 500 mg comprimidos para el dolor')) === JSON.stringify(['paracetamol', 'dolor']));
check('descarta tokens cortos y numéricos',
  tokensDeNombre('Vit C 10 x').every((t) => t.length >= 4 && /^[a-z]+$/.test(t)));

// --- calcularFragmento -------------------------------------------------------
const purchases = [
  { nombre: 'Paracetamol 500 mg', categoria: null, fecha: '2026-01-10T10:00:00Z' },
  { nombre: 'Vitamina C 1000 mg', categoria: 'Vitaminas', fecha: '2026-02-01T10:00:00Z' },
  { nombre: 'Vitamina D 2000 UI', categoria: 'Vitaminas', fecha: '2026-02-20T10:00:00Z' },
];
const vistas = ['Crema hidratante CeraVe', 'Serum Vitamina C'];

const frag = calcularFragmento({ purchases, vistas });
check('categorias cuenta por categoría (2 Vitaminas)',
  frag.categorias.Vitaminas === 2 && Object.keys(frag.categorias).length === 1);
check('intereses incluye tokens de producto', frag.intereses.includes('vitamina'));
check('intereses incluye tokens de vistas', frag.intereses.includes('hidratante') || frag.intereses.includes('cerave'));
check('intereses no incluye unidades/números', !frag.intereses.includes('comprimidos') && !frag.intereses.includes('1000'));
check('intereses acotado a 8', frag.intereses.length <= 8);
check('ultima_compra es la más reciente', frag.ultima_compra === '2026-02-20T10:00:00Z');
check('compras = número de líneas', frag.compras === 3);

// Sin compras ni vistas: fragmento vacío y estable.
const vacio = calcularFragmento();
check('vacío → categorias {}', JSON.stringify(vacio.categorias) === '{}');
check('vacío → intereses []', Array.isArray(vacio.intereses) && vacio.intereses.length === 0);
check('vacío → ultima_compra null', vacio.ultima_compra === null);
check('vacío → compras 0', vacio.compras === 0);

// --- fusionarPerfil ----------------------------------------------------------
const previo = {
  puntos: 120,
  habitos: 'Paracetamol 1x',
  edad: 45,
  alertas: ['alergia ibuprofeno'],
  intereses: ['viejo'], // debe ser reemplazado por el fragmento
};
const mezcla = fusionarPerfil(previo, frag);
check('preserva puntos', mezcla.puntos === 120);
check('preserva habitos', mezcla.habitos === 'Paracetamol 1x');
check('preserva edad', mezcla.edad === 45);
check('preserva alertas', JSON.stringify(mezcla.alertas) === JSON.stringify(['alergia ibuprofeno']));
check('reemplaza intereses con el fragmento', mezcla.intereses.includes('vitamina') && !mezcla.intereses.includes('viejo'));
check('añade categorias', mezcla.categorias.Vitaminas === 2);
check('añade ultima_compra', mezcla.ultima_compra === '2026-02-20T10:00:00Z');

// Fragmento vacío NO debe borrar lo existente.
const sinCambios = fusionarPerfil(previo, { categorias: {}, intereses: [], ultima_compra: null });
check('fragmento vacío no toca intereses', JSON.stringify(sinCambios.intereses) === JSON.stringify(['viejo']));
check('fragmento vacío preserva puntos', sinCambios.puntos === 120);

// Perfil inexistente → arranca de {}.
const desdeCero = fusionarPerfil(null, frag);
check('perfil null → crea objeto', typeof desdeCero === 'object' && desdeCero.categorias.Vitaminas === 2);

console.log(`\nPerfil: ${ok} pasan, ${fail} fallan (${ok + fail} casos)`);
process.exit(fail > 0 ? 1 : 0);
