'use strict';

// #V56 · Batería del clasificador de categorías (determinista, sin BD).
// Uso: `node scripts/test-categorias.js`

const { clasificarProducto, CATEGORIAS } = require('../src/lib/categorias');

let ok = 0;
let fail = 0;
function check(desc, cond) {
  if (cond) ok += 1;
  else {
    fail += 1;
    console.log(`FALLO: ${desc}`);
  }
}

const cat = (nombre, extras = {}) => clasificarProducto({ nombre, ...extras }).categoria;

// --- Vitaminas ---------------------------------------------------------------
check('Vitamina C → Vitaminas', cat('Vitamina C 1000 mg') === 'Vitaminas');
check('Multivitaminas → Vitaminas', cat('Multivitaminas Centrum Adultos') === 'Vitaminas');
check('Complejo B → Vitaminas', cat('Complejo B 60 comprimidos') === 'Vitaminas');
check('Omega 3 → Vitaminas', cat('Omega 3 aceite de pescado 1000 mg') === 'Vitaminas');
check('Colágeno → Vitaminas', cat('Colágeno hidrolizado con vitamina C') === 'Vitaminas');
check('Magnesio → Vitaminas', cat('Magnesio 300 mg') === 'Vitaminas');
check('Ácido fólico → Vitaminas', cat('Ácido fólico 5 mg') === 'Vitaminas');
check('Suplemento → Vitaminas', cat('Suplemento nutricional deportivo') === 'Vitaminas');

// --- Dermocosmética ----------------------------------------------------------
check('Protector solar → Dermo', cat('Protector solar SPF 50+') === 'Dermocosmética');
check('Crema hidratante → Dermo', cat('Crema hidratante facial') === 'Dermocosmética');
check('Champú → Dermo', cat('Champú anticaída 400 ml') === 'Dermocosmética');
check('Gel de ducha → Dermo', cat('Gel de ducha piel sensible') === 'Dermocosmética');
check('Marca dermo (Isdin) → Dermo', cat('Fotoprotector ISDIN Fusion Water') === 'Dermocosmética');
check('Marca dermo (CeraVe) → Dermo', cat('CeraVe crema hidratante') === 'Dermocosmética');
check('Sérum → Dermo', cat('Sérum vitamina C con ácido hialurónico') === 'Dermocosmética');

// --- Parafarmacia ------------------------------------------------------------
check('Gasa → Parafarmacia', cat('Gasa estéril 10x10') === 'Parafarmacia');
check('Alcohol → Parafarmacia', cat('Alcohol 96º 250 ml') === 'Parafarmacia');
check('Termómetro → Parafarmacia', cat('Termómetro digital de frente') === 'Parafarmacia');
check('Preservativos → Parafarmacia', cat('Preservativos ultra finos 12 uds') === 'Parafarmacia');
check('Bastón → Parafarmacia', cat('Bastón regulable de aluminio') === 'Parafarmacia');
check('Povidona → Parafarmacia', cat('Povidona yodada 10% solución') === 'Parafarmacia');

// --- No clasificables (medicamentos / genéricos) -----------------------------
check('Paracetamol → null', cat('Paracetamol 1 g 20 comprimidos') === null);
check('Ibuprofeno → null', cat('Ibuprofeno 600 mg 40 comprimidos') === null);
check('Amoxicilina → null', cat('Amoxicilina 500 mg cápsulas') === null);
check('Omeprazol → null', cat('Omeprazol 20 mg cápsulas gastrorresistentes') === null);
check('vacío → null', cat('') === null);
check('ruido → null', cat('xyzabc 123') === null);

// --- Guarda anti-medicamento (aunque el nombre tenga palabra de categoría) ----
check('Crema vaginal → null', cat('Clotrimazol crema vaginal al 10%') === null);
check('Magnesio inyectable → null', cat('Sulfato de magnesio solución inyectable 1 mEq') === null);
check('Potasio en comprimidos → null', cat('Potasio gluconato 99 mg comprimidos') === null);
check('Suero oral → null', cat('Pedialyte suero oral con zinc') === null);
check('Crema dental → Parafarmacia', cat('Crema dental Tantun Verde') === 'Parafarmacia');
check('Suplemento con forma de comprimido se mantiene', cat('Cevax zinc (vitamina C) cápsulas 500 mg') === 'Vitaminas');
check('Complejo B comprimidos se mantiene', cat('Complejo B 60 comprimidos') === 'Vitaminas');

// --- Forma / pureza ----------------------------------------------------------
const r = clasificarProducto({ nombre: 'Vitamina D 2000 UI', marca: null, descripcion: null });
check('devuelve { categoria, motivo, score }', r.categoria === 'Vitaminas' && typeof r.motivo === 'string' && r.score >= 3);

// La marca también cuenta (por ejemplo una marca dermo sin palabra "crema").
check('marca aporta señal', cat('XYZ', { marca: 'Bioderma' }) === 'Dermocosmética');

check('CATEGORIAS son las 3 curadas', JSON.stringify(CATEGORIAS) === JSON.stringify(['Dermocosmética', 'Vitaminas', 'Parafarmacia']));

console.log(`\nCategorías: ${ok} pasan, ${fail} fallan (${ok + fail} casos)`);
process.exit(fail > 0 ? 1 : 0);
